import type { OutcomeRecord } from "./outcome-engine.js";
import type { CandidateHistoryRecord } from "./candidate-history-record.js";
import { persistCandidateHistoryRecord, type CandidateHistoryPersistResult } from "./candidate-history-store.js";

export const CANDIDATE_OUTCOME_BRIDGE_VERSION = "CANDIDATE_OUTCOME_BRIDGE_V1" as const;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One deterministic trade-plan signal may produce several OutcomeRecords
 * (30m/60m/90m/EOD). Use planId when available so Candidate History stores
 * one logical candidate rather than one row per evaluation horizon.
 */
export function candidateHistoryIdFromOutcome(record: OutcomeRecord): string {
  const planId = record.planId?.trim();
  return planId ? `tm-plan:${planId}` : `outcome:${record.outcomeId}`;
}

/**
 * Conservative adapter from an already-created deterministic OutcomeRecord.
 * Outcome Engine does not carry H1 candidate grade, expiry or Greeks, so those
 * fields remain explicitly unavailable instead of being guessed or zero-filled.
 */
export function candidateHistoryFromOutcome(record: OutcomeRecord): CandidateHistoryRecord {
  const validTradeIdentity =
    (record.side === "CE" || record.side === "PE") &&
    finiteOrNull(record.strike) !== null &&
    finiteOrNull(record.entry) !== null &&
    (record.entry as number) > 0;

  return {
    candidateId: candidateHistoryIdFromOutcome(record),
    symbol: record.symbol,
    observedAt: new Date(record.recordedAtMs).toISOString(),
    side: record.side,
    expiry: null,
    strike: finiteOrNull(record.strike),
    dte: null,
    ltp: finiteOrNull(record.entry),
    iv: null,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    intrinsic: null,
    extrinsic: null,
    spread: null,
    volume: null,
    oi: null,
    grade: "UNAVAILABLE",
    status: validTradeIdentity ? "OBSERVED" : "UNAVAILABLE",
    reasonCode: validTradeIdentity ? "OUTCOME_SIGNAL_CAPTURED" : "OUTCOME_SIGNAL_IDENTITY_INCOMPLETE",
    selectionVersion: `${CANDIDATE_OUTCOME_BRIDGE_VERSION}|${record.tmVersion}`,
  };
}

export async function persistCandidateHistoryFromOutcome(
  record: OutcomeRecord,
): Promise<CandidateHistoryPersistResult> {
  return persistCandidateHistoryRecord(candidateHistoryFromOutcome(record));
}
