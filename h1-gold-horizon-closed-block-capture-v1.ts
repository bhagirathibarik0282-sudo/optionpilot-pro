import type { H1GoldHorizon, H1GoldHorizonSymbol } from "./h1-gold-horizon-provenance-contract-v1.js";

export const H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1 = "H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1" as const;
export const H1_GOLD_HORIZON_CAPTURE_LOG_KIND = "H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1" as const;

export interface H1GoldClosedHorizonCaptureInput {
  symbol: string;
  timeframeMinutes: number;
  blockStart: string;
  blockEnd: string;
  dataQuality: string;
  stateCode: string;
  source: string;
  semantics: string;
  ruleVersion: string;
  sampleCount: number;
  expected1mCount: number;
}

export interface H1GoldClosedHorizonCaptureEvent {
  version: typeof H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1;
  kind: typeof H1_GOLD_HORIZON_CAPTURE_LOG_KIND;
  captureId: string;
  horizon: H1GoldHorizon;
  symbol: H1GoldHorizonSymbol;
  blockStart: string;
  blockEnd: string;
  capturedAt: string;
  dataQuality: string;
  stateCode: string;
  source: string;
  semantics: string;
  ruleVersion: string;
  sampleCount: number;
  expected1mCount: number;
  immutable: true;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  captureSemantics: "APPEND_ONLY_FORMAL_BLOCK_CLOSE_EVENT_NO_GOLD_AUTHORITY";
}

const CAPTURE_SEMANTICS = "APPEND_ONLY_FORMAL_BLOCK_CLOSE_EVENT_NO_GOLD_AUTHORITY" as const;

function horizonFromMinutes(value: number): H1GoldHorizon | null {
  if (value === 3) return "3M";
  if (value === 6) return "6M";
  if (value === 15) return "15M";
  if (value === 30) return "30M";
  return null;
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Builds the immutable payload written when a formally closed timeframe block
 * is first observable. BANKNIFTY and 60M are intentionally excluded because
 * Gold trading targets are NIFTY/SENSEX and horizonComplete requires 3/6/15/30.
 *
 * This event is evidence capture only. It cannot select, message, execute or
 * promote anything. The append store's persisted timestamp is checked later at
 * decision T0 before the event can contribute to horizonComplete.
 */
export function buildH1GoldClosedHorizonCapture(
  input: H1GoldClosedHorizonCaptureInput,
): H1GoldClosedHorizonCaptureEvent | null {
  if (input?.symbol !== "NIFTY" && input?.symbol !== "SENSEX") return null;
  const horizon = horizonFromMinutes(input?.timeframeMinutes);
  if (!horizon) return null;
  if (!validIso(input?.blockStart) || !validIso(input?.blockEnd)) return null;

  const startMs = Date.parse(input.blockStart);
  const endMs = Date.parse(input.blockEnd);
  const expectedMs = input.timeframeMinutes * 60_000;
  if (endMs <= startMs || endMs - startMs !== expectedMs) return null;
  if (!Number.isInteger(input.sampleCount) || input.sampleCount < 0) return null;
  if (!Number.isInteger(input.expected1mCount) || input.expected1mCount !== input.timeframeMinutes) return null;
  if (typeof input.dataQuality !== "string" || !input.dataQuality.trim()) return null;
  if (typeof input.stateCode !== "string" || !input.stateCode.trim()) return null;
  if (typeof input.source !== "string" || !input.source.trim()) return null;
  if (typeof input.semantics !== "string" || !input.semantics.trim()) return null;
  if (typeof input.ruleVersion !== "string" || !input.ruleVersion.trim()) return null;

  const symbol: H1GoldHorizonSymbol = input.symbol;
  const captureId = `${H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1}:${symbol}:${horizon}:${input.blockEnd}`;
  return {
    version: H1_GOLD_HORIZON_CLOSED_BLOCK_CAPTURE_V1,
    kind: H1_GOLD_HORIZON_CAPTURE_LOG_KIND,
    captureId,
    horizon,
    symbol,
    blockStart: input.blockStart,
    blockEnd: input.blockEnd,
    capturedAt: input.blockEnd,
    dataQuality: input.dataQuality,
    stateCode: input.stateCode,
    source: input.source,
    semantics: input.semantics,
    ruleVersion: input.ruleVersion,
    sampleCount: input.sampleCount,
    expected1mCount: input.expected1mCount,
    immutable: true,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    captureSemantics: CAPTURE_SEMANTICS,
  };
}
