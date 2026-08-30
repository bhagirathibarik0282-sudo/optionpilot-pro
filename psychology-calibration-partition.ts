import { buildPsychologyCalibrationPreparation } from "./psychology-calibration-preparation.ts";
import { evaluatePsychologyCalibrationProtocolGate, PSYCHOLOGY_CALIBRATION_PROTOCOL_V1 } from "./psychology-calibration-protocol.ts";
import { isStoredPsychologyRealEvidence, type StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";

export type PsychologyCalibrationPartitionStatus =
  | "PROTOCOL_GATE_BLOCKED"
  | "PARTITION_READY";

export interface PsychologyCalibrationPartitionResult {
  version: "PSYCHOLOGY_CALIBRATION_PARTITION_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyCalibrationPartitionStatus;
  protocolVersion: "PSYCHOLOGY_CALIBRATION_PROTOCOL_V1";
  calibrationTradingDates: string[];
  oosTradingDates: string[];
  calibrationRecords: StoredPsychologyRealEvidence[];
  oosRecords: StoredPsychologyRealEvidence[];
  calibrationTradingDateCount: number;
  oosTradingDateCount: number;
  sameDateCrossPartition: false;
  chronologicalOrderVerified: boolean;
  oosUntouched: true;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function validTradingDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Deterministic date-grouped chronological partition. It never splits one trading date across
 * calibration and OOS, and it creates no threshold or promotion authority.
 */
export function buildPsychologyCalibrationPartition(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyCalibrationPartitionResult {
  const protocol = PSYCHOLOGY_CALIBRATION_PROTOCOL_V1;
  const preparation = buildPsychologyCalibrationPreparation(rows);
  const gate = evaluatePsychologyCalibrationProtocolGate(preparation);
  const blockers = [...gate.blockers];

  const validRows = rows.filter(isStoredPsychologyRealEvidence);
  const invalidTradingDates = validRows.filter((row) => !validTradingDate(row.replay.tradingDate));
  if (invalidTradingDates.length > 0) blockers.push(`INVALID_TRADING_DATES:${invalidTradingDates.length}`);

  if (gate.status !== "READY_FOR_CALIBRATION_PARTITION" || invalidTradingDates.length > 0) {
    return {
      version: "PSYCHOLOGY_CALIBRATION_PARTITION_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      status: "PROTOCOL_GATE_BLOCKED",
      protocolVersion: protocol.version,
      calibrationTradingDates: [],
      oosTradingDates: [],
      calibrationRecords: [],
      oosRecords: [],
      calibrationTradingDateCount: 0,
      oosTradingDateCount: 0,
      sameDateCrossPartition: false,
      chronologicalOrderVerified: false,
      oosUntouched: true,
      acceptanceThresholdsProposed: false,
      acceptanceThresholdsFrozen: false,
      promotionEligible: false,
      blockers,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const dates = [...new Set(validRows.map((row) => row.replay.tradingDate as string))].sort();
  const calibrationCount = Math.floor(dates.length * protocol.chronologicalSplit.calibrationFraction);
  const calibrationTradingDates = dates.slice(0, calibrationCount);
  const oosTradingDates = dates.slice(calibrationCount);
  const calibrationDateSet = new Set(calibrationTradingDates);
  const oosDateSet = new Set(oosTradingDates);
  const calibrationRecords = validRows.filter((row) => calibrationDateSet.has(row.replay.tradingDate as string));
  const oosRecords = validRows.filter((row) => oosDateSet.has(row.replay.tradingDate as string));

  const sameDateCrossPartition = calibrationTradingDates.some((date) => oosDateSet.has(date));
  const chronologicalOrderVerified =
    calibrationTradingDates.length > 0
    && oosTradingDates.length > 0
    && calibrationTradingDates.at(-1)! < oosTradingDates[0]!;

  if (sameDateCrossPartition) blockers.push("SAME_TRADING_DATE_CROSSES_PARTITIONS");
  if (!chronologicalOrderVerified) blockers.push("CHRONOLOGICAL_ORDER_NOT_VERIFIED");
  if (calibrationTradingDates.length < protocol.chronologicalSplit.minimumCalibrationTradingDates) {
    blockers.push("CALIBRATION_DATE_MINIMUM_NOT_MET");
  }
  if (oosTradingDates.length < protocol.chronologicalSplit.minimumOosTradingDates) {
    blockers.push("OOS_DATE_MINIMUM_NOT_MET");
  }

  const ready = blockers.length === 0;
  return {
    version: "PSYCHOLOGY_CALIBRATION_PARTITION_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: ready ? "PARTITION_READY" : "PROTOCOL_GATE_BLOCKED",
    protocolVersion: protocol.version,
    calibrationTradingDates: ready ? calibrationTradingDates : [],
    oosTradingDates: ready ? oosTradingDates : [],
    calibrationRecords: ready ? calibrationRecords : [],
    oosRecords: ready ? oosRecords : [],
    calibrationTradingDateCount: ready ? calibrationTradingDates.length : 0,
    oosTradingDateCount: ready ? oosTradingDates.length : 0,
    sameDateCrossPartition: false,
    chronologicalOrderVerified: ready && chronologicalOrderVerified,
    oosUntouched: true,
    acceptanceThresholdsProposed: false,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
