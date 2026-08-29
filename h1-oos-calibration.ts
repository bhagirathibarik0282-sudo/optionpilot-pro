export type OosGateStatus = "NOT_READY" | "OOS_READY" | "REGIME_STRENGTH_UNLOCKED";

export interface OosWindow {
  id: string;
  startDate: string;
  endDate: string;
  eligibleOutcomes: number;
  wins: number;
  losses: number;
  scratches: number;
  unknownOrIncomplete: number;
}

export interface OosCalibrationInput {
  inSample: OosWindow;
  outOfSample: OosWindow;
  leakageDetected: boolean;
  ruleVersionFrozen: boolean;
  featureSetFrozen: boolean;
  thresholdSetFrozen: boolean;
  regimeCoverageCount: number;
  minOosOutcomes?: number;
  minRegimeCoverage?: number;
  maxWinRateDegradationPctPoints?: number;
}

export interface OosCalibrationResult {
  status: OosGateStatus;
  blockers: string[];
  warnings: string[];
  inSampleWinRate: number | null;
  outOfSampleWinRate: number | null;
  degradationPctPoints: number | null;
  regimeStrengthMayBeCalibrated: boolean;
  probabilityClaimAllowed: false;
  productionWeightingAllowed: false;
  semantics: "HISTORICAL_OOS_VALIDATION_ONLY";
  ruleVersion: "H1_OOS_CALIBRATION_GUARD_V1";
}

function validDateRange(w: OosWindow): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(w.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(w.endDate) &&
    w.startDate <= w.endDate;
}

function winRate(w: OosWindow): number | null {
  const determinate = w.wins + w.losses + w.scratches;
  if (determinate <= 0) return null;
  return (w.wins / determinate) * 100;
}

/**
 * Research-only OOS validation gate.
 *
 * Safety rules:
 * - In-sample and OOS windows must be time-separated with no overlap.
 * - Rule version, feature set and thresholds must be frozen before OOS starts.
 * - No parameter tuning is allowed using OOS results and then reusing that same OOS window.
 * - OOS passing only unlocks later regime-strength calibration work; it does not authorize
 *   probability claims or production weighting.
 */
export function evaluateOosCalibration(input: OosCalibrationInput): OosCalibrationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const minOos = input.minOosOutcomes ?? 30;
  const minRegimes = input.minRegimeCoverage ?? 3;
  const maxDegrade = input.maxWinRateDegradationPctPoints ?? 15;

  if (!validDateRange(input.inSample) || !validDateRange(input.outOfSample)) {
    blockers.push("INVALID_WINDOW_DATE_RANGE");
  }
  if (input.inSample.endDate >= input.outOfSample.startDate) {
    blockers.push("IN_SAMPLE_OOS_OVERLAP_OR_NO_FORWARD_SEPARATION");
  }
  if (input.leakageDetected) blockers.push("LEAKAGE_DETECTED");
  if (!input.ruleVersionFrozen) blockers.push("RULE_VERSION_NOT_FROZEN");
  if (!input.featureSetFrozen) blockers.push("FEATURE_SET_NOT_FROZEN");
  if (!input.thresholdSetFrozen) blockers.push("THRESHOLD_SET_NOT_FROZEN");
  if (input.outOfSample.eligibleOutcomes < minOos) blockers.push("INSUFFICIENT_OOS_OUTCOMES");
  if (input.regimeCoverageCount < minRegimes) blockers.push("INSUFFICIENT_OOS_REGIME_COVERAGE");
  if (input.outOfSample.unknownOrIncomplete > 0) warnings.push("OOS_HAS_INCOMPLETE_OR_UNKNOWN_OUTCOMES_EXCLUDED_FROM_METRICS");

  const isWr = winRate(input.inSample);
  const oosWr = winRate(input.outOfSample);
  const degradation = isWr == null || oosWr == null ? null : isWr - oosWr;

  if (isWr == null) blockers.push("NO_DETERMINATE_IN_SAMPLE_OUTCOMES");
  if (oosWr == null) blockers.push("NO_DETERMINATE_OOS_OUTCOMES");
  if (degradation != null && degradation > maxDegrade) blockers.push("OOS_PERFORMANCE_DEGRADATION_TOO_LARGE");
  if (degradation != null && degradation < -maxDegrade) {
    warnings.push("OOS_MATERIALLY_BETTER_THAN_IN_SAMPLE_REVIEW_FOR_SAMPLE_OR_REGIME_SHIFT");
  }

  const regimeStrengthMayBeCalibrated = blockers.length === 0;
  const status: OosGateStatus = regimeStrengthMayBeCalibrated
    ? "REGIME_STRENGTH_UNLOCKED"
    : input.outOfSample.eligibleOutcomes >= minOos && input.regimeCoverageCount >= minRegimes
      ? "OOS_READY"
      : "NOT_READY";

  return {
    status,
    blockers,
    warnings,
    inSampleWinRate: isWr,
    outOfSampleWinRate: oosWr,
    degradationPctPoints: degradation,
    regimeStrengthMayBeCalibrated,
    probabilityClaimAllowed: false,
    productionWeightingAllowed: false,
    semantics: "HISTORICAL_OOS_VALIDATION_ONLY",
    ruleVersion: "H1_OOS_CALIBRATION_GUARD_V1",
  };
}
