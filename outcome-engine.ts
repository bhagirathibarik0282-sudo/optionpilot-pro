// ============================================================================
// Validation / Outcome Engine (OptionPilot Pro System Architecture v1.0,
// layer 13). Built 2026-08-08 per docs/architecture.md, priority P0.
//
// Purpose: compare a recorded DETERMINISTIC verdict + suggested trade
// against subsequent REAL market snapshots to determine whether the
// suggested target, stop, or neither was reached within a configurable
// window.
//
// HARD RULES (do not violate):
//   - Deterministic only. No AI/Haiku involvement anywhere in this file.
//   - Never modifies the original verdict/score it was given.
//   - Never fabricates or interpolates a missing/incomplete outcome —
//     incomplete windows are reported as incomplete, not guessed.
//   - This module is intentionally self-contained (no import from
//     server.ts) so it can be unit-tested in isolation.
//
// DISCLOSED LIMITATION: the Recorder Engine (server.ts) only tracks the
// CURRENT ATM strike's CE/PE premium per snapshot, not a fixed strike
// over time. If the ATM strike shifts away from the strike a verdict
// was suggested on before the outcome window completes, this engine can
// no longer observe that specific option's premium and marks the
// record INCOMPLETE_STRIKE_SHIFTED rather than guessing what it did.
// ============================================================================

export type Side = "CE" | "PE";
export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export type OutcomeStatus =
  | "PENDING"
  | "TARGET_T1_HIT"
  | "TARGET_T2_HIT"
  | "STOP_HIT"
  | "NEITHER_HIT"
  | "INCOMPLETE_WINDOW"
  | "INCOMPLETE_STRIKE_SHIFTED"
  | "INCOMPLETE_NO_ENTRY_DATA";

export interface OutcomeRecord {
  outcomeId: string;
  recordedAt: string; // ISO
  recordedAtMs: number;
  tradingDate: string; // YYYY-MM-DD, Asia/Kolkata — links this record to that day's Historical Journal entries
  symbol: IndexSymbol;
  verdict: string;
  score: number | null;
  maxScore: number | null;
  confidence: string | null;
  side: Side | null;
  strike: number | null;
  entry: number | null;
  sl: number | null;
  t1: number | null;
  t2: number | null;
  // Signal state AT DECISION TIME — e.g. { futures_vwap: 1, oi_pcr: -1, ... }.
  signalContributions: Record<string, number> | null;
  windowMinutes: number;
  windowEndsAtMs: number;
  status: OutcomeStatus;
  evaluatedAt: string | null;
  outcomeDetail: string | null;
}

// Minimal shape this engine needs from a Recorder snapshot — decoupled
// from server.ts's own RecorderSnapshot type on purpose, so this module
// has zero dependency on server.ts.
export interface SnapshotForOutcome {
  backendTimestamp: string; // ISO
  atmStrike: number | null;
  ceLtp: number | null;
  peLtp: number | null;
}

export interface CreateOutcomeRecordInput {
  symbol: IndexSymbol;
  tradingDate: string;
  verdict: string;
  score: number | null;
  maxScore: number | null;
  confidence: string | null;
  side: Side | null;
  strike: number | null;
  entry: number | null;
  sl: number | null;
  t1: number | null;
  t2: number | null;
  signalContributions: Record<string, number> | null;
  windowMinutes: number;
  nowMs: number;
  idSuffix: string;
}

export function createOutcomeRecord(input: CreateOutcomeRecordInput): OutcomeRecord {
  const recordedAtMs = input.nowMs;
  const hasEntry = input.entry != null && input.entry > 0 && input.side != null && input.strike != null;
  return {
    outcomeId: `oc-${recordedAtMs}-${input.idSuffix}`,
    recordedAt: new Date(recordedAtMs).toISOString(),
    recordedAtMs,
    tradingDate: input.tradingDate,
    symbol: input.symbol,
    verdict: input.verdict,
    score: input.score,
    maxScore: input.maxScore,
    confidence: input.confidence,
    side: input.side,
    strike: input.strike,
    entry: input.entry,
    sl: input.sl,
    t1: input.t1,
    t2: input.t2,
    signalContributions: input.signalContributions,
    windowMinutes: input.windowMinutes,
    windowEndsAtMs: recordedAtMs + input.windowMinutes * 60 * 1000,
    status: hasEntry ? "PENDING" : "INCOMPLETE_NO_ENTRY_DATA",
    evaluatedAt: hasEntry ? null : new Date(recordedAtMs).toISOString(),
    outcomeDetail: hasEntry ? null : "No suggested entry/side/strike was available at decision time \u2014 nothing to evaluate.",
  };
}

// Pure, deterministic evaluation \u2014 the core of this module and the
// only function the unit tests need to exercise directly. Never
// mutates its inputs; always returns a new record.
export function evaluateOutcome(record: OutcomeRecord, snapshots: SnapshotForOutcome[], nowMs: number): OutcomeRecord {
  if (record.status !== "PENDING") return record; // terminal already \u2014 never re-evaluate

  const relevant = snapshots
    .filter((s) => {
      const t = new Date(s.backendTimestamp).getTime();
      return t >= record.recordedAtMs && t <= record.windowEndsAtMs;
    })
    .sort((a, b) => new Date(a.backendTimestamp).getTime() - new Date(b.backendTimestamp).getTime());

  let strikeShiftedAway = false;

  for (const snap of relevant) {
    if (snap.atmStrike !== record.strike) {
      strikeShiftedAway = true;
      continue; // can't read this option's premium from this snapshot
    }
    const premium = record.side === "CE" ? snap.ceLtp : snap.peLtp;
    if (premium == null) continue;

    // Check T2 before T1: if price gapped straight through both in one
    // snapshot, T2 (the fuller target) is the more informative report.
    if (record.t2 != null && premium >= record.t2) {
      return { ...record, status: "TARGET_T2_HIT", evaluatedAt: snap.backendTimestamp, outcomeDetail: `Premium reached \u20b9${premium} \u2265 T2 \u20b9${record.t2} at ${snap.backendTimestamp}.` };
    }
    if (record.sl != null && premium <= record.sl) {
      return { ...record, status: "STOP_HIT", evaluatedAt: snap.backendTimestamp, outcomeDetail: `Premium fell to \u20b9${premium} \u2264 SL \u20b9${record.sl} at ${snap.backendTimestamp}.` };
    }
    if (record.t1 != null && premium >= record.t1) {
      return { ...record, status: "TARGET_T1_HIT", evaluatedAt: snap.backendTimestamp, outcomeDetail: `Premium reached \u20b9${premium} \u2265 T1 \u20b9${record.t1} at ${snap.backendTimestamp}.` };
    }
  }

  if (nowMs < record.windowEndsAtMs) {
    return record; // window not over yet \u2014 stays PENDING
  }

  // Window is over: decide the terminal status.
  if (relevant.length === 0) {
    return { ...record, status: "INCOMPLETE_WINDOW", evaluatedAt: new Date(nowMs).toISOString(), outcomeDetail: "No Recorder snapshots were available covering the outcome window (Recorder Engine likely wasn't running)." };
  }
  if (strikeShiftedAway) {
    return { ...record, status: "INCOMPLETE_STRIKE_SHIFTED", evaluatedAt: new Date(nowMs).toISOString(), outcomeDetail: `ATM strike moved away from ${record.strike} before the window completed \u2014 premium could no longer be tracked.` };
  }
  return { ...record, status: "NEITHER_HIT", evaluatedAt: new Date(nowMs).toISOString(), outcomeDetail: "Neither target nor stop was reached within the outcome window." };
}

// ---- Aggregation -----------------------------------------------------
// Only over DETERMINATE records (a real target/stop/neither outcome).
// PENDING and every INCOMPLETE_* status are excluded — never
// interpolated into the statistics, per the architecture's hard rule.

export interface OutcomeStats {
  totalRecords: number;
  determinateRecords: number;
  byStatus: Record<string, number>;
  byVerdict: Record<string, { total: number; targetHit: number; stopHit: number; neither: number }>;
  bySignal: Record<string, { total: number; targetHit: number; stopHit: number; neither: number; sufficientSample: boolean }>;
  minSampleSize: number;
}

// PROVISIONAL, not backtested \u2014 just a sane floor before a per-signal
// stat is shown as meaningful rather than noise.
export const MIN_SAMPLE_SIZE = 5;

export function computeOutcomeStats(records: OutcomeRecord[]): OutcomeStats {
  const determinate = records.filter(
    (r) => r.status === "TARGET_T1_HIT" || r.status === "TARGET_T2_HIT" || r.status === "STOP_HIT" || r.status === "NEITHER_HIT"
  );

  const byStatus: Record<string, number> = {};
  for (const r of records) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const byVerdict: OutcomeStats["byVerdict"] = {};
  const bySignal: OutcomeStats["bySignal"] = {};

  for (const r of determinate) {
    const isTarget = r.status === "TARGET_T1_HIT" || r.status === "TARGET_T2_HIT";
    const isStop = r.status === "STOP_HIT";
    const isNeither = r.status === "NEITHER_HIT";

    if (!byVerdict[r.verdict]) byVerdict[r.verdict] = { total: 0, targetHit: 0, stopHit: 0, neither: 0 };
    byVerdict[r.verdict].total++;
    if (isTarget) byVerdict[r.verdict].targetHit++;
    if (isStop) byVerdict[r.verdict].stopHit++;
    if (isNeither) byVerdict[r.verdict].neither++;

    if (r.signalContributions) {
      for (const [sig, val] of Object.entries(r.signalContributions)) {
        const key = `${sig}:${val > 0 ? "positive" : val < 0 ? "negative" : "neutral"}`;
        if (!bySignal[key]) bySignal[key] = { total: 0, targetHit: 0, stopHit: 0, neither: 0, sufficientSample: false };
        bySignal[key].total++;
        if (isTarget) bySignal[key].targetHit++;
        if (isStop) bySignal[key].stopHit++;
        if (isNeither) bySignal[key].neither++;
      }
    }
  }

  for (const key of Object.keys(bySignal)) {
    bySignal[key].sufficientSample = bySignal[key].total >= MIN_SAMPLE_SIZE;
  }

  return {
    totalRecords: records.length,
    determinateRecords: determinate.length,
    byStatus,
    byVerdict,
    bySignal,
    minSampleSize: MIN_SAMPLE_SIZE,
  };
}
