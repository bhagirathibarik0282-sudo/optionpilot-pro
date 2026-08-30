import { evaluatePsychologyCalibrationMetrics } from "./psychology-calibration-metric-evaluation.ts";
import { PSYCHOLOGY_CALIBRATION_PROTOCOL_V1 } from "./psychology-calibration-protocol.ts";
import type { StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import { SHADOW_VALIDATION_METRICS, type ShadowValidationMetricKey } from "./psychology-shadow-validation.ts";

export type PsychologyThresholdResearchPreparationStatus =
  | "CALIBRATION_METRICS_BLOCKED"
  | "READY_FOR_THRESHOLD_RESEARCH";

export interface PsychologyThresholdResearchMetricCard {
  metric: ShadowValidationMetricKey;
  value: number;
  definition: string;
  preferredDirection: "LOWER" | "HIGHER";
  metricFamily: "BINOMIAL_RATE" | "COUNT_PER_TRADE";
  preregisteredUncertaintyMethod: "WILSON_95" | "TRADING_DATE_CLUSTER_BOOTSTRAP_95";
  acceptanceThreshold: null;
  thresholdSelected: false;
  thresholdFrozen: false;
}

export interface PsychologyThresholdResearchPreparationResult {
  version: "PSYCHOLOGY_THRESHOLD_RESEARCH_PREPARATION_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyThresholdResearchPreparationStatus;
  protocolVersion: "PSYCHOLOGY_CALIBRATION_PROTOCOL_V1";
  calibrationMetricEvaluationVersion: "PSYCHOLOGY_CALIBRATION_METRIC_EVALUATION_V1";
  calibrationTradingDateCount: number;
  calibrationRecordCount: number;
  oosTradingDateCount: number;
  oosRecordCount: number;
  metricCards: PsychologyThresholdResearchMetricCard[];
  allTenFrozenMetricsPresent: boolean;
  oosReadForThresholdResearch: false;
  oosUsedForThresholdSelection: false;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

const COUNT_PER_TRADE_METRICS = new Set<ShadowValidationMetricKey>([
  "STATE_FLIPS_PER_TRADE",
  "AVERAGE_UPDATES_PER_TRADE",
]);

/**
 * Prepares calibration-only metric cards for threshold research without selecting any threshold.
 * It preserves the frozen metric definition, preferred direction, and preregistered uncertainty
 * family. OOS observations are never read for threshold research in this stage.
 */
export function preparePsychologyThresholdResearch(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyThresholdResearchPreparationResult {
  const evaluation = evaluatePsychologyCalibrationMetrics(rows);
  const blockers = [...evaluation.blockers];

  if (evaluation.status !== "CALIBRATION_METRICS_READY" || !evaluation.calibrationMetricValues) {
    if (!blockers.includes("CALIBRATION_METRICS_NOT_READY_FOR_THRESHOLD_RESEARCH")) {
      blockers.push("CALIBRATION_METRICS_NOT_READY_FOR_THRESHOLD_RESEARCH");
    }
    return {
      version: "PSYCHOLOGY_THRESHOLD_RESEARCH_PREPARATION_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      status: "CALIBRATION_METRICS_BLOCKED",
      protocolVersion: PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.version,
      calibrationMetricEvaluationVersion: "PSYCHOLOGY_CALIBRATION_METRIC_EVALUATION_V1",
      calibrationTradingDateCount: evaluation.calibrationTradingDates.length,
      calibrationRecordCount: evaluation.calibrationRecordCount,
      oosTradingDateCount: evaluation.oosTradingDateCount,
      oosRecordCount: evaluation.oosRecordCount,
      metricCards: [],
      allTenFrozenMetricsPresent: false,
      oosReadForThresholdResearch: false,
      oosUsedForThresholdSelection: false,
      acceptanceThresholdsProposed: false,
      acceptanceThresholdsFrozen: false,
      promotionEligible: false,
      blockers,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const metricCards = (Object.keys(SHADOW_VALIDATION_METRICS) as ShadowValidationMetricKey[]).map((metric) => {
    const value = evaluation.calibrationMetricValues![metric];
    if (value == null || !Number.isFinite(value)) {
      blockers.push(`CALIBRATION_METRIC_NOT_FINITE:${metric}`);
      return null;
    }
    const registry = SHADOW_VALIDATION_METRICS[metric];
    const metricFamily = COUNT_PER_TRADE_METRICS.has(metric) ? "COUNT_PER_TRADE" : "BINOMIAL_RATE";
    return {
      metric,
      value,
      definition: registry.definition,
      preferredDirection: registry.preferredDirection,
      metricFamily,
      preregisteredUncertaintyMethod: metricFamily === "COUNT_PER_TRADE"
        ? PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.uncertainty.countPerTradeInterval
        : PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.uncertainty.binomialRateInterval,
      acceptanceThreshold: null,
      thresholdSelected: false,
      thresholdFrozen: false,
    } satisfies PsychologyThresholdResearchMetricCard;
  }).filter((card): card is PsychologyThresholdResearchMetricCard => card !== null);

  const allTenFrozenMetricsPresent = metricCards.length === Object.keys(SHADOW_VALIDATION_METRICS).length;
  if (!allTenFrozenMetricsPresent) blockers.push("NOT_ALL_10_FROZEN_METRICS_PRESENT");

  const ready = blockers.length === 0;
  return {
    version: "PSYCHOLOGY_THRESHOLD_RESEARCH_PREPARATION_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: ready ? "READY_FOR_THRESHOLD_RESEARCH" : "CALIBRATION_METRICS_BLOCKED",
    protocolVersion: PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.version,
    calibrationMetricEvaluationVersion: "PSYCHOLOGY_CALIBRATION_METRIC_EVALUATION_V1",
    calibrationTradingDateCount: evaluation.calibrationTradingDates.length,
    calibrationRecordCount: evaluation.calibrationRecordCount,
    oosTradingDateCount: evaluation.oosTradingDateCount,
    oosRecordCount: evaluation.oosRecordCount,
    metricCards: ready ? metricCards : [],
    allTenFrozenMetricsPresent: ready && allTenFrozenMetricsPresent,
    oosReadForThresholdResearch: false,
    oosUsedForThresholdSelection: false,
    acceptanceThresholdsProposed: false,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
