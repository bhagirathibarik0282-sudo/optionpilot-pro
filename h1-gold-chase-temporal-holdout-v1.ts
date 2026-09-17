import {
  type H1GoldChaseCalibrationSample,
} from "./h1-gold-chase-calibration-dataset-v1.js";
import {
  analyzeH1GoldChaseDescriptiveCohorts,
  type H1GoldChaseDescriptiveCohortResult,
} from "./h1-gold-chase-descriptive-cohort-v1.js";

export const H1_GOLD_CHASE_TEMPORAL_HOLDOUT_V1 = "H1_GOLD_CHASE_TEMPORAL_HOLDOUT_V1" as const;

export type H1GoldChaseTemporalHoldoutState = "EMPTY" | "BLOCKED" | "PARTITION_READY";

export interface H1GoldChaseTemporalHoldoutResult {
  version: typeof H1_GOLD_CHASE_TEMPORAL_HOLDOUT_V1;
  state: H1GoldChaseTemporalHoldoutState;
  inputCount: number;
  oosStartTradingDate: string | null;
  calibrationTradingDates: string[];
  oosTradingDates: string[];
  calibrationSampleCount: number;
  oosSampleCount: number;
  sameTradingDateCrossPartition: false;
  chronologicalOrderVerified: boolean;
  calibration: H1GoldChaseDescriptiveCohortResult | null;
  oos: H1GoldChaseDescriptiveCohortResult | null;
  blockers: string[];
  thresholdPolicy: null;
  classificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  heldOutPartitionDefined: boolean;
  heldOutPerformancePolicyDefined: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  oosUntouchedByCalibrationPolicy: true;
  failClosed: true;
  businessUse: "STRUCTURAL_TEMPORAL_HOLDOUT_ONLY_NOT_CHASE_CLASSIFICATION_NOT_GOLD_AUTHORITY";
  semantics: "CALLER_SUPPLIED_TRADING_DATE_CUTOFF_EXACT_DATE_GROUPED_HOLDOUT_NO_THRESHOLD_NO_SAMPLE_SUFFICIENCY_NO_PRODUCTION_AUTHORITY";
}

const SEMANTICS = "CALLER_SUPPLIED_TRADING_DATE_CUTOFF_EXACT_DATE_GROUPED_HOLDOUT_NO_THRESHOLD_NO_SAMPLE_SUFFICIENCY_NO_PRODUCTION_AUTHORITY" as const;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function validTradingDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function tradingDateIst(observedAtMs: number): string {
  return new Date(observedAtMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function base(
  state: H1GoldChaseTemporalHoldoutState,
  inputCount: number,
  oosStartTradingDate: string | null,
  blockers: string[],
  fields: Partial<Pick<
    H1GoldChaseTemporalHoldoutResult,
    | "calibrationTradingDates"
    | "oosTradingDates"
    | "calibrationSampleCount"
    | "oosSampleCount"
    | "chronologicalOrderVerified"
    | "calibration"
    | "oos"
  >> = {},
): H1GoldChaseTemporalHoldoutResult {
  return {
    version: H1_GOLD_CHASE_TEMPORAL_HOLDOUT_V1,
    state,
    inputCount,
    oosStartTradingDate,
    calibrationTradingDates: fields.calibrationTradingDates ?? [],
    oosTradingDates: fields.oosTradingDates ?? [],
    calibrationSampleCount: fields.calibrationSampleCount ?? 0,
    oosSampleCount: fields.oosSampleCount ?? 0,
    sameTradingDateCrossPartition: false,
    chronologicalOrderVerified: fields.chronologicalOrderVerified ?? false,
    calibration: fields.calibration ?? null,
    oos: fields.oos ?? null,
    blockers: unique(blockers),
    thresholdPolicy: null,
    classificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    heldOutPartitionDefined: state === "PARTITION_READY",
    heldOutPerformancePolicyDefined: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    oosUntouchedByCalibrationPolicy: true,
    failClosed: true,
    businessUse: "STRUCTURAL_TEMPORAL_HOLDOUT_ONLY_NOT_CHASE_CLASSIFICATION_NOT_GOLD_AUTHORITY",
    semantics: SEMANTICS,
  };
}

/**
 * Creates a structural chronological holdout for complete immutable chase samples.
 *
 * The cutoff is caller supplied. This module deliberately invents neither a split
 * fraction nor a minimum sample count. Every IST trading date is kept entirely on
 * one side of the boundary, and both sides are revalidated independently with the
 * threshold-free descriptive cohort analyzer.
 *
 * PARTITION_READY means only that the anti-leakage split is structurally valid.
 * It does not mean there is enough evidence to define CHASE / NOT_CHASE, that any
 * threshold has been validated, or that Gold/selector/Telegram/execution authority
 * has been earned.
 */
export function buildH1GoldChaseTemporalHoldout(
  input: ReadonlyArray<H1GoldChaseCalibrationSample | null | undefined>,
  oosStartTradingDate: string,
): H1GoldChaseTemporalHoldoutResult {
  const inputCount = Array.isArray(input) ? input.length : 0;

  if (!validTradingDate(oosStartTradingDate)) {
    return base("BLOCKED", inputCount, null, ["VALID_OOS_START_TRADING_DATE_REQUIRED"]);
  }

  if (!Array.isArray(input) || input.length === 0) {
    return base("EMPTY", 0, oosStartTradingDate, []);
  }

  const all = analyzeH1GoldChaseDescriptiveCohorts(input);
  if (all.state !== "READY") {
    return base(
      "BLOCKED",
      input.length,
      oosStartTradingDate,
      ["VALID_COMPLETE_IMMUTABLE_INPUT_REQUIRED", ...all.blockers.map((code) => `INPUT_${code}`)],
    );
  }

  const samples = input as ReadonlyArray<H1GoldChaseCalibrationSample>;
  const calibrationSamples: H1GoldChaseCalibrationSample[] = [];
  const oosSamples: H1GoldChaseCalibrationSample[] = [];

  for (const sample of samples) {
    const tradingDate = tradingDateIst(sample.t0ObservedAtMs!);
    if (tradingDate < oosStartTradingDate) calibrationSamples.push(sample);
    else oosSamples.push(sample);
  }

  const calibrationTradingDates = [...new Set(calibrationSamples.map((sample) => tradingDateIst(sample.t0ObservedAtMs!)))].sort();
  const oosTradingDates = [...new Set(oosSamples.map((sample) => tradingDateIst(sample.t0ObservedAtMs!)))].sort();
  const blockers: string[] = [];

  if (calibrationSamples.length === 0) blockers.push("CALIBRATION_SIDE_EMPTY");
  if (oosSamples.length === 0) blockers.push("OOS_SIDE_EMPTY");

  const oosDateSet = new Set(oosTradingDates);
  if (calibrationTradingDates.some((date) => oosDateSet.has(date))) {
    blockers.push("SAME_TRADING_DATE_CROSSES_PARTITIONS");
  }

  const chronologicalOrderVerified =
    calibrationTradingDates.length > 0
    && oosTradingDates.length > 0
    && calibrationTradingDates.at(-1)! < oosTradingDates[0]!;
  if (!chronologicalOrderVerified) blockers.push("CHRONOLOGICAL_ORDER_NOT_VERIFIED");

  if (blockers.length > 0) {
    return base("BLOCKED", input.length, oosStartTradingDate, blockers, {
      calibrationSampleCount: calibrationSamples.length,
      oosSampleCount: oosSamples.length,
    });
  }

  const calibration = analyzeH1GoldChaseDescriptiveCohorts(calibrationSamples);
  const oos = analyzeH1GoldChaseDescriptiveCohorts(oosSamples);
  if (calibration.state !== "READY" || oos.state !== "READY") {
    return base(
      "BLOCKED",
      input.length,
      oosStartTradingDate,
      [
        "PARTITION_REVALIDATION_FAILED",
        ...calibration.blockers.map((code) => `CALIBRATION_${code}`),
        ...oos.blockers.map((code) => `OOS_${code}`),
      ],
      {
        calibrationSampleCount: calibrationSamples.length,
        oosSampleCount: oosSamples.length,
      },
    );
  }

  return base("PARTITION_READY", input.length, oosStartTradingDate, [], {
    calibrationTradingDates,
    oosTradingDates,
    calibrationSampleCount: calibrationSamples.length,
    oosSampleCount: oosSamples.length,
    chronologicalOrderVerified,
    calibration,
    oos,
  });
}
