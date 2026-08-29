// Research-only buyer/seller behaviour classifier.
// Upstream deterministic evidence supplies explicit booleans/null; no order-flow state is invented here.

export type BuyerSellerState =
  | "BUYERS_IN_CONTROL"
  | "SELLERS_IN_CONTROL"
  | "BUYERS_LOSING_STRENGTH"
  | "SELLERS_LOSING_STRENGTH"
  | "BUYING_REJECTED"
  | "SELLING_REJECTED"
  | "SHORT_COVERING"
  | "LONG_UNWINDING"
  | "MARKET_UNDECIDED"
  | "DATA_UNAVAILABLE";

export interface BuyerSellerEvidence {
  dataFresh: boolean | null;
  contractValid: boolean | null;
  buyersInControl: boolean | null;
  sellersInControl: boolean | null;
  buyersLosingStrength: boolean | null;
  sellersLosingStrength: boolean | null;
  buyingRejected: boolean | null;
  sellingRejected: boolean | null;
  shortCovering: boolean | null;
  longUnwinding: boolean | null;
}

export interface BuyerSellerResult {
  version: "BUYER_SELLER_BEHAVIOUR_ENGINE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  state: BuyerSellerState;
  reasons: string[];
  devilFlags: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

const keys: Array<keyof BuyerSellerEvidence> = [
  "dataFresh", "contractValid", "buyersInControl", "sellersInControl",
  "buyersLosingStrength", "sellersLosingStrength", "buyingRejected", "sellingRejected",
  "shortCovering", "longUnwinding",
];

function out(state: BuyerSellerState, reasons: string[], devilFlags: string[] = []): BuyerSellerResult {
  return { version: "BUYER_SELLER_BEHAVIOUR_ENGINE_V1", semantics: "RESEARCH_SHADOW_ONLY", state, reasons, devilFlags, affectsTelegram: false, affectsVerdict: false, affectsExecution: false };
}

export function classifyBuyerSellerBehaviour(e: BuyerSellerEvidence): BuyerSellerResult {
  const missing = keys.filter((k) => e[k] == null);
  if (missing.length) return out("DATA_UNAVAILABLE", missing.map((k) => `MISSING_${String(k).toUpperCase()}`));
  if (!e.dataFresh) return out("DATA_UNAVAILABLE", ["DATA_NOT_FRESH"], ["STALE_DATA"]);
  if (!e.contractValid) return out("DATA_UNAVAILABLE", ["CONTRACT_NOT_VALID"], ["CONTRACT_IDENTITY_GATE_FAILED"]);

  const primary = [e.buyersInControl, e.sellersInControl, e.buyingRejected, e.sellingRejected, e.shortCovering, e.longUnwinding].filter(Boolean).length;
  if (primary > 1) return out("MARKET_UNDECIDED", ["CONFLICTING_PARTICIPANT_STATES"], ["STATE_CONFLICT"]);

  if (e.buyingRejected) return out("BUYING_REJECTED", ["BUYING_REJECTION_CONFIRMED"]);
  if (e.sellingRejected) return out("SELLING_REJECTED", ["SELLING_REJECTION_CONFIRMED"]);
  if (e.shortCovering) return out("SHORT_COVERING", ["SHORT_COVERING_CONFIRMED"]);
  if (e.longUnwinding) return out("LONG_UNWINDING", ["LONG_UNWINDING_CONFIRMED"]);
  if (e.buyersInControl && e.buyersLosingStrength) return out("BUYERS_LOSING_STRENGTH", ["BUYER_CONTROL_WITH_WEAKENING_CONFIRMED"]);
  if (e.sellersInControl && e.sellersLosingStrength) return out("SELLERS_LOSING_STRENGTH", ["SELLER_CONTROL_WITH_WEAKENING_CONFIRMED"]);
  if (e.buyersInControl) return out("BUYERS_IN_CONTROL", ["BUYER_CONTROL_CONFIRMED"]);
  if (e.sellersInControl) return out("SELLERS_IN_CONTROL", ["SELLER_CONTROL_CONFIRMED"]);
  if (e.buyersLosingStrength) return out("BUYERS_LOSING_STRENGTH", ["BUYER_WEAKENING_CONFIRMED"]);
  if (e.sellersLosingStrength) return out("SELLERS_LOSING_STRENGTH", ["SELLER_WEAKENING_CONFIRMED"]);
  return out("MARKET_UNDECIDED", ["NO_DIRECTIONAL_PARTICIPANT_CONTROL_CONFIRMED"]);
}
