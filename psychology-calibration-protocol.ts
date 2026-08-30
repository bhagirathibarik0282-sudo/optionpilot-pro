import type { PsychologyCalibrationPreparationResult } from "./psychology-calibration-preparation.ts";
import { SHADOW_VALIDATION_METRICS, type ShadowValidationMetricKey, type ShadowValidationRegime } from "./psychology-shadow-validation.ts";

export const PSYCHOLOGY_CALIBRATION_PROTOCOL_V1 = {
  version: "PSYCHOLOGY_CALIBRATION_PROTOCOL_V1",
  semantics: "RESEARCH_SHADOW_ONLY",
  governance: {
    note: "These are preregistered research-governance criteria for OptionPilot psychology validation; they are not universal statistical truths or trading-performance claims.",
    protocolFrozen: true,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
  },
  sampleCriteria: {
    minimumUniqueTradingDates: 67,
    minimumCompletedTrades: 200,
    minimumTradesPerMandatoryRegime: 30,
    minimumDenominatorPerMetric: 100,
  },
  chronologicalSplit: {
    unit: "TRADING_DATE",
    method: "EARLIEST_CALIBRATION_LATEST_OOS",
    calibrationFraction: 0.7,
    oosFraction: 0.3,
    minimumCalibrationTradingDates: 40,
    minimumOosTradingDates: 20,
    sameDateCannotCrossPartitions: true,
    oosMayTuneThresholds: false,
  },
  uncertainty: {
    familywiseAlpha: 0.05,
    binomialRateInterval: "WILSON_95",
    countPerTradeInterval: "TRADING_DATE_CLUSTER_BOOTSTRAP_95",
    clusterBootstrapReplicates: 2000,
    clusterBootstrapSeed: 20260830,
  },
  multipleComparisonControl: {
    method: "HOLM_BONFERRONI",
    family: "ALL_10_FROZEN_METRICS",
    familywiseAlpha: 0.05,
  },
  thresholdSelectionObjective: {
    method: "CALIBRATION_ONLY_DIRECTIONAL_GATES",
    weightedCompositeScoreAllowed: false,
    allFrozenMetricsRequired: true,
    oosUsedForThresholdSelection: false,
    rule: "Threshold candidates may be proposed from the calibration partition only. The untouched OOS partition is used only to test the frozen candidate thresholds. No metric may be hidden, dropped, or reweighted after OOS inspection.",
  },
  recalibrationPolicy: {
    automaticLiveRetuningAllowed: false,
    oosFailureMayRetuneSameHoldout: false,
    minimumNewTradingDatesBeforeNewCalibration: 60,
    protocolChangeRequiresNewVersion: true,
    thresholdChangeRequiresNewVersion: true,
    newLaterHoldoutRequiredAfterThresholdChange: true,
  },
  authority: {
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  },
} as const;

export type PsychologyCalibrationProtocolGateStatus =
  | "PREPARATION_BLOCKED"
  | "SAMPLE_INSUFFICIENT"
  | "READY_FOR_CALIBRATION_PARTITION";

export interface PsychologyCalibrationProtocolGateResult {
  version: "PSYCHOLOGY_CALIBRATION_PROTOCOL_GATE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyCalibrationProtocolGateStatus;
  protocolVersion: "PSYCHOLOGY_CALIBRATION_PROTOCOL_V1";
  protocolFrozen: true;
  uniqueTradingDates: number;
  completedTrades: number;
  requiredUniqueTradingDates: number;
  requiredCompletedTrades: number;
  regimeDeficits: Partial<Record<ShadowValidationRegime, number>>;
  metricDenominatorDeficits: Partial<Record<ShadowValidationMetricKey, number>>;
  chronologicalPartitionEligible: boolean;
  statisticalSufficiencyEstablished: boolean;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

export function evaluatePsychologyCalibrationProtocolGate(
  preparation: PsychologyCalibrationPreparationResult,
): PsychologyCalibrationProtocolGateResult {
  const protocol = PSYCHOLOGY_CALIBRATION_PROTOCOL_V1;
  const blockers: string[] = [];
  const regimeDeficits: Partial<Record<ShadowValidationRegime, number>> = {};
  const metricDenominatorDeficits: Partial<Record<ShadowValidationMetricKey, number>> = {};

  if (preparation.status !== "READY_FOR_CALIBRATION_PROTOCOL_DESIGN") {
    blockers.push(`PREPARATION_NOT_READY:${preparation.status}`);
  }

  if (preparation.uniqueTradingDates < protocol.sampleCriteria.minimumUniqueTradingDates) {
    blockers.push(`TRADING_DATES_BELOW_MINIMUM:${preparation.uniqueTradingDates}/${protocol.sampleCriteria.minimumUniqueTradingDates}`);
  }

  const completedTrades = preparation.readiness.completedTrades;
  if (completedTrades < protocol.sampleCriteria.minimumCompletedTrades) {
    blockers.push(`COMPLETED_TRADES_BELOW_MINIMUM:${completedTrades}/${protocol.sampleCriteria.minimumCompletedTrades}`);
  }

  for (const [regime, count] of Object.entries(preparation.regimeTradeCounts) as [ShadowValidationRegime, number][]) {
    if (count < protocol.sampleCriteria.minimumTradesPerMandatoryRegime) {
      regimeDeficits[regime] = protocol.sampleCriteria.minimumTradesPerMandatoryRegime - count;
    }
  }
  if (Object.keys(regimeDeficits).length > 0) blockers.push("REGIME_SAMPLE_CRITERIA_NOT_MET");

  for (const key of Object.keys(SHADOW_VALIDATION_METRICS) as ShadowValidationMetricKey[]) {
    const count = preparation.metricDenominators[key] ?? 0;
    if (count < protocol.sampleCriteria.minimumDenominatorPerMetric) {
      metricDenominatorDeficits[key] = protocol.sampleCriteria.minimumDenominatorPerMetric - count;
    }
  }
  if (Object.keys(metricDenominatorDeficits).length > 0) blockers.push("METRIC_DENOMINATOR_CRITERIA_NOT_MET");

  const estimatedCalibrationDates = Math.floor(preparation.uniqueTradingDates * protocol.chronologicalSplit.calibrationFraction);
  const estimatedOosDates = preparation.uniqueTradingDates - estimatedCalibrationDates;
  const chronologicalPartitionEligible =
    preparation.chronologicalPartitionStructurallyPossible
    && estimatedCalibrationDates >= protocol.chronologicalSplit.minimumCalibrationTradingDates
    && estimatedOosDates >= protocol.chronologicalSplit.minimumOosTradingDates;
  if (!chronologicalPartitionEligible) blockers.push("CHRONOLOGICAL_PARTITION_MINIMUMS_NOT_MET");

  const preparationBlocked = preparation.status !== "READY_FOR_CALIBRATION_PROTOCOL_DESIGN";
  const sampleInsufficient = blockers.length > 0;
  const status: PsychologyCalibrationProtocolGateStatus = preparationBlocked
    ? "PREPARATION_BLOCKED"
    : sampleInsufficient
      ? "SAMPLE_INSUFFICIENT"
      : "READY_FOR_CALIBRATION_PARTITION";

  // Meeting preregistered minima establishes sufficiency under this frozen internal protocol only;
  // it is not proof that the psychology system is effective and is not permission for live promotion.
  const statisticalSufficiencyEstablished = status === "READY_FOR_CALIBRATION_PARTITION";

  return {
    version: "PSYCHOLOGY_CALIBRATION_PROTOCOL_GATE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status,
    protocolVersion: protocol.version,
    protocolFrozen: true,
    uniqueTradingDates: preparation.uniqueTradingDates,
    completedTrades,
    requiredUniqueTradingDates: protocol.sampleCriteria.minimumUniqueTradingDates,
    requiredCompletedTrades: protocol.sampleCriteria.minimumCompletedTrades,
    regimeDeficits,
    metricDenominatorDeficits,
    chronologicalPartitionEligible,
    statisticalSufficiencyEstablished,
    acceptanceThresholdsProposed: false,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
