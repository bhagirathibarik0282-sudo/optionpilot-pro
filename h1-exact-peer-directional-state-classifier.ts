import type { LiveOptionContractSnapshot } from "./h1-live-premium-delta-gamma-evaluator.js";

export type H1ExpectedPremiumDirection = "UP" | "DOWN";
export type H1ExactPeerDirectionalState = "SUPPORTS" | "CONFLICTS" | "NEUTRAL";

export interface H1ExactPeerDirectionalStatePolicy {
  maxObservationGapMs: number;
  minAbsolutePremiumMovePct: number;
}

export interface H1ExactPeerDirectionalStateResult {
  version: "H1_EXACT_PEER_DIRECTIONAL_STATE_CLASSIFIER_V1";
  ready: boolean;
  directionalState: H1ExactPeerDirectionalState | null;
  premiumMovePct: number | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  infersExpectedDirectionFromOptionSide: false;
  failClosed: true;
}

function validSnapshot(x: LiveOptionContractSnapshot): boolean {
  return !!x &&
    x.source === "LIVE_RUNTIME_EXACT" &&
    typeof x.symbol === "string" && x.symbol.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.expiry) &&
    Number.isFinite(x.strike) && x.strike > 0 &&
    (x.side === "CE" || x.side === "PE") &&
    Number.isFinite(Date.parse(x.observedAt)) &&
    Number.isFinite(x.ltp) && x.ltp > 0;
}

function sameIdentity(a: LiveOptionContractSnapshot, b: LiveOptionContractSnapshot): boolean {
  return a.symbol.trim().toUpperCase() === b.symbol.trim().toUpperCase() &&
    a.expiry === b.expiry &&
    a.strike === b.strike &&
    a.side === b.side;
}

function result(
  ready: boolean,
  directionalState: H1ExactPeerDirectionalState | null,
  premiumMovePct: number | null,
  blockers: string[],
): H1ExactPeerDirectionalStateResult {
  return {
    version: "H1_EXACT_PEER_DIRECTIONAL_STATE_CLASSIFIER_V1",
    ready,
    directionalState,
    premiumMovePct,
    blockers: [...new Set(blockers)],
    productionImpact: "NONE",
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    infersExpectedDirectionFromOptionSide: false,
    failClosed: true,
  };
}

export function classifyH1ExactPeerDirectionalState(
  previous: LiveOptionContractSnapshot,
  current: LiveOptionContractSnapshot,
  expectedPremiumDirection: H1ExpectedPremiumDirection,
  policy: H1ExactPeerDirectionalStatePolicy,
): H1ExactPeerDirectionalStateResult {
  const blockers: string[] = [];
  if (!validSnapshot(previous)) blockers.push("INVALID_PREVIOUS_EXACT_SNAPSHOT");
  if (!validSnapshot(current)) blockers.push("INVALID_CURRENT_EXACT_SNAPSHOT");
  if (expectedPremiumDirection !== "UP" && expectedPremiumDirection !== "DOWN") blockers.push("MISSING_OR_INVALID_EXPECTED_PREMIUM_DIRECTION");
  if (!policy || !Number.isFinite(policy.maxObservationGapMs) || policy.maxObservationGapMs <= 0 ||
      !Number.isFinite(policy.minAbsolutePremiumMovePct) || policy.minAbsolutePremiumMovePct < 0) {
    blockers.push("INVALID_DIRECTIONAL_STATE_POLICY");
  }

  if (blockers.length > 0) return result(false, null, null, blockers);
  if (!sameIdentity(previous, current)) return result(false, null, null, ["CONTRACT_IDENTITY_MISMATCH"]);

  const previousMs = Date.parse(previous.observedAt);
  const currentMs = Date.parse(current.observedAt);
  const gap = currentMs - previousMs;
  if (gap <= 0) return result(false, null, null, ["NON_FORWARD_CHRONOLOGY"]);
  if (gap > policy.maxObservationGapMs) return result(false, null, null, ["OBSERVATION_GAP_TOO_LARGE"]);

  const premiumMovePct = ((current.ltp - previous.ltp) / previous.ltp) * 100;
  if (Math.abs(premiumMovePct) < policy.minAbsolutePremiumMovePct) {
    return result(true, "NEUTRAL", premiumMovePct, []);
  }

  const observedDirection: H1ExpectedPremiumDirection = premiumMovePct > 0 ? "UP" : "DOWN";
  return observedDirection === expectedPremiumDirection
    ? result(true, "SUPPORTS", premiumMovePct, [])
    : result(true, "CONFLICTS", premiumMovePct, []);
}
