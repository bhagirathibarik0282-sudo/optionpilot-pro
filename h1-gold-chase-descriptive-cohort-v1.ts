import {
  H1_GOLD_CHASE_CALIBRATION_DATASET_V1,
  type H1GoldChaseCalibrationOutcome,
  type H1GoldChaseCalibrationSample,
} from "./h1-gold-chase-calibration-dataset-v1.js";

export const H1_GOLD_CHASE_DESCRIPTIVE_COHORT_V1 = "H1_GOLD_CHASE_DESCRIPTIVE_COHORT_V1" as const;

export interface H1GoldDescriptiveDistribution {
  n: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  mean: number | null;
  p75: number | null;
  max: number | null;
}

export interface H1GoldChaseCohortMetrics {
  t0ReturnFromFirstPct: H1GoldDescriptiveDistribution;
  t0DistanceFromHighPct: H1GoldDescriptiveDistribution;
  t0RangePosition: H1GoldDescriptiveDistribution;
  t0MinutesSinceSessionOpen: H1GoldDescriptiveDistribution;
  t3ReturnPct: H1GoldDescriptiveDistribution;
  t6ReturnPct: H1GoldDescriptiveDistribution;
  t15ReturnPct: H1GoldDescriptiveDistribution;
  t30ReturnPct: H1GoldDescriptiveDistribution;
  mfePct: H1GoldDescriptiveDistribution;
  maePct: H1GoldDescriptiveDistribution;
}

export interface H1GoldChaseDescriptiveCohortRow {
  key: string;
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  dte: number;
  marketState: string;
  opportunityStage: string;
  sellerStressState: string;
  sampleCount: number;
  metrics: H1GoldChaseCohortMetrics;
}

export interface H1GoldChaseDescriptiveCohortResult {
  version: typeof H1_GOLD_CHASE_DESCRIPTIVE_COHORT_V1;
  state: "EMPTY" | "READY" | "BLOCKED";
  inputCount: number;
  acceptedSampleCount: number;
  rejectedSampleCount: number;
  blockers: string[];
  overall: H1GoldChaseCohortMetrics | null;
  cohorts: H1GoldChaseDescriptiveCohortRow[];
  groupingPolicy: "EXACT_SYMBOL_SIDE_DTE_MARKET_STATE_OPPORTUNITY_STAGE_SELLER_STRESS_NO_BUCKET_THRESHOLDS";
  chaseLabel: null;
  outcomeLabel: null;
  thresholdPolicy: null;
  classificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  heldOutPolicyDefined: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  businessUse: "DESCRIPTIVE_CHASE_CALIBRATION_COHORTS_ONLY_NOT_CLASSIFICATION_NOT_GOLD_AUTHORITY";
  semantics: "COMPLETE_IMMUTABLE_FORWARD_SAMPLES_GROUPED_BY_EXACT_T0_CONTEXT_WITH_DESCRIPTIVE_DISTRIBUTIONS_ONLY_NO_THRESHOLD_NO_LABEL_NO_PRODUCTION_AUTHORITY";
}

const SEMANTICS = "COMPLETE_IMMUTABLE_FORWARD_SAMPLES_GROUPED_BY_EXACT_T0_CONTEXT_WITH_DESCRIPTIVE_DISTRIBUTIONS_ONLY_NO_THRESHOLD_NO_LABEL_NO_PRODUCTION_AUTHORITY" as const;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function distribution(values: Array<number | null | undefined>): H1GoldDescriptiveDistribution {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (valid.length === 0) return { n: 0, min: null, p25: null, median: null, mean: null, p75: null, max: null };
  return {
    n: valid.length,
    min: round4(valid[0]),
    p25: round4(quantile(valid, 0.25)!),
    median: round4(quantile(valid, 0.5)!),
    mean: round4(valid.reduce((sum, value) => sum + value, 0) / valid.length),
    p75: round4(quantile(valid, 0.75)!),
    max: round4(valid[valid.length - 1]),
  };
}

function outcome(sample: H1GoldChaseCalibrationSample, window: H1GoldChaseCalibrationOutcome["window"]): number | null {
  return sample.outcomes.find((row) => row.window === window)?.returnPct ?? null;
}

function sampleBlockers(sample: H1GoldChaseCalibrationSample | null | undefined, index: number): string[] {
  const prefix = `SAMPLE_${index}`;
  if (!sample) return [`${prefix}:MISSING`];
  const blockers: string[] = [];
  if (sample.version !== H1_GOLD_CHASE_CALIBRATION_DATASET_V1) blockers.push(`${prefix}:INVALID_VERSION`);
  if (sample.state !== "COMPLETE_SAMPLE" || !sample.readyForDataset) blockers.push(`${prefix}:NOT_COMPLETE`);
  if (sample.blockers.length > 0) blockers.push(`${prefix}:HAS_BLOCKERS`);
  if (!sample.snapshotId?.trim() || !sample.decisionId?.trim() || !sample.candidateKey?.trim()) blockers.push(`${prefix}:IDENTITY_REQUIRED`);
  if (!Number.isInteger(sample.dte) || Number(sample.dte) < 0) blockers.push(`${prefix}:VALID_DTE_REQUIRED`);
  if (!sample.t0Features) blockers.push(`${prefix}:T0_FEATURES_REQUIRED`);
  if (sample.outcomes.length !== 4 || ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"].some((window) => !sample.outcomes.some((row) => row.window === window))) blockers.push(`${prefix}:ALL_WINDOWS_REQUIRED`);
  if (sample.missingWindows.length > 0) blockers.push(`${prefix}:MISSING_WINDOWS_NOT_ALLOWED`);
  if (sample.chaseLabel !== null || sample.outcomeLabel !== null || sample.thresholdPolicy !== null) blockers.push(`${prefix}:LABEL_OR_THRESHOLD_NOT_ALLOWED`);
  if (sample.classificationPolicyDefined || sample.sampleSufficiencyPolicyDefined) blockers.push(`${prefix}:POLICY_MUST_BE_UNDEFINED`);
  if (sample.productionImpact !== "NONE" || sample.affectsGoldEligibility || sample.affectsSelector || sample.affectsTelegram || sample.affectsExecution || sample.grantsPromotionAuthority || sample.createsOrders) blockers.push(`${prefix}:AUTHORITY_NOT_ALLOWED`);
  return blockers;
}

function identity(sample: H1GoldChaseCalibrationSample): string {
  return `${sample.snapshotId}|${sample.decisionId}|${sample.candidateKey}|${sample.t0ObservedAtMs}`;
}

function context(value: string | null): string {
  const normalized = value?.trim();
  return normalized || "UNSPECIFIED";
}

function cohortKey(sample: H1GoldChaseCalibrationSample): string {
  return [
    sample.symbol,
    sample.side,
    `DTE_${sample.dte}`,
    context(sample.t0MarketState),
    context(sample.t0OpportunityStage),
    context(sample.t0SellerStressState),
  ].join("|");
}

function metrics(samples: H1GoldChaseCalibrationSample[]): H1GoldChaseCohortMetrics {
  return {
    t0ReturnFromFirstPct: distribution(samples.map((sample) => sample.t0Features?.returnFromFirstPct)),
    t0DistanceFromHighPct: distribution(samples.map((sample) => sample.t0Features?.distanceFromHighPct)),
    t0RangePosition: distribution(samples.map((sample) => sample.t0Features?.rangePosition)),
    t0MinutesSinceSessionOpen: distribution(samples.map((sample) => sample.t0Features?.minutesSinceSessionOpen)),
    t3ReturnPct: distribution(samples.map((sample) => outcome(sample, "T_PLUS_3M"))),
    t6ReturnPct: distribution(samples.map((sample) => outcome(sample, "T_PLUS_6M"))),
    t15ReturnPct: distribution(samples.map((sample) => outcome(sample, "T_PLUS_15M"))),
    t30ReturnPct: distribution(samples.map((sample) => outcome(sample, "T_PLUS_30M"))),
    mfePct: distribution(samples.map((sample) => sample.mfePct)),
    maePct: distribution(samples.map((sample) => sample.maePct)),
  };
}

function base(
  state: H1GoldChaseDescriptiveCohortResult["state"],
  inputCount: number,
  accepted: H1GoldChaseCalibrationSample[],
  blockers: string[],
  cohorts: H1GoldChaseDescriptiveCohortRow[] = [],
): H1GoldChaseDescriptiveCohortResult {
  return {
    version: H1_GOLD_CHASE_DESCRIPTIVE_COHORT_V1,
    state,
    inputCount,
    acceptedSampleCount: accepted.length,
    rejectedSampleCount: inputCount - accepted.length,
    blockers: [...new Set(blockers)],
    overall: accepted.length > 0 ? metrics(accepted) : null,
    cohorts,
    groupingPolicy: "EXACT_SYMBOL_SIDE_DTE_MARKET_STATE_OPPORTUNITY_STAGE_SELLER_STRESS_NO_BUCKET_THRESHOLDS",
    chaseLabel: null,
    outcomeLabel: null,
    thresholdPolicy: null,
    classificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    heldOutPolicyDefined: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    businessUse: "DESCRIPTIVE_CHASE_CALIBRATION_COHORTS_ONLY_NOT_CLASSIFICATION_NOT_GOLD_AUTHORITY",
    semantics: SEMANTICS,
  };
}

/**
 * Threshold-free descriptive analysis for immutable complete calibration samples.
 * It deliberately refuses duplicate immutable identities so one event cannot be
 * double-weighted. Exact DTE/context values are grouped without inventing bins.
 */
export function analyzeH1GoldChaseDescriptiveCohorts(
  input: ReadonlyArray<H1GoldChaseCalibrationSample | null | undefined>,
): H1GoldChaseDescriptiveCohortResult {
  if (!Array.isArray(input) || input.length === 0) return base("EMPTY", 0, [], []);

  const blockers: string[] = [];
  const accepted: H1GoldChaseCalibrationSample[] = [];
  const identities = new Set<string>();

  input.forEach((sample, index) => {
    const invalid = sampleBlockers(sample, index);
    if (invalid.length > 0) {
      blockers.push(...invalid);
      return;
    }
    const key = identity(sample!);
    if (identities.has(key)) {
      blockers.push(`SAMPLE_${index}:DUPLICATE_IMMUTABLE_IDENTITY`);
      return;
    }
    identities.add(key);
    accepted.push(sample!);
  });

  // A mixed valid/invalid collection is BLOCKED rather than silently dropping
  // bad rows and creating survivorship-biased descriptive statistics.
  if (blockers.length > 0) return base("BLOCKED", input.length, accepted, blockers);
  if (accepted.length === 0) return base("EMPTY", input.length, [], []);

  const grouped = new Map<string, H1GoldChaseCalibrationSample[]>();
  for (const sample of accepted) {
    const key = cohortKey(sample);
    const rows = grouped.get(key) ?? [];
    rows.push(sample);
    grouped.set(key, rows);
  }

  const cohorts = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, samples]) => ({
      key,
      symbol: samples[0].symbol,
      side: samples[0].side,
      dte: samples[0].dte!,
      marketState: context(samples[0].t0MarketState),
      opportunityStage: context(samples[0].t0OpportunityStage),
      sellerStressState: context(samples[0].t0SellerStressState),
      sampleCount: samples.length,
      metrics: metrics(samples),
    }));

  return base("READY", input.length, accepted, [], cohorts);
}
