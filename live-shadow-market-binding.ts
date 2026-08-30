import type { ShadowTradeEvidence } from "./shadow-trade-evidence-recorder.js";

export interface ShadowContractIdentity {
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  optionType: "CE" | "PE";
  strike: number;
  expiry: string;
  instrumentToken?: string | number | null;
}

export interface LiveShadowMarketTick {
  ts: string;
  index: "NIFTY" | "SENSEX" | "BANKNIFTY";
  optionType: "CE" | "PE";
  strike: number;
  expiry: string;
  premium: number;
  instrumentToken?: string | number | null;
}

export interface LiveShadowBoundTick {
  version: "LIVE_SHADOW_MARKET_BINDING_V1";
  tradeId: string;
  identity: ShadowContractIdentity;
  ts: string;
  premium: number;
  exactContractMatch: true;
  brokerOrderAllowed: false;
}

const positive = (n: number) => Number.isFinite(n) && n > 0;
const validTs = (v: string) => typeof v === "string" && Number.isFinite(Date.parse(v));
const validExpiry = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

export function validateShadowContractIdentity(identity: ShadowContractIdentity): boolean {
  if (!identity) return false;
  if (!["NIFTY", "SENSEX", "BANKNIFTY"].includes(identity.index)) return false;
  if (identity.optionType !== "CE" && identity.optionType !== "PE") return false;
  if (!positive(identity.strike) || !Number.isInteger(identity.strike)) return false;
  if (!validExpiry(identity.expiry)) return false;
  if (identity.instrumentToken !== undefined && identity.instrumentToken !== null && String(identity.instrumentToken).trim() === "") return false;
  return true;
}

export function bindLiveTickToShadowTrade(
  evidence: ShadowTradeEvidence,
  identity: ShadowContractIdentity,
  tick: LiveShadowMarketTick,
): LiveShadowBoundTick | null {
  if (!evidence || evidence.brokerOrderAllowed !== false || evidence.closed) return null;
  if (!evidence.tradeId?.trim() || !validateShadowContractIdentity(identity)) return null;
  if (!tick || !validTs(tick.ts) || !positive(tick.premium)) return null;

  if (identity.index !== evidence.index || tick.index !== identity.index) return null;
  if (tick.optionType !== identity.optionType) return null;
  if (tick.strike !== identity.strike) return null;
  if (tick.expiry !== identity.expiry) return null;

  const expectedToken = identity.instrumentToken == null ? null : String(identity.instrumentToken);
  const tickToken = tick.instrumentToken == null ? null : String(tick.instrumentToken);
  if (expectedToken !== null && tickToken !== expectedToken) return null;

  return {
    version: "LIVE_SHADOW_MARKET_BINDING_V1",
    tradeId: evidence.tradeId,
    identity,
    ts: tick.ts,
    premium: tick.premium,
    exactContractMatch: true,
    brokerOrderAllowed: false,
  };
}
