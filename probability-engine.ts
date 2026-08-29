import type { OutcomeRecord } from "./outcome-engine.js";

export type HistoricalSupportStatus = "READY" | "DATA_UNAVAILABLE";

export interface ProbabilityQuery {
  symbol?: OutcomeRecord["symbol"];
  side?: OutcomeRecord["side"];
  horizon?: OutcomeRecord["horizon"];
  marketRegime?: string | null;
  expiryType?: string | null;
  signalType?: string | null;
  tmVersion?: OutcomeRecord["tmVersion"];
  minResolvedSamples: number;
}

export interface HistoricalProbabilityResult {
  status: HistoricalSupportStatus;
  sampleCount: number;
  resolvedSamples: number;
  wins: number;
  losses: number;
  censored: number;
  winRatePct: number | null;
  semantics: "TARGET_BEFORE_STOP_OBSERVED_ONLY";
  ruleVersion: "PROBABILITY_ENGINE_V1";
  reason: string;
}

const WIN_STATUSES = new Set<OutcomeRecord["status"]>([
  "TARGET_T1_HIT",
  "TARGET_T2_HIT",
  "TARGET_T3_HIT",
]);

function unavailable(reason: string): HistoricalProbabilityResult {
  return {
    status: "DATA_UNAVAILABLE",
    sampleCount: 0,
    resolvedSamples: 0,
    wins: 0,
    losses: 0,
    censored: 0,
    winRatePct: null,
    semantics: "TARGET_BEFORE_STOP_OBSERVED_ONLY",
    ruleVersion: "PROBABILITY_ENGINE_V1",
    reason,
  };
}

function matches(record: OutcomeRecord, query: ProbabilityQuery): boolean {
  if (query.symbol && record.symbol !== query.symbol) return false;
  if (query.side !== undefined && record.side !== query.side) return false;
  if (record.horizon !== query.horizon) return false;
  if (query.marketRegime !== undefined && record.marketRegime !== query.marketRegime) return false;
  if (query.expiryType !== undefined && record.expiryType !== query.expiryType) return false;
  if (query.signalType !== undefined && record.signalType !== query.signalType) return false;
  if (query.tmVersion && record.tmVersion !== query.tmVersion) return false;
  return true;
}

/**
 * Historical-support calculator only. It never changes a live verdict.
 * Incomplete/pending/ambiguous observations are censored rather than guessed.
 * NEITHER_HIT is also censored because no target-before-stop outcome was observed.
 * A horizon is mandatory: mixing 30m/60m/90m/EOD records would count the same
 * logical trade plan multiple times and manufacture a misleading probability.
 */
export function computeHistoricalProbability(
  records: OutcomeRecord[],
  query: ProbabilityQuery,
): HistoricalProbabilityResult {
  if (!query.horizon) return unavailable("HORIZON_REQUIRED");

  const minResolvedSamples = Number.isInteger(query.minResolvedSamples) && query.minResolvedSamples > 0
    ? query.minResolvedSamples
    : Number.POSITIVE_INFINITY;

  const matched = records.filter((record) => matches(record, query));
  let wins = 0;
  let losses = 0;
  let censored = 0;

  for (const record of matched) {
    if (WIN_STATUSES.has(record.status)) {
      wins += 1;
    } else if (record.status === "STOP_HIT") {
      losses += 1;
    } else {
      censored += 1;
    }
  }

  const resolvedSamples = wins + losses;
  const enough = Number.isFinite(minResolvedSamples) && resolvedSamples >= minResolvedSamples;

  return {
    status: enough ? "READY" : "DATA_UNAVAILABLE",
    sampleCount: matched.length,
    resolvedSamples,
    wins,
    losses,
    censored,
    winRatePct: enough && resolvedSamples > 0 ? (wins / resolvedSamples) * 100 : null,
    semantics: "TARGET_BEFORE_STOP_OBSERVED_ONLY",
    ruleVersion: "PROBABILITY_ENGINE_V1",
    reason: enough
      ? "MIN_RESOLVED_SAMPLE_REQUIREMENT_MET"
      : "INSUFFICIENT_RESOLVED_HISTORY",
  };
}
