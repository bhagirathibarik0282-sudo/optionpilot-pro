export type ShadowEventType =
  | "ENTRY"
  | "TSL_UPDATE"
  | "PARTIAL_EXIT"
  | "RUNNER_EXIT"
  | "BLOCKED";

export interface ShadowTradeEvent {
  tradeId: string;
  ts: string;
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  event: ShadowEventType;
  premium: number;
  quantity: number;
  trailingSl: number | null;
  brokerOrderAllowed: false;
}

export interface ShadowTradeEvidence {
  version: "SHADOW_TRADE_EVIDENCE_V1";
  tradeId: string;
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  entryPremium: number;
  entryQty: number;
  remainingQty: number;
  realisedShadowPnl: number;
  unrealisedShadowPnl: number;
  hypotheticalPnl: number;
  maePoints: number;
  mfePoints: number;
  lastPremium: number;
  lastTrailingSl: number | null;
  closed: boolean;
  events: ShadowTradeEvent[];
  brokerOrderAllowed: false;
}

const finitePositive = (v: number) => Number.isFinite(v) && v > 0;
const validTs = (v: string) => typeof v === "string" && Number.isFinite(Date.parse(v));

export function createShadowTradeEvidence(input: {
  tradeId: string;
  ts: string;
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  entryPremium: number;
  entryQty: number;
  initialTrailingSl?: number | null;
}): ShadowTradeEvidence | null {
  if (!input.tradeId?.trim() || !validTs(input.ts) || !finitePositive(input.entryPremium) || !Number.isInteger(input.entryQty) || input.entryQty <= 0) return null;
  if (input.initialTrailingSl !== undefined && input.initialTrailingSl !== null && (!finitePositive(input.initialTrailingSl) || input.initialTrailingSl >= input.entryPremium)) return null;
  const event: ShadowTradeEvent = { tradeId: input.tradeId, ts: input.ts, index: input.index, event: "ENTRY", premium: input.entryPremium, quantity: input.entryQty, trailingSl: input.initialTrailingSl ?? null, brokerOrderAllowed: false };
  return {
    version: "SHADOW_TRADE_EVIDENCE_V1",
    tradeId: input.tradeId,
    index: input.index,
    entryPremium: input.entryPremium,
    entryQty: input.entryQty,
    remainingQty: input.entryQty,
    realisedShadowPnl: 0,
    unrealisedShadowPnl: 0,
    hypotheticalPnl: 0,
    maePoints: 0,
    mfePoints: 0,
    lastPremium: input.entryPremium,
    lastTrailingSl: input.initialTrailingSl ?? null,
    closed: false,
    events: [event],
    brokerOrderAllowed: false,
  };
}

export function recordShadowTradeEvent(state: ShadowTradeEvidence, input: {
  ts: string;
  event: Exclude<ShadowEventType, "ENTRY">;
  premium: number;
  quantity?: number;
  trailingSl?: number | null;
}): ShadowTradeEvidence | null {
  if (!state || state.closed || !validTs(input.ts) || !finitePositive(input.premium)) return null;
  const lastTs = state.events[state.events.length - 1]?.ts;
  if (lastTs && Date.parse(input.ts) < Date.parse(lastTs)) return null;
  const qty = input.quantity ?? 0;
  if (!Number.isInteger(qty) || qty < 0 || qty > state.remainingQty) return null;
  if (input.event === "PARTIAL_EXIT" && (qty <= 0 || qty >= state.remainingQty)) return null;
  if (input.event === "RUNNER_EXIT" && qty !== state.remainingQty) return null;
  if ((input.event === "TSL_UPDATE") && qty !== 0) return null;
  if (input.trailingSl !== undefined && input.trailingSl !== null && !finitePositive(input.trailingSl)) return null;
  if (input.trailingSl !== undefined && input.trailingSl !== null && state.lastTrailingSl !== null && input.trailingSl < state.lastTrailingSl) return null;

  const favourable = input.premium - state.entryPremium;
  const adverse = state.entryPremium - input.premium;
  const mfePoints = Math.max(state.mfePoints, favourable);
  const maePoints = Math.max(state.maePoints, adverse);

  let remainingQty = state.remainingQty;
  let realisedShadowPnl = state.realisedShadowPnl;
  let closed = state.closed;
  if (input.event === "PARTIAL_EXIT" || input.event === "RUNNER_EXIT") {
    remainingQty -= qty;
    realisedShadowPnl += (input.premium - state.entryPremium) * qty;
    if (input.event === "RUNNER_EXIT") closed = true;
  }
  const unrealisedShadowPnl = closed ? 0 : (input.premium - state.entryPremium) * remainingQty;
  const hypotheticalPnl = realisedShadowPnl + unrealisedShadowPnl;
  const nextTrailingSl = input.trailingSl === undefined ? state.lastTrailingSl : input.trailingSl;
  const event: ShadowTradeEvent = { tradeId: state.tradeId, ts: input.ts, index: state.index, event: input.event, premium: input.premium, quantity: qty, trailingSl: nextTrailingSl ?? null, brokerOrderAllowed: false };

  return { ...state, remainingQty, realisedShadowPnl, unrealisedShadowPnl, hypotheticalPnl, maePoints, mfePoints, lastPremium: input.premium, lastTrailingSl: nextTrailingSl ?? null, closed, events: [...state.events, event], brokerOrderAllowed: false };
}
