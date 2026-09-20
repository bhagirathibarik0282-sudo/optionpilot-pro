import type { H1ReplayHttpResult, H1ReplayRequest } from "./h1-replay-http.js";

export const H1_EXECUTION_INVALIDATION_AUDIT_V1 = "H1_EXECUTION_INVALIDATION_AUDIT_V1" as const;

export type H1InvalidationSource = "OPTION_PDL" | "OBSERVED_DAY_LOW";
export type H1InvalidationHorizonMinutes = 15 | 30 | 60;

export interface H1InvalidationAuditObservation {
  minuteBucket: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  source: H1InvalidationSource;
  horizonMinutes: H1InvalidationHorizonMinutes;
  entryAsk: number;
  invalidationPremium: number;
  stopDistancePct: number;
  forwardBidRowCount: number;
  stopObserved: boolean | null;
  firstStopObservedAt: string | null;
}

export interface H1InvalidationAuditSummary {
  source: H1InvalidationSource;
  horizonMinutes: H1InvalidationHorizonMinutes;
  candidateObservationCount: number;
  levelAvailableCount: number;
  forwardCoveredCount: number;
  stopObservedCount: number;
  stopNotObservedCount: number;
  minStopDistancePct: number | null;
  medianStopDistancePct: number | null;
  p75StopDistancePct: number | null;
  maxStopDistancePct: number | null;
}

export interface H1ExecutionInvalidationAuditResult {
  version: typeof H1_EXECUTION_INVALIDATION_AUDIT_V1;
  mode: "READ_ONLY_H1_EXECUTION_INVALIDATION_AUDIT_V1";
  productionImpact: "NONE";
  request: H1ReplayRequest;
  candidateObservationCount: number;
  uniqueCandidateContractCount: number;
  summaries: H1InvalidationAuditSummary[];
  exampleObservations: H1InvalidationAuditObservation[];
  blockers: string[];
  sourceSelectionDecision: "NOT_SELECTED";
  thresholdPromoted: false;
  canonicalSelectorQualificationProven: false;
  sourcePromotionAllowed: false;
  observationIndependenceClaim: false;
  candidateMarkerSemantics: "RECORDED_IS_CANDIDATE_OBSERVATION_NOT_CANONICAL_SELECTOR_PROOF";
  promotionBlockers: string[];
  usesFutureDataForDecision: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
  semantics: "DESCRIPTIVE_EXISTING_LEVEL_AUDIT_ONLY_NO_STOP_AUTHORITY";
}

const HORIZONS: H1InvalidationHorizonMinutes[] = [15, 30, 60];
const SOURCES: H1InvalidationSource[] = ["OPTION_PDL", "OBSERVED_DAY_LOW"];

function text(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function finite(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function positive(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function contractKey(row: Record<string, unknown>): string | null {
  const expiry = text(row.expiry);
  const strike = positive(row.strike);
  const side = text(row.option_type);
  if (!expiry || strike == null || (side !== "CE" && side !== "PE")) return null;
  return `${expiry}|${strike}|${side}`;
}

function timeMs(v: unknown): number | null {
  const ms = Date.parse(text(v));
  return Number.isFinite(ms) ? ms : null;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const value = lo === hi
    ? sorted[lo]
    : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
  return Number(value.toFixed(4));
}

function levelFor(row: Record<string, unknown>, source: H1InvalidationSource, entryAsk: number): number | null {
  const raw = source === "OPTION_PDL" ? positive(row.pdl) : positive(row.day_low);
  if (raw == null || raw >= entryAsk) return null;
  return raw;
}

function emptySummary(
  source: H1InvalidationSource,
  horizonMinutes: H1InvalidationHorizonMinutes,
  candidateObservationCount: number,
): H1InvalidationAuditSummary {
  return {
    source,
    horizonMinutes,
    candidateObservationCount,
    levelAvailableCount: 0,
    forwardCoveredCount: 0,
    stopObservedCount: 0,
    stopNotObservedCount: 0,
    minStopDistancePct: null,
    medianStopDistancePct: null,
    p75StopDistancePct: null,
    maxStopDistancePct: null,
  };
}

/**
 * Descriptive audit only.
 *
 * It evaluates two levels that are already recorded at the candidate timestamp:
 * previous-day option low (PDL) and the observed same-day option low. It does
 * not choose either level, does not infer a stop, and does not promote any
 * threshold. Entry uses the recorded candidate ask; future inspection uses
 * only later TRUE same-contract bids. The forward path is used solely to
 * describe whether the already-recorded level was observed later, never to
 * alter the historical decision.
 */
export function buildH1ExecutionInvalidationAuditV1(
  request: H1ReplayRequest,
  replay: H1ReplayHttpResult,
): H1ExecutionInvalidationAuditResult {
  const blockers: string[] = [];
  if (!replay.ok) blockers.push(replay.reason ?? "H1_REPLAY_UNAVAILABLE");

  const rows = (replay.options ?? []).filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  const byContract = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = contractKey(row);
    if (!key) continue;
    const arr = byContract.get(key) ?? [];
    arr.push(row);
    byContract.set(key, arr);
  }
  for (const arr of byContract.values()) {
    arr.sort((a, b) => (timeMs(a.minute_bucket) ?? 0) - (timeMs(b.minute_bucket) ?? 0));
  }

  const candidates = rows.filter((row) =>
    bool(row.is_candidate)
    && text(row.truth_verdict) === "TRUE"
    && positive(row.ask) !== null
    && contractKey(row) !== null
    && timeMs(row.minute_bucket) !== null
  );

  if (candidates.length === 0) blockers.push("NO_TRUTH_TRUE_CANDIDATE_WITH_POSITIVE_ASK");

  const summaries = new Map<string, H1InvalidationAuditSummary>();
  const distances = new Map<string, number[]>();
  for (const source of SOURCES) {
    for (const horizon of HORIZONS) {
      const key = `${source}|${horizon}`;
      summaries.set(key, emptySummary(source, horizon, candidates.length));
      distances.set(key, []);
    }
  }

  const examples: H1InvalidationAuditObservation[] = [];
  const uniqueContracts = new Set<string>();

  for (const candidate of candidates) {
    const key = contractKey(candidate)!;
    uniqueContracts.add(key);
    const signalMs = timeMs(candidate.minute_bucket)!;
    const entryAsk = positive(candidate.ask)!;
    const [expiry, strikeText, sideText] = key.split("|");
    const strike = Number(strikeText);
    const optionType = sideText as "CE" | "PE";
    const path = byContract.get(key) ?? [];

    for (const source of SOURCES) {
      const invalidationPremium = levelFor(candidate, source, entryAsk);
      for (const horizonMinutes of HORIZONS) {
        const summaryKey = `${source}|${horizonMinutes}`;
        const summary = summaries.get(summaryKey)!;
        if (invalidationPremium == null) continue;

        summary.levelAvailableCount += 1;
        const stopDistancePct = ((entryAsk - invalidationPremium) / entryAsk) * 100;
        distances.get(summaryKey)!.push(stopDistancePct);

        const endMs = signalMs + horizonMinutes * 60_000;
        const future = path.filter((row) => {
          const ms = timeMs(row.minute_bucket);
          return ms !== null
            && ms > signalMs
            && ms <= endMs
            && text(row.truth_verdict) === "TRUE"
            && positive(row.bid) !== null;
        });

        let stopObserved: boolean | null = null;
        let firstStopObservedAt: string | null = null;
        if (future.length > 0) {
          summary.forwardCoveredCount += 1;
          const stopRow = future.find((row) => positive(row.bid)! <= invalidationPremium);
          stopObserved = !!stopRow;
          if (stopRow) {
            summary.stopObservedCount += 1;
            firstStopObservedAt = text(stopRow.minute_bucket);
          } else {
            summary.stopNotObservedCount += 1;
          }
        }

        if (examples.length < 25) {
          examples.push({
            minuteBucket: text(candidate.minute_bucket),
            expiry,
            strike,
            optionType,
            source,
            horizonMinutes,
            entryAsk,
            invalidationPremium,
            stopDistancePct: Number(stopDistancePct.toFixed(4)),
            forwardBidRowCount: future.length,
            stopObserved,
            firstStopObservedAt,
          });
        }
      }
    }
  }

  const summaryRows = [...summaries.entries()].map(([key, summary]) => {
    const d = distances.get(key) ?? [];
    return {
      ...summary,
      minStopDistancePct: quantile(d, 0),
      medianStopDistancePct: quantile(d, 0.5),
      p75StopDistancePct: quantile(d, 0.75),
      maxStopDistancePct: quantile(d, 1),
    };
  });

  if (summaryRows.every((row) => row.levelAvailableCount === 0)) {
    blockers.push("NO_RECORDED_INVALIDATION_LEVEL_BELOW_ENTRY");
  }
  if (summaryRows.every((row) => row.forwardCoveredCount === 0)) {
    blockers.push("NO_SAME_CONTRACT_FORWARD_BID_COVERAGE");
  }

  return {
    version: H1_EXECUTION_INVALIDATION_AUDIT_V1,
    mode: "READ_ONLY_H1_EXECUTION_INVALIDATION_AUDIT_V1",
    productionImpact: "NONE",
    request,
    candidateObservationCount: candidates.length,
    uniqueCandidateContractCount: uniqueContracts.size,
    summaries: summaryRows,
    exampleObservations: examples,
    blockers: [...new Set(blockers)],
    sourceSelectionDecision: "NOT_SELECTED",
    thresholdPromoted: false,
    canonicalSelectorQualificationProven: false,
    sourcePromotionAllowed: false,
    observationIndependenceClaim: false,
    candidateMarkerSemantics: "RECORDED_IS_CANDIDATE_OBSERVATION_NOT_CANONICAL_SELECTOR_PROOF",
    promotionBlockers: [
      "CANONICAL_SELECTOR_QUALIFICATION_NOT_PROVEN_FROM_H1_REPLAY",
      "INVALIDATION_POLICY_NOT_VALIDATED",
    ],
    usesFutureDataForDecision: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
    semantics: "DESCRIPTIVE_EXISTING_LEVEL_AUDIT_ONLY_NO_STOP_AUTHORITY",
  };
}
