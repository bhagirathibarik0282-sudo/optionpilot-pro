import { buildPsychologyEvidenceReadiness, type PsychologyEvidenceReadinessResult } from "./psychology-evidence-readiness.ts";
import { isStoredPsychologyRealEvidence, type StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import type { ShadowValidationMetricKey, ShadowValidationRegime } from "./psychology-shadow-validation.ts";

export type PsychologyCalibrationPreparationStatus =
  | "NO_EVIDENCE"
  | "STRUCTURAL_EVIDENCE_BLOCKED"
  | "READY_FOR_CALIBRATION_PROTOCOL_DESIGN";

export type PsychologyCalibrationProtocolItem =
  | "MINIMUM_SAMPLE_CRITERIA_PER_REGIME"
  | "MINIMUM_DENOMINATOR_CRITERIA_PER_METRIC"
  | "CALIBRATION_WINDOW_RULE"
  | "OUT_OF_SAMPLE_SPLIT_RULE"
  | "CONFIDENCE_INTERVAL_METHOD"
  | "MULTIPLE_COMPARISON_CONTROL"
  | "THRESHOLD_SELECTION_OBJECTIVE"
  | "RECALIBRATION_POLICY";

export interface PsychologyCalibrationPreparationResult {
  version: "PSYCHOLOGY_CALIBRATION_PREPARATION_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyCalibrationPreparationStatus;
  readiness: PsychologyEvidenceReadinessResult;
  validEvidenceRecords: number;
  uniqueTradingDates: number;
  earliestTradingDate: string | null;
  latestTradingDate: string | null;
  sourceCounts: {
    REAL_REPLAY: number;
    LIVE_OBSERVATION: number;
  };
  regimeTradeCounts: Record<ShadowValidationRegime, number>;
  metricDenominators: Record<ShadowValidationMetricKey, number>;
  chronologicalPartitionStructurallyPossible: boolean;
  unresolvedProtocolItems: PsychologyCalibrationProtocolItem[];
  calibrationProtocolFrozen: false;
  statisticalSufficiencyEstablished: false;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

const REQUIRED_PROTOCOL_ITEMS: readonly PsychologyCalibrationProtocolItem[] = [
  "MINIMUM_SAMPLE_CRITERIA_PER_REGIME",
  "MINIMUM_DENOMINATOR_CRITERIA_PER_METRIC",
  "CALIBRATION_WINDOW_RULE",
  "OUT_OF_SAMPLE_SPLIT_RULE",
  "CONFIDENCE_INTERVAL_METHOD",
  "MULTIPLE_COMPARISON_CONTROL",
  "THRESHOLD_SELECTION_OBJECTIVE",
  "RECALIBRATION_POLICY",
] as const;

function validTradingDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Prepares accumulated evidence for a future, explicitly frozen calibration protocol.
 * This layer does not invent sample-size rules, split ratios, confidence methods, objectives,
 * metric values, or acceptance thresholds. It only inventories the evidence and reports what
 * still must be preregistered before statistical sufficiency or calibration can be claimed.
 */
export function buildPsychologyCalibrationPreparation(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyCalibrationPreparationResult {
  const readiness = buildPsychologyEvidenceReadiness(rows);
  const validRows = rows.filter(isStoredPsychologyRealEvidence);
  const sourceCounts = {
    REAL_REPLAY: validRows.filter((row) => row.source === "REAL_REPLAY").length,
    LIVE_OBSERVATION: validRows.filter((row) => row.source === "LIVE_OBSERVATION").length,
  };

  const tradingDates = [...new Set(
    validRows
      .map((row) => row.replay.tradingDate)
      .filter(validTradingDate),
  )].sort();

  const blockers: string[] = [];
  if (rows.length === 0) blockers.push("NO_REAL_EVIDENCE_RECORDS");
  if (readiness.status !== "STRUCTURALLY_READY_FOR_THRESHOLD_RESEARCH") {
    blockers.push(`STRUCTURAL_READINESS_BLOCKED:${readiness.status}`);
  }
  if (tradingDates.length < 2) blockers.push("CHRONOLOGICAL_PARTITION_NOT_STRUCTURALLY_POSSIBLE");
  blockers.push("CALIBRATION_PROTOCOL_NOT_FROZEN");
  blockers.push("STATISTICAL_SUFFICIENCY_NOT_ESTABLISHED");
  blockers.push("ACCEPTANCE_THRESHOLDS_NOT_CALIBRATED_OR_FROZEN");

  let status: PsychologyCalibrationPreparationStatus;
  if (rows.length === 0) status = "NO_EVIDENCE";
  else if (readiness.status !== "STRUCTURALLY_READY_FOR_THRESHOLD_RESEARCH") status = "STRUCTURAL_EVIDENCE_BLOCKED";
  else status = "READY_FOR_CALIBRATION_PROTOCOL_DESIGN";

  return {
    version: "PSYCHOLOGY_CALIBRATION_PREPARATION_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status,
    readiness,
    validEvidenceRecords: validRows.length,
    uniqueTradingDates: tradingDates.length,
    earliestTradingDate: tradingDates[0] ?? null,
    latestTradingDate: tradingDates.at(-1) ?? null,
    sourceCounts,
    regimeTradeCounts: { ...readiness.regimeTradeCounts },
    metricDenominators: { ...readiness.metricDenominators },
    chronologicalPartitionStructurallyPossible: tradingDates.length >= 2,
    unresolvedProtocolItems: [...REQUIRED_PROTOCOL_ITEMS],
    calibrationProtocolFrozen: false,
    statisticalSufficiencyEstablished: false,
    acceptanceThresholdsProposed: false,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
