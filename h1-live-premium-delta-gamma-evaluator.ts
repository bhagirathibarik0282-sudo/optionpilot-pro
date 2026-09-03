export type LiveOptionSide = "CE" | "PE";

export interface LiveOptionContractSnapshot {
  symbol: string;
  expiry: string;
  strike: number;
  side: LiveOptionSide;
  observedAt: string;
  ltp: number;
  delta: number;
  gamma: number;
  source: "LIVE_RUNTIME_EXACT";
}

export interface LivePremiumDeltaGammaPolicy {
  maxObservationGapMs: number;
  minPremiumMovePct: number;
  minAbsoluteDeltaChange: number;
  minCurrentGamma: number;
}

export interface LivePremiumDeltaGammaResult {
  version: "H1_LIVE_PREMIUM_DELTA_GAMMA_EVALUATOR_V1";
  semantics: "LIVE_RUNTIME_EXACT_ONLY";
  premiumResponseConfirmed: boolean | null;
  deltaGammaResponseConfirmed: boolean | null;
  premiumMovePct: number | null;
  absoluteDeltaChange: number | null;
  currentGamma: number | null;
  reasonCodes: string[];
  failClosed: true;
}

function validIdentity(a: LiveOptionContractSnapshot, b: LiveOptionContractSnapshot): boolean {
  return a.symbol.trim().toUpperCase() === b.symbol.trim().toUpperCase() &&
    a.expiry === b.expiry && a.strike === b.strike && a.side === b.side;
}

function validSnapshot(x: LiveOptionContractSnapshot): boolean {
  return x?.source === "LIVE_RUNTIME_EXACT" &&
    typeof x.symbol === "string" && x.symbol.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.expiry) &&
    Number.isFinite(x.strike) && x.strike > 0 &&
    (x.side === "CE" || x.side === "PE") &&
    Number.isFinite(Date.parse(x.observedAt)) &&
    Number.isFinite(x.ltp) && x.ltp > 0 &&
    Number.isFinite(x.delta) &&
    Number.isFinite(x.gamma) && x.gamma >= 0;
}

function validPolicy(p: LivePremiumDeltaGammaPolicy): boolean {
  return !!p && Number.isFinite(p.maxObservationGapMs) && p.maxObservationGapMs > 0 &&
    Number.isFinite(p.minPremiumMovePct) && p.minPremiumMovePct >= 0 &&
    Number.isFinite(p.minAbsoluteDeltaChange) && p.minAbsoluteDeltaChange >= 0 &&
    Number.isFinite(p.minCurrentGamma) && p.minCurrentGamma >= 0;
}

export function evaluateLivePremiumDeltaGamma(
  previous: LiveOptionContractSnapshot,
  current: LiveOptionContractSnapshot,
  policy: LivePremiumDeltaGammaPolicy,
): LivePremiumDeltaGammaResult {
  const reasons: string[] = [];
  if (!validPolicy(policy)) reasons.push("INVALID_POLICY");
  if (!validSnapshot(previous)) reasons.push("INVALID_PREVIOUS_SNAPSHOT");
  if (!validSnapshot(current)) reasons.push("INVALID_CURRENT_SNAPSHOT");
  if (reasons.length === 0 && !validIdentity(previous, current)) reasons.push("CONTRACT_IDENTITY_MISMATCH");

  let premiumMovePct: number | null = null;
  let absoluteDeltaChange: number | null = null;
  let currentGamma: number | null = null;

  if (reasons.length === 0) {
    const previousMs = Date.parse(previous.observedAt);
    const currentMs = Date.parse(current.observedAt);
    const gap = currentMs - previousMs;
    if (gap <= 0) reasons.push("NON_FORWARD_CHRONOLOGY");
    else if (gap > policy.maxObservationGapMs) reasons.push("OBSERVATION_GAP_TOO_LARGE");
    else {
      premiumMovePct = ((current.ltp - previous.ltp) / previous.ltp) * 100;
      absoluteDeltaChange = Math.abs(current.delta - previous.delta);
      currentGamma = current.gamma;
    }
  }

  if (reasons.length > 0) {
    return {
      version: "H1_LIVE_PREMIUM_DELTA_GAMMA_EVALUATOR_V1",
      semantics: "LIVE_RUNTIME_EXACT_ONLY",
      premiumResponseConfirmed: null,
      deltaGammaResponseConfirmed: null,
      premiumMovePct,
      absoluteDeltaChange,
      currentGamma,
      reasonCodes: reasons,
      failClosed: true,
    };
  }

  const premiumResponseConfirmed = (premiumMovePct as number) >= policy.minPremiumMovePct;
  const deltaGammaResponseConfirmed =
    (absoluteDeltaChange as number) >= policy.minAbsoluteDeltaChange &&
    (currentGamma as number) >= policy.minCurrentGamma;

  if (!premiumResponseConfirmed) reasons.push("PREMIUM_RESPONSE_BELOW_POLICY");
  if (!deltaGammaResponseConfirmed) reasons.push("DELTA_GAMMA_RESPONSE_BELOW_POLICY");
  if (reasons.length === 0) reasons.push("PREMIUM_AND_DELTA_GAMMA_CONFIRMED");

  return {
    version: "H1_LIVE_PREMIUM_DELTA_GAMMA_EVALUATOR_V1",
    semantics: "LIVE_RUNTIME_EXACT_ONLY",
    premiumResponseConfirmed,
    deltaGammaResponseConfirmed,
    premiumMovePct,
    absoluteDeltaChange,
    currentGamma,
    reasonCodes: reasons,
    failClosed: true,
  };
}
