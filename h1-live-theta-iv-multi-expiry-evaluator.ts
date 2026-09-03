export type LiveExactSource = "LIVE_RUNTIME_EXACT";
export type OptionSide = "CE" | "PE";

export interface LiveOptionBurdenSnapshot {
  source: LiveExactSource;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  side: OptionSide;
  strike: number;
  expiryDate: string;
  dte: number;
  observedAt: string;
  premiumLtp: number;
  theta: number;
  iv: number;
}

export interface MultiExpiryPeerSnapshot {
  source: LiveExactSource;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  side: OptionSide;
  expiryDate: string;
  dte: number;
  observedAt: string;
  directionalState: "SUPPORTS" | "CONFLICTS" | "NEUTRAL";
}

export interface ThetaIvMultiExpiryPolicy {
  maxObservationAgeMs: number;
  maxAbsThetaPctOfPremium: number;
  minIv: number;
  maxIv: number;
  requiredPeerCount: number;
  maxConflictingPeerCount: number;
}

export interface ThetaIvMultiExpiryResult {
  version: "H1_LIVE_THETA_IV_MULTI_EXPIRY_EVALUATOR_V1";
  thetaIvBurdenAcceptable: boolean;
  multiExpiryConflictAbsent: boolean;
  reasonCodes: string[];
  failClosed: true;
}

function validPolicy(p: ThetaIvMultiExpiryPolicy): boolean {
  return Number.isFinite(p?.maxObservationAgeMs) && p.maxObservationAgeMs > 0 &&
    Number.isFinite(p?.maxAbsThetaPctOfPremium) && p.maxAbsThetaPctOfPremium >= 0 &&
    Number.isFinite(p?.minIv) && p.minIv >= 0 &&
    Number.isFinite(p?.maxIv) && p.maxIv >= p.minIv &&
    Number.isInteger(p?.requiredPeerCount) && p.requiredPeerCount >= 0 &&
    Number.isInteger(p?.maxConflictingPeerCount) && p.maxConflictingPeerCount >= 0;
}

function validTime(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateLiveThetaIvAndMultiExpiry(
  current: LiveOptionBurdenSnapshot,
  peers: MultiExpiryPeerSnapshot[],
  nowIso: string,
  policy: ThetaIvMultiExpiryPolicy,
): ThetaIvMultiExpiryResult {
  const reasons: string[] = [];
  const nowMs = validTime(nowIso);
  const observedMs = validTime(current?.observedAt);

  if (!validPolicy(policy)) reasons.push("INVALID_THETA_IV_MULTI_EXPIRY_POLICY");
  if (current?.source !== "LIVE_RUNTIME_EXACT") reasons.push("NON_EXACT_CURRENT_SOURCE");
  if (nowMs == null || observedMs == null) reasons.push("INVALID_TIMESTAMP");
  if (!Number.isFinite(current?.strike) || current.strike <= 0 || !Number.isInteger(current?.dte) || current.dte < 0) reasons.push("INVALID_CONTRACT_IDENTITY");
  if (!Number.isFinite(current?.premiumLtp) || current.premiumLtp <= 0 || !Number.isFinite(current?.theta) || !Number.isFinite(current?.iv)) reasons.push("INVALID_THETA_IV_INPUT");

  if (nowMs != null && observedMs != null) {
    const age = nowMs - observedMs;
    if (age < 0) reasons.push("FUTURE_CURRENT_EVIDENCE");
    else if (validPolicy(policy) && age > policy.maxObservationAgeMs) reasons.push("STALE_CURRENT_EVIDENCE");
  }

  const validPeers = Array.isArray(peers) ? peers.filter((peer) => {
    if (peer?.source !== "LIVE_RUNTIME_EXACT") return false;
    if (peer.symbol !== current.symbol || peer.side !== current.side) return false;
    if (peer.expiryDate === current.expiryDate || peer.dte === current.dte) return false;
    const ts = validTime(peer.observedAt);
    if (ts == null || nowMs == null) return false;
    const age = nowMs - ts;
    return age >= 0 && validPolicy(policy) && age <= policy.maxObservationAgeMs;
  }) : [];

  if (validPolicy(policy) && validPeers.length < policy.requiredPeerCount) reasons.push("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS");

  let thetaIvBurdenAcceptable = false;
  let multiExpiryConflictAbsent = false;

  if (reasons.length === 0) {
    const thetaPct = Math.abs(current.theta) / current.premiumLtp * 100;
    thetaIvBurdenAcceptable = thetaPct <= policy.maxAbsThetaPctOfPremium && current.iv >= policy.minIv && current.iv <= policy.maxIv;
    if (!thetaIvBurdenAcceptable) reasons.push("THETA_IV_BURDEN_UNACCEPTABLE");

    const conflicting = validPeers.filter((peer) => peer.directionalState === "CONFLICTS").length;
    multiExpiryConflictAbsent = conflicting <= policy.maxConflictingPeerCount;
    if (!multiExpiryConflictAbsent) reasons.push("MULTI_EXPIRY_CONFLICT_PRESENT");
  }

  return {
    version: "H1_LIVE_THETA_IV_MULTI_EXPIRY_EVALUATOR_V1",
    thetaIvBurdenAcceptable,
    multiExpiryConflictAbsent,
    reasonCodes: reasons.length === 0 ? ["THETA_IV_AND_MULTI_EXPIRY_GATES_PASSED"] : reasons,
    failClosed: true,
  };
}
