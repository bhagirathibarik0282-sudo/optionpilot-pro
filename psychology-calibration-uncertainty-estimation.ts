import { buildPsychologyCalibrationPartition } from "./psychology-calibration-partition.ts";
import { PSYCHOLOGY_CALIBRATION_PROTOCOL_V1 } from "./psychology-calibration-protocol.ts";
import type { StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import { designPsychologyThresholdCandidates } from "./psychology-threshold-candidate-design.ts";
import type { ShadowValidationMetricKey } from "./psychology-shadow-validation.ts";

export type PsychologyCalibrationUncertaintyStatus =
  | "CANDIDATE_DESIGN_BLOCKED"
  | "CALIBRATION_PARTITION_BLOCKED"
  | "UNCERTAINTY_ESTIMATION_BLOCKED"
  | "UNCERTAINTY_ESTIMATES_READY";

export interface PsychologyCalibrationUncertaintyCard {
  metric: ShadowValidationMetricKey;
  calibrationValue: number;
  preferredDirection: "LOWER" | "HIGHER";
  comparisonOperator: "LESS_THAN_OR_EQUAL" | "GREATER_THAN_OR_EQUAL";
  metricFamily: "BINOMIAL_RATE" | "COUNT_PER_TRADE";
  uncertaintyMethod: "WILSON_95" | "TRADING_DATE_CLUSTER_BOOTSTRAP_95";
  numerator: number;
  denominator: number;
  uncertaintyLower: number;
  uncertaintyUpper: number;
  bootstrapReplicates: number | null;
  bootstrapSeed: number | null;
  candidateThreshold: null;
  candidateSelected: false;
  candidateFrozen: false;
}

export interface PsychologyCalibrationUncertaintyResult {
  version: "PSYCHOLOGY_CALIBRATION_UNCERTAINTY_ESTIMATION_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyCalibrationUncertaintyStatus;
  protocolVersion: "PSYCHOLOGY_CALIBRATION_PROTOCOL_V1";
  cards: PsychologyCalibrationUncertaintyCard[];
  calibrationTradingDateCount: number;
  calibrationRecordCount: number;
  allTenFrozenMetricsEstimated: boolean;
  oosUsedForUncertaintyEstimation: false;
  oosUsedForCandidateSelection: false;
  multipleComparisonControlAppliedToSelection: false;
  thresholdSelectionRuleFrozen: false;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

type MetricTotals = { numerator: number; denominator: number };

function completedTradeCount(rows: readonly StoredPsychologyRealEvidence[]): number {
  return rows.reduce((sum, row) => sum + (row.validation.completedTrade ? 1 : 0), 0);
}

function sumValidation(
  rows: readonly StoredPsychologyRealEvidence[],
  key: keyof StoredPsychologyRealEvidence["validation"],
): number {
  return rows.reduce((sum, row) => {
    const value = row.validation[key];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
}

function metricTotals(metric: ShadowValidationMetricKey, rows: readonly StoredPsychologyRealEvidence[]): MetricTotals {
  const completed = completedTradeCount(rows);
  switch (metric) {
    case "FALSE_CHASE_WARNING_RATE":
      return { numerator: sumValidation(rows, "falseChaseWarnings"), denominator: sumValidation(rows, "chaseWarnings") };
    case "MISSED_LATE_EXIT_WARNING_RATE":
      return { numerator: sumValidation(rows, "missedLateExitWarnings"), denominator: sumValidation(rows, "lateExitEvents") };
    case "MISSED_THESIS_FAILURE_RATE":
      return { numerator: sumValidation(rows, "missedThesisFailures"), denominator: sumValidation(rows, "thesisFailures") };
    case "STATE_FLIPS_PER_TRADE":
      return { numerator: sumValidation(rows, "stateFlips"), denominator: completed };
    case "DUPLICATE_MESSAGE_RATE":
      return { numerator: sumValidation(rows, "duplicateMessages"), denominator: sumValidation(rows, "eligibleMessages") };
    case "AVERAGE_UPDATES_PER_TRADE":
      return { numerator: sumValidation(rows, "spokenUpdates"), denominator: completed };
    case "WRONG_SIDE_FLIP_RATE":
      return { numerator: sumValidation(rows, "wrongSideFlips"), denominator: completed };
    case "ENTRY_AFTER_EXTENSION_RATE":
      return { numerator: sumValidation(rows, "entriesAfterExtension"), denominator: sumValidation(rows, "entries") };
    case "STOP_RESPECT_VIOLATION_RATE":
      return { numerator: sumValidation(rows, "stopRespectViolations"), denominator: sumValidation(rows, "stoppedTrades") };
    case "PROFIT_PROTECTION_USEFULNESS_RATE":
      return { numerator: sumValidation(rows, "usefulProfitProtectionEvents"), denominator: sumValidation(rows, "profitProtectionOpportunities") };
  }
}

function wilson95(successes: number, trials: number): [number, number] | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0 || successes < 0 || successes > trials) return null;
  const z = 1.959963984540054;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) / trials) + (z2 / (4 * trials * trials))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function stringHash(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function tradingDateClusterBootstrap95(
  metric: ShadowValidationMetricKey,
  rows: readonly StoredPsychologyRealEvidence[],
): { lower: number; upper: number; replicates: number; seed: number } | null {
  const byDate = new Map<string, StoredPsychologyRealEvidence[]>();
  for (const row of rows) {
    const date = row.replay.tradingDate;
    if (!date) return null;
    const bucket = byDate.get(date) ?? [];
    bucket.push(row);
    byDate.set(date, bucket);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;

  const replicates = PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.uncertainty.clusterBootstrapReplicates;
  const seed = (PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.uncertainty.clusterBootstrapSeed ^ stringHash(metric)) >>> 0;
  const random = mulberry32(seed);
  const estimates: number[] = [];

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let numerator = 0;
    let denominator = 0;
    for (let draw = 0; draw < dates.length; draw += 1) {
      const sampledDate = dates[Math.floor(random() * dates.length)]!;
      const totals = metricTotals(metric, byDate.get(sampledDate)!);
      numerator += totals.numerator;
      denominator += totals.denominator;
    }
    if (denominator > 0) estimates.push(numerator / denominator);
  }

  if (estimates.length !== replicates) return null;
  estimates.sort((a, b) => a - b);
  const lower = quantile(estimates, 0.025);
  const upper = quantile(estimates, 0.975);
  if (lower == null || upper == null) return null;
  return { lower, upper, replicates, seed };
}

/**
 * Estimates uncertainty from calibration records only. Binomial-rate metrics use the frozen
 * Wilson 95% method; count-per-trade metrics use the frozen trading-date cluster bootstrap.
 * OOS records are never supplied to either uncertainty estimator, and no threshold is selected.
 */
export function estimatePsychologyCalibrationUncertainty(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyCalibrationUncertaintyResult {
  const design = designPsychologyThresholdCandidates(rows);
  const partition = buildPsychologyCalibrationPartition(rows);
  const blockers = [...design.blockers, ...partition.blockers];

  const base = {
    version: "PSYCHOLOGY_CALIBRATION_UNCERTAINTY_ESTIMATION_V1" as const,
    semantics: "RESEARCH_SHADOW_ONLY" as const,
    protocolVersion: PSYCHOLOGY_CALIBRATION_PROTOCOL_V1.version,
    oosUsedForUncertaintyEstimation: false as const,
    oosUsedForCandidateSelection: false as const,
    multipleComparisonControlAppliedToSelection: false as const,
    thresholdSelectionRuleFrozen: false as const,
    acceptanceThresholdsProposed: false as const,
    acceptanceThresholdsFrozen: false as const,
    promotionEligible: false as const,
    affectsTelegram: false as const,
    affectsVerdict: false as const,
    affectsExecution: false as const,
  };

  if (design.status !== "READY_FOR_UNCERTAINTY_ESTIMATION") {
    blockers.push("THRESHOLD_CANDIDATE_DESIGN_NOT_READY");
    return { ...base, status: "CANDIDATE_DESIGN_BLOCKED", cards: [], calibrationTradingDateCount: 0, calibrationRecordCount: 0, allTenFrozenMetricsEstimated: false, blockers };
  }
  if (partition.status !== "PARTITION_READY") {
    blockers.push("CALIBRATION_PARTITION_NOT_READY_FOR_UNCERTAINTY");
    return { ...base, status: "CALIBRATION_PARTITION_BLOCKED", cards: [], calibrationTradingDateCount: 0, calibrationRecordCount: 0, allTenFrozenMetricsEstimated: false, blockers };
  }

  const cards: PsychologyCalibrationUncertaintyCard[] = [];
  for (const card of design.cards) {
    const totals = metricTotals(card.metric, partition.calibrationRecords);
    if (totals.denominator <= 0) {
      blockers.push(`UNCERTAINTY_DENOMINATOR_ZERO:${card.metric}`);
      continue;
    }
    const recomputed = totals.numerator / totals.denominator;
    if (Math.abs(recomputed - card.calibrationValue) > 1e-12) {
      blockers.push(`CALIBRATION_VALUE_MISMATCH:${card.metric}`);
      continue;
    }

    if (card.metricFamily === "BINOMIAL_RATE") {
      const interval = wilson95(totals.numerator, totals.denominator);
      if (!interval) {
        blockers.push(`WILSON_INTERVAL_FAILED:${card.metric}`);
        continue;
      }
      cards.push({
        ...card,
        numerator: totals.numerator,
        denominator: totals.denominator,
        uncertaintyLower: interval[0],
        uncertaintyUpper: interval[1],
        bootstrapReplicates: null,
        bootstrapSeed: null,
      });
      continue;
    }

    const interval = tradingDateClusterBootstrap95(card.metric, partition.calibrationRecords);
    if (!interval) {
      blockers.push(`CLUSTER_BOOTSTRAP_FAILED:${card.metric}`);
      continue;
    }
    cards.push({
      ...card,
      numerator: totals.numerator,
      denominator: totals.denominator,
      uncertaintyLower: interval.lower,
      uncertaintyUpper: interval.upper,
      bootstrapReplicates: interval.replicates,
      bootstrapSeed: interval.seed,
    });
  }

  const allTenFrozenMetricsEstimated = cards.length === 10;
  if (!allTenFrozenMetricsEstimated) blockers.push("NOT_ALL_10_UNCERTAINTY_ESTIMATES_AVAILABLE");
  const ready = blockers.length === 0;

  return {
    ...base,
    status: ready ? "UNCERTAINTY_ESTIMATES_READY" : "UNCERTAINTY_ESTIMATION_BLOCKED",
    cards: ready ? cards : [],
    calibrationTradingDateCount: partition.calibrationTradingDateCount,
    calibrationRecordCount: partition.calibrationRecords.length,
    allTenFrozenMetricsEstimated: ready && allTenFrozenMetricsEstimated,
    blockers,
  };
}
