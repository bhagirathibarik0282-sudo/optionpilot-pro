export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGE"
  | "HIGH_VOLATILITY"
  | "TRANSITION"
  | "UNKNOWN";

export interface MarketRegimeInput {
  trendDirection: "UP" | "DOWN" | "FLAT" | "UNAVAILABLE";
  rangeState: "EXPANDING" | "COMPRESSED" | "NORMAL" | "UNAVAILABLE";
  volatilityState: "HIGH" | "NORMAL" | "LOW" | "UNAVAILABLE";
  transitionDetected: boolean | null;
  evidenceCount: number;
  minEvidenceCount: number;
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  ready: boolean;
  reason: string;
  semantics: "VALIDATED_EVIDENCE_ONLY";
  ruleVersion: "MARKET_REGIME_ENGINE_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

/**
 * Deterministic regime foundation over already-validated discrete evidence.
 * This module deliberately does not invent thresholds from raw prices/VIX.
 * Until enough validated evidence exists it fails closed to UNKNOWN.
 */
export function classifyMarketRegime(input: MarketRegimeInput): MarketRegimeResult {
  const validMinimum = Number.isInteger(input.minEvidenceCount) && input.minEvidenceCount > 0;
  const enoughEvidence = validMinimum && Number.isInteger(input.evidenceCount) && input.evidenceCount >= input.minEvidenceCount;

  const base = {
    semantics: "VALIDATED_EVIDENCE_ONLY" as const,
    ruleVersion: "MARKET_REGIME_ENGINE_V1" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
  };

  if (!enoughEvidence) {
    return { ...base, regime: "UNKNOWN", ready: false, reason: "INSUFFICIENT_VALIDATED_EVIDENCE" };
  }

  if (input.transitionDetected === true) {
    return { ...base, regime: "TRANSITION", ready: true, reason: "EXPLICIT_TRANSITION_EVIDENCE" };
  }

  if (input.volatilityState === "HIGH" && input.rangeState === "EXPANDING") {
    return { ...base, regime: "HIGH_VOLATILITY", ready: true, reason: "HIGH_VOLATILITY_WITH_RANGE_EXPANSION" };
  }

  if (input.trendDirection === "UP" && input.rangeState !== "COMPRESSED") {
    return { ...base, regime: "TRENDING_UP", ready: true, reason: "VALIDATED_UP_TREND" };
  }

  if (input.trendDirection === "DOWN" && input.rangeState !== "COMPRESSED") {
    return { ...base, regime: "TRENDING_DOWN", ready: true, reason: "VALIDATED_DOWN_TREND" };
  }

  if (input.trendDirection === "FLAT" && (input.rangeState === "COMPRESSED" || input.rangeState === "NORMAL")) {
    return { ...base, regime: "RANGE", ready: true, reason: "FLAT_DIRECTION_WITH_NON_EXPANDING_RANGE" };
  }

  return { ...base, regime: "UNKNOWN", ready: false, reason: "EVIDENCE_CONFLICT_OR_UNAVAILABLE" };
}
