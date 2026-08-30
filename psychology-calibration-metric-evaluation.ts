import { buildPsychologyCalibrationPartition, type PsychologyCalibrationPartitionResult } from "./psychology-calibration-partition.ts";
import { buildPsychologyRealEvidenceRunnerResult } from "./psychology-real-evidence-runner.ts";
import type { StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import type { ShadowValidationMetricKey } from "./psychology-shadow-validation.ts";

export type PsychologyCalibrationMetricEvaluationStatus =
  | "PARTITION_BLOCKED"
  | "CALIBRATION_EVIDENCE_BLOCKED"
  | "CALIBRATION_METRICS_READY";

export interface PsychologyCalibrationMetricEvaluationResult {
  version: "PSYCHOLOGY_CALIBRATION_METRIC_EVALUATION_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyCalibrationMetricEvaluationStatus;
  partitionStatus: PsychologyCalibrationPartitionResult["status"];
  protocolVersion: "PSYCHOLOGY_CALIBRATION_PROTOCOL_V1";
  calibrationTradingDates: string[];
  calibrationRecordCount: number;
  oosTradingDateCount: number;
  oosRecordCount: number;
  calibrationMetricValues: Record<ShadowValidationMetricKey, number | null> | null;
  nullCalibrationMetrics: ShadowValidationMetricKey[];
  calibrationRejectedRecords: number;
  calibrationRegimeProvenanceVerified: boolean;
  oosReadForMetricEvaluation: false;
  oosUsedForThresholdSelection: false;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

/**
 * Calculates the already-frozen psychology metrics on the calibration partition only.
 * The OOS partition is intentionally reduced to counts/date metadata and is never passed to
 * the metric runner. This stage does not select, propose, or freeze acceptance thresholds.
 */
export function evaluatePsychologyCalibrationMetrics(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyCalibrationMetricEvaluationResult {
  const partition = buildPsychologyCalibrationPartition(rows);
  const blockers = [...partition.blockers];

  if (partition.status !== "PARTITION_READY") {
    return {
      version: "PSYCHOLOGY_CALIBRATION_METRIC_EVALUATION_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      status: "PARTITION_BLOCKED",
      partitionStatus: partition.status,
      protocolVersion: partition.protocolVersion,
      calibrationTradingDates: [],
      calibrationRecordCount: 0,
      oosTradingDateCount: 0,
      oosRecordCount: 0,
      calibrationMetricValues: null,
      nullCalibrationMetrics: [],
      calibrationRejectedRecords: 0,
      calibrationRegimeProvenanceVerified: false,
      oosReadForMetricEvaluation: false,
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

  // Deliberately evaluate only calibrationRecords. OOS records are not supplied to the runner.
  const calibrationRunner = buildPsychologyRealEvidenceRunnerResult(partition.calibrationRecords);
  if (calibrationRunner.ledger.rejectedInputs > 0) {
    blockers.push(`CALIBRATION_RECORDS_REJECTED:${calibrationRunner.ledger.rejectedInputs}`);
  }
  if (!calibrationRunner.regimeTagProvenanceVerified) {
    blockers.push("CALIBRATION_REGIME_PROVENANCE_NOT_VERIFIED");
  }
  if (!calibrationRunner.ledger.metricValues) {
    blockers.push("CALIBRATION_METRICS_UNAVAILABLE");
  }
  if (calibrationRunner.ledger.nullMetrics.length > 0) {
    blockers.push(`NULL_CALIBRATION_METRICS:${calibrationRunner.ledger.nullMetrics.join(",")}`);
  }

  const ready = blockers.length === 0;
  return {
    version: "PSYCHOLOGY_CALIBRATION_METRIC_EVALUATION_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: ready ? "CALIBRATION_METRICS_READY" : "CALIBRATION_EVIDENCE_BLOCKED",
    partitionStatus: partition.status,
    protocolVersion: partition.protocolVersion,
    calibrationTradingDates: [...partition.calibrationTradingDates],
    calibrationRecordCount: partition.calibrationRecords.length,
    oosTradingDateCount: partition.oosTradingDateCount,
    oosRecordCount: partition.oosRecords.length,
    calibrationMetricValues: calibrationRunner.ledger.metricValues
      ? { ...calibrationRunner.ledger.metricValues }
      : null,
    nullCalibrationMetrics: [...calibrationRunner.ledger.nullMetrics],
    calibrationRejectedRecords: calibrationRunner.ledger.rejectedInputs,
    calibrationRegimeProvenanceVerified: calibrationRunner.regimeTagProvenanceVerified,
    oosReadForMetricEvaluation: false,
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
