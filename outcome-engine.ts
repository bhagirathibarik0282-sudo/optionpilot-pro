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
//
// ============================================================================
// TM_V1 FORWARD-ONLY VALIDATION PLAN additions (2026-08-21)
// ============================================================================
// Added per an explicit, user-supplied "Trade Management Forward-Only
// Validation Plan" spec (TM_V1), and the user's own explicit instruction:
// do NOT backtest, forward-test only, keep the existing 3-minute Recorder
// cadence (do not increase Kite/Dhan API load — the system was already
// observed hitting Kite historical-fetch 429 rate limits).
//
// DISCLOSED LIMITATION vs the TM_V1 spec's ideal (kept honest, not hidden):
// the spec's preferred observation resolution is tick data, minimum
// 1-minute OHLC. This implementation stays on the EXISTING 3-minute LTP
// sampling (see observationResolution: "3MIN_LTP_SAMPLED" on every
// record) — a genuine intraperiod SL-then-recovery or target-then-pullback
// between two 3-minute samples is NOT observable here. This is an accepted
// trade-off (explicit user decision, 2026-08-21), not a hidden gap.
//
// AMBIGUOUS_BOTH_HIT: kept in the OutcomeStatus type for compatibility
// with the TM_V1 spec's schema, but this version deliberately NEVER
// produces it, and says so rather than faking a detector. A first attempt
// tried to flag it by checking whether the [previous, current] premium
// range spanned both SL and a target — that check is proven unreachable
// under this engine's own "return on first observed crossing" structure
// (the "previous" premium at the start of every loop iteration is always
// still strictly between SL and T1 by construction, so a later single
// premium value can never simultaneously satisfy both a stop condition
// and a target condition). Genuine "which level was touched first"
// ambiguity needs per-3-minute-bucket HIGH/LOW, not a single LTP per
// snapshot — the Recorder Engine does not capture that today, and this
// module will not invent it. See evaluateOutcome's own comment and the
// "TM_V1: AMBIGUOUS_BOTH_HIT is provably unreachable..." unit test for
// the full proof.
//
// MAE/MFE: Maximum Adverse/Favorable Excursion, tracked in both premium
// and R terms, over every observed (strike-matched) snapshot in the
// window — not just up to the terminal hit. Computed fresh on every
// evaluateOutcome() call (deterministic, no persisted mutation of past
// values), so it also gives a live "how far has this moved" view while
// still PENDING.
//
// Clamp audit (rawRiskDistance / clampedRiskDistance / clampApplied) and
// context tags (marketRegime / expiryType / signalType / deltaSource) are
// pure pass-through fields — this engine does not compute them (it has no
// ATR/Delta/market-regime knowledge, by design, per its own "self-contained"
// hard rule); the caller (server.ts's trade-management plan) supplies them
// at creation time so they travel with the record for later audit/review.
//
// planId / horizon: support the spec's "parallel 30m/60m/90m/EOD
// observation horizons" requirement WITHOUT changing evaluateOutcome's
// core logic — the caller creates up to 4 OutcomeRecords per signal
// (identical entry/sl/t1/t2, different windowMinutes), sharing one planId
// so they can be grouped back together for review. This reuses the
// existing create/evaluate functions as-is.
//
// tmVersion: every record is frozen with the plan version that produced
// it ("TM_V1" today). Per the spec's version-freeze rule: if the
// underlying method (ATR handling, Delta handling, clamp, R-multiples,
// trailing, or outcome classification) ever changes, that must ship as a
// NEW version string (e.g. "TM_V2"), never a silent in-place change —
// TM_V1 and later records must stay separately identifiable by this field.
// ============================================================================

export type Side = "CE" | "PE";
export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export type OutcomeStatus =
  | "PENDING"
  | "TARGET_T1_HIT"
  | "TARGET_T2_HIT"
  | "STOP_HIT"
  | "NEITHER_HIT"
  | "AMBIGUOUS_BOTH_HIT"
  | "INCOMPLETE_WINDOW"
  | "INCOMPLETE_STRIKE_SHIFTED"
  | "INCOMPLETE_NO_ENTRY_DATA"
  | "INCOMPLETE_DATA";

// TM_V1 spec-aligned auxiliary types. Kept broad (string) where the caller
// owns the vocabulary (marketRegime/expiryType/signalType come from
// server.ts's own classifications, which this self-contained module does
// not know about) so this file never has to be edited just because
// server.ts adds a new regime label.
export type TmVersion = "TM_V1";
export type ObservationHorizon = "30m" | "60m" | "90m" | "EOD";
export type ClampApplied = "MIN" | "MAX" | "NONE";
export type DeltaSource = "OBSERVED" | "ESTIMATED_FALLBACK";
export type ObservationResolution = "3MIN_LTP_SAMPLED";

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

  // ---- TM_V1 forward-only validation plan additions (2026-08-21) ----
  tmVersion: TmVersion;
  planId: string | null;
  horizon: ObservationHorizon | null;
  observationResolution: ObservationResolution;
  rawRiskDistance: number | null;
  clampedRiskDistance: number | null;
  clampApplied: ClampApplied | null;
  deltaSource: DeltaSource | null;
  marketRegime: string | null;
  expiryType: string | null;
  signalType: string | null;
  // Excursion tracking, recomputed fresh on every evaluateOutcome() call —
  // never persisted-then-mutated, always derived from the raw snapshots.
  maePremium: number | null; // max adverse move against the position, in premium ₹
  mfePremium: number | null; // max favorable move, in premium ₹
  maeR: number | null; // maePremium expressed in R-multiples (needs a real R = entry - sl)
  mfeR: number | null;
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

  // ---- TM_V1 additions — all optional so every pre-existing caller
  // (and every pre-existing unit test) keeps working unchanged. ----
  planId?: string | null;
  horizon?: ObservationHorizon | null;
  rawRiskDistance?: number | null;
  clampedRiskDistance?: number | null;
  clampApplied?: ClampApplied | null;
  deltaSource?: DeltaSource | null;
  marketRegime?: string | null;
  expiryType?: string | null;
  signalType?: string | null;
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
    outcomeDetail: hasEntry ? null : "No suggested entry/side/strike was available at decision time — nothing to evaluate.",

    tmVersion: "TM_V1",
    planId: input.planId ?? null,
    horizon: input.horizon ?? null,
    observationResolution: "3MIN_LTP_SAMPLED",
    rawRiskDistance: input.rawRiskDistance ?? null,
    clampedRiskDistance: input.clampedRiskDistance ?? null,
    clampApplied: input.clampApplied ?? null,
    deltaSource: input.deltaSource ?? null,
    marketRegime: input.marketRegime ?? null,
    expiryType: input.expiryType ?? null,
    signalType: input.signalType ?? null,
    maePremium: null,
    mfePremium: null,
    maeR: null,
    mfeR: null,
  };
}

// Recomputes MAE/MFE from scratch over every strike-matched snapshot in
// `relevant` (already time-window-filtered and sorted by the caller) —
// pure and deterministic, safe to call on every evaluation pass including
// while still PENDING. Returns nulls when there is no real R (sl missing
// or sl === entry) to express the R-multiple form, or no matched snapshots.
function computeExcursion(
  record: OutcomeRecord,
  relevant: SnapshotForOutcome[]
): { maePremium: number | null; mfePremium: number | null; maeR: number | null; mfeR: number | null } {
  if (record.entry == null || record.side == null) return { maePremium: null, mfePremium: null, maeR: null, mfeR: null };

  let best: number | null = null; // highest premium seen (favorable for a long option)
  let worst: number | null = null; // lowest premium seen (adverse for a long option)
  for (const snap of relevant) {
    if (snap.atmStrike !== record.strike) continue;
    const premium = record.side === "CE" ? snap.ceLtp : snap.peLtp;
    if (premium == null) continue;
    if (best == null || premium > best) best = premium;
    if (worst == null || premium < worst) worst = premium;
  }
  if (best == null || worst == null) return { maePremium: null, mfePremium: null, maeR: null, mfeR: null };

  const mfePremium = Number((Math.max(0, best - record.entry)).toFixed(2));
  const maePremium = Number((Math.max(0, record.entry - worst)).toFixed(2));

  const R = record.sl != null ? record.entry - record.sl : null;
  const hasRealR = R != null && R > 0;
  const mfeR = hasRealR ? Number((mfePremium / (R as number)).toFixed(3)) : null;
  const maeR = hasRealR ? Number((maePremium / (R as number)).toFixed(3)) : null;

  return { maePremium, mfePremium, maeR, mfeR };
}

// Pure, deterministic evaluation — the core of this module and the
// only function the unit tests need to exercise directly. Never
// mutates its inputs; always returns a new record.
export function evaluateOutcome(record: OutcomeRecord, snapshots: SnapshotForOutcome[], nowMs: number): OutcomeRecord {
  if (record.status !== "PENDING") return record; // terminal already — never re-evaluate

  const relevant = snapshots
    .filter((s) => {
      const t = new Date(s.backendTimestamp).getTime();
      return t >= record.recordedAtMs && t <= record.windowEndsAtMs;
    })
    .sort((a, b) => new Date(a.backendTimestamp).getTime() - new Date(b.backendTimestamp).getTime());

  // Excursion tracking (TM_V1) — computed over the full relevant window
  // regardless of where/whether a terminal hit occurs below, so a live
  // PENDING record also shows how far price has moved so far.
  const excursion = computeExcursion(record, relevant);
  const withExcursion = { ...record, ...excursion };

  let strikeShiftedAway = false;

  // TM_V1 ambiguity note (2026-08-21, corrected after catching this in my
  // own unit tests before shipping — see test file for the proof): an
  // earlier draft of this function tried to detect AMBIGUOUS_BOTH_HIT by
  // checking whether the [previous-observed-premium, current-premium]
  // range spanned both SL and a target. That check can MATHEMATICALLY
  // NEVER fire, because this loop returns immediately on the first
  // snapshot that crosses ANY threshold — so the "previous" premium at
  // the start of every iteration is, by construction, always still
  // strictly between SL and T1 (never itself a past hit). A single later
  // premium value cannot simultaneously be <= SL and >= T1/T2, so the
  // range can never contain both. Genuine "which level was touched first"
  // ambiguity is a real gap of LTP-only sampling, but detecting it
  // requires knowing the intraperiod HIGH and LOW within each 3-minute
  // gap (i.e. real OHLC per bucket) — this engine only receives a single
  // LTP per snapshot (see SnapshotForOutcome), so it genuinely cannot be
  // computed here without fabricating data that was never observed.
  // AMBIGUOUS_BOTH_HIT stays in the OutcomeStatus type for schema
  // compatibility with the TM_V1 spec and for a future version that adds
  // per-bucket high/low to SnapshotForOutcome — this version deliberately
  // never produces it, and does not pretend otherwise.
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
      return { ...withExcursion, status: "TARGET_T2_HIT", evaluatedAt: snap.backendTimestamp, outcomeDetail: `Premium reached ₹${premium} ≥ T2 ₹${record.t2} at ${snap.backendTimestamp}.` };
    }
    if (record.sl != null && premium <= record.sl) {
      return { ...withExcursion, status: "STOP_HIT", evaluatedAt: snap.backendTimestamp, outcomeDetail: `Premium fell to ₹${premium} ≤ SL ₹${record.sl} at ${snap.backendTimestamp}.` };
    }
    if (record.t1 != null && premium >= record.t1) {
      return { ...withExcursion, status: "TARGET_T1_HIT", evaluatedAt: snap.backendTimestamp, outcomeDetail: `Premium reached ₹${premium} ≥ T1 ₹${record.t1} at ${snap.backendTimestamp}.` };
    }
  }

  if (nowMs < record.windowEndsAtMs) {
    return withExcursion; // window not over yet — stays PENDING (with fresh excursion numbers)
  }

  // Window is over: decide the terminal status.
  if (relevant.length === 0) {
    return { ...withExcursion, status: "INCOMPLETE_WINDOW", evaluatedAt: new Date(nowMs).toISOString(), outcomeDetail: "No Recorder snapshots were available covering the outcome window (Recorder Engine likely wasn't running)." };
  }
  if (strikeShiftedAway) {
    return { ...withExcursion, status: "INCOMPLETE_STRIKE_SHIFTED", evaluatedAt: new Date(nowMs).toISOString(), outcomeDetail: `ATM strike moved away from ${record.strike} before the window completed — premium could no longer be tracked.` };
  }
  return { ...withExcursion, status: "NEITHER_HIT", evaluatedAt: new Date(nowMs).toISOString(), outcomeDetail: "Neither target nor stop was reached within the outcome window." };
}

// ---- Aggregation -----------------------------------------------------
// Only over DETERMINATE records (a real target/stop/neither outcome).
// PENDING and every INCOMPLETE_*/AMBIGUOUS_BOTH_HIT status are excluded —
// never interpolated into the statistics, per the architecture's hard
// rule and per the TM_V1 spec's explicit "never count ambiguous outcomes
// as wins" instruction (extended here to excluding them from the stats
// entirely, the same treatment as an INCOMPLETE_* record, rather than
// silently counting them as a loss either).

export interface OutcomeStats {
  totalRecords: number;
  determinateRecords: number;
  byStatus: Record<string, number>;
  byVerdict: Record<string, { total: number; targetHit: number; stopHit: number; neither: number }>;
  bySignal: Record<string, { total: number; targetHit: number; stopHit: number; neither: number; sufficientSample: boolean }>;
  minSampleSize: number;
}

// PROVISIONAL, not backtested — just a sane floor before a per-signal
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
