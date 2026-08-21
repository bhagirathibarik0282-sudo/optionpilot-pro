// Unit tests for outcome-engine.ts — run with: npm test
// Uses Node's built-in test runner (node:test) — no new dependency added.
import test from "node:test";
import assert from "node:assert/strict";
import { createOutcomeRecord, evaluateOutcome, computeOutcomeStats, type SnapshotForOutcome } from "../outcome-engine.js";

const BASE_MS = new Date("2026-08-10T04:00:00.000Z").getTime(); // ~9:30 IST

function baseInput(overrides: Partial<Parameters<typeof createOutcomeRecord>[0]> = {}) {
  return createOutcomeRecord({
    symbol: "NIFTY",
    tradingDate: "2026-08-10",
    verdict: "Bullish Biased",
    score: 8.5,
    maxScore: 12.5,
    confidence: "medium",
    side: "CE",
    strike: 24600,
    entry: 142,
    sl: 99.4,
    t1: 213,
    t2: 284,
    signalContributions: { futures_vwap: 1, oi_pcr: -1 },
    windowMinutes: 60,
    nowMs: BASE_MS,
    idSuffix: "test",
    ...overrides,
  });
}

function snap(minutesAfter: number, atmStrike: number | null, ceLtp: number | null, peLtp: number | null): SnapshotForOutcome {
  return {
    backendTimestamp: new Date(BASE_MS + minutesAfter * 60 * 1000).toISOString(),
    atmStrike,
    ceLtp,
    peLtp,
  };
}

test("normal case: no hit yet, window still open → stays PENDING", () => {
  const rec = baseInput();
  const snaps = [snap(3, 24600, 150, 60), snap(6, 24600, 160, 55)];
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "PENDING");
  assert.equal(result.evaluatedAt, null);
});

test("target hit: T1 reached", () => {
  const rec = baseInput();
  const snaps = [snap(3, 24600, 160, 60), snap(6, 24600, 220, 50)]; // 220 >= t1 (213), < t2 (284)
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T1_HIT");
  assert.ok(result.outcomeDetail?.includes("T1"));
});

test("target hit: T2 reached directly (gap through T1)", () => {
  const rec = baseInput();
  const snaps = [snap(3, 24600, 160, 60), snap(6, 24600, 300, 40)]; // 300 >= t2 (284)
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T2_HIT");
});

test("stop hit", () => {
  const rec = baseInput();
  const snaps = [snap(3, 24600, 130, 70), snap(6, 24600, 90, 100)]; // 90 <= sl (99.4)
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "STOP_HIT");
});

test("neither hit: window completes with data but no threshold crossed", () => {
  const rec = baseInput({ windowMinutes: 10 });
  const snaps = [snap(3, 24600, 150, 60), snap(6, 24600, 145, 65), snap(9, 24600, 155, 58)];
  const result = evaluateOutcome(rec, snaps, BASE_MS + 15 * 60 * 1000); // past the 10-min window
  assert.equal(result.status, "NEITHER_HIT");
});

test("incomplete window: no snapshots at all covering the period", () => {
  const rec = baseInput({ windowMinutes: 10 });
  const result = evaluateOutcome(rec, [], BASE_MS + 15 * 60 * 1000);
  assert.equal(result.status, "INCOMPLETE_WINDOW");
});

test("incomplete: ATM strike shifted away before window completed (stale strike tracking)", () => {
  const rec = baseInput({ windowMinutes: 10, strike: 24600 });
  // Strike moved to 24700 partway through — original 24600 premium is
  // no longer observable in later snapshots, and no hit occurred while
  // it was still trackable.
  const snaps = [snap(2, 24600, 150, 60), snap(5, 24700, 300, 20), snap(8, 24700, 310, 18)];
  const result = evaluateOutcome(rec, snaps, BASE_MS + 15 * 60 * 1000);
  assert.equal(result.status, "INCOMPLETE_STRIKE_SHIFTED");
});

test("unavailable entry data: no suggestion at decision time → INCOMPLETE_NO_ENTRY_DATA immediately, never queued", () => {
  const rec = baseInput({ side: null, strike: null, entry: null, sl: null, t1: null, t2: null });
  assert.equal(rec.status, "INCOMPLETE_NO_ENTRY_DATA");
  assert.notEqual(rec.evaluatedAt, null);
  // evaluateOutcome must be a no-op on an already-terminal record.
  const result = evaluateOutcome(rec, [snap(3, 24600, 300, 10)], BASE_MS + 60 * 60 * 1000);
  assert.equal(result.status, "INCOMPLETE_NO_ENTRY_DATA");
});

test("entry present but is zero → treated as unavailable, not a real entry", () => {
  const rec = baseInput({ entry: 0 });
  assert.equal(rec.status, "INCOMPLETE_NO_ENTRY_DATA");
});

test("evaluateOutcome never mutates the input record", () => {
  const rec = baseInput();
  const frozenCopy = JSON.parse(JSON.stringify(rec));
  evaluateOutcome(rec, [snap(3, 24600, 300, 10)], BASE_MS + 60 * 60 * 1000);
  assert.deepEqual(rec, frozenCopy);
});

test("terminal record is never re-evaluated (idempotent)", () => {
  const rec = baseInput();
  const hit = evaluateOutcome(rec, [snap(3, 24600, 300, 10)], BASE_MS + 5 * 60 * 1000);
  assert.equal(hit.status, "TARGET_T2_HIT");
  // Feed it back in with snapshots that would otherwise indicate a stop — must not change.
  const again = evaluateOutcome(hit, [snap(3, 24600, 300, 10), snap(50, 24600, 50, 200)], BASE_MS + 60 * 60 * 1000);
  assert.equal(again.status, "TARGET_T2_HIT");
  assert.equal(again.evaluatedAt, hit.evaluatedAt);
});

test("computeOutcomeStats: excludes PENDING and INCOMPLETE_* from statistics", () => {
  const target = { ...baseInput(), status: "TARGET_T1_HIT" as const };
  const stop = { ...baseInput({ idSuffix: "2" }), status: "STOP_HIT" as const };
  const pending = baseInput({ idSuffix: "3" }); // stays PENDING
  const incomplete = { ...baseInput({ idSuffix: "4" }), status: "INCOMPLETE_WINDOW" as const };

  const stats = computeOutcomeStats([target, stop, pending, incomplete]);
  assert.equal(stats.totalRecords, 4);
  assert.equal(stats.determinateRecords, 2); // only target + stop count
  assert.equal(stats.byVerdict["Bullish Biased"].total, 2);
  assert.equal(stats.byVerdict["Bullish Biased"].targetHit, 1);
  assert.equal(stats.byVerdict["Bullish Biased"].stopHit, 1);
});

test("computeOutcomeStats: per-signal stats flag insufficient sample size below the floor", () => {
  const records = [
    { ...baseInput({ idSuffix: "a" }), status: "TARGET_T1_HIT" as const },
    { ...baseInput({ idSuffix: "b" }), status: "STOP_HIT" as const },
  ];
  const stats = computeOutcomeStats(records);
  const key = "futures_vwap:positive";
  assert.equal(stats.bySignal[key].total, 2);
  assert.equal(stats.bySignal[key].sufficientSample, false); // below MIN_SAMPLE_SIZE (5)
});

test("tradingDate is carried through on the record for Journal cross-referencing", () => {
  const rec = baseInput({ tradingDate: "2026-08-11" });
  assert.equal(rec.tradingDate, "2026-08-11");
});

// Mirrors the eviction fix in server.ts (POST /api/outcome/record):
// evict the oldest NON-PENDING record first; only fall back to the
// oldest PENDING record if literally every record is still PENDING.
// The actual server-side array logic isn't imported here (it's a thin
// wrapper around outcomeRecords, not part of this pure module) — this
// test exercises the same selection rule in isolation as a stand-in,
// since a full server-level integration test is still a disclosed gap.
function pickEvictionIndex(records: { status: string }[]): number {
  const idx = records.findIndex((r) => r.status !== "PENDING");
  return idx === -1 ? 0 : idx;
}

test("eviction rule: prefers evicting a terminal record over a PENDING one", () => {
  const records = [{ status: "PENDING" }, { status: "TARGET_T1_HIT" }, { status: "PENDING" }];
  assert.equal(pickEvictionIndex(records), 1); // the terminal one, not index 0
});

test("eviction rule: falls back to oldest PENDING only if nothing is terminal yet", () => {
  const records = [{ status: "PENDING" }, { status: "PENDING" }];
  assert.equal(pickEvictionIndex(records), 0);
});

// ============================================================================
// TM_V1 forward-only validation plan additions (2026-08-21)
// ============================================================================

test("TM_V1: AMBIGUOUS_BOTH_HIT is provably unreachable from LTP-only snapshots (documented limitation, not a missed case)", () => {
  // Proof by construction: evaluateOutcome returns on the FIRST snapshot
  // that crosses any threshold, so at the start of every loop iteration
  // the "previous" premium is always still strictly between SL and T1
  // (either the initial `entry`, or an earlier snapshot that was already
  // checked and found NOT to be a hit). A single later premium value
  // cannot simultaneously be <= SL and >= T1/T2 (sl < entry < t1 <= t2
  // always holds for a valid plan), so no observable snapshot sequence
  // can ever produce AMBIGUOUS_BOTH_HIT from this engine. Even an extreme
  // one-sample jump lands on exactly one side, never both:
  const rec = baseInput({ entry: 150, sl: 120, t1: 180, t2: 220 });
  const extremeJump = [snap(3, 24600, 100000, 1)]; // an absurd jump straight past every level
  const result = evaluateOutcome(rec, extremeJump, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T2_HIT"); // resolves cleanly, never AMBIGUOUS_BOTH_HIT
  // A close-but-clean crossing (not a jump) also resolves cleanly, not ambiguously:
  const closeCrossing = [snap(3, 24600, 178, 60), snap(6, 24600, 181, 55)]; // 178 (below t1=180, no hit) then 181 (>= t1)
  const result2 = evaluateOutcome(rec, closeCrossing, BASE_MS + 10 * 60 * 1000);
  assert.equal(result2.status, "TARGET_T1_HIT");
});

test("TM_V1: excursion (MAE/MFE) tracked correctly for a winning trade", () => {
  const rec = baseInput({ entry: 150, sl: 120, t1: 180, t2: 220 }); // R = 30
  // Dips to 135 first (adverse, 15 below entry), then rallies to 190 (favorable, 40 above entry) which is >= t1(180).
  const snaps = [snap(3, 24600, 135, 60), snap(6, 24600, 190, 20)];
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T1_HIT");
  assert.equal(result.maePremium, 15); // 150 - 135
  assert.equal(result.mfePremium, 40); // 190 - 150
  assert.equal(result.maeR, Number((15 / 30).toFixed(3)));
  assert.equal(result.mfeR, Number((40 / 30).toFixed(3)));
});

test("TM_V1: excursion stays null when no strike-matched snapshots exist", () => {
  const rec = baseInput({ windowMinutes: 10 });
  const result = evaluateOutcome(rec, [], BASE_MS + 15 * 60 * 1000);
  assert.equal(result.maePremium, null);
  assert.equal(result.mfePremium, null);
});

test("TM_V1: excursion updates live while still PENDING (not just on terminal records)", () => {
  const rec = baseInput({ windowMinutes: 60 });
  const snaps = [snap(3, 24600, 160, 60)]; // above entry(142), below t1(213) -- no hit yet
  const result = evaluateOutcome(rec, snaps, BASE_MS + 5 * 60 * 1000);
  assert.equal(result.status, "PENDING");
  assert.equal(result.mfePremium, 18); // 160 - 142
  assert.equal(result.maePremium, 0); // never went below entry
});

test("TM_V1: pass-through fields (planId/horizon/clamp audit/context tags) survive create + evaluate unchanged", () => {
  const rec = baseInput({
    planId: "tm1-test-plan",
    horizon: "30m",
    rawRiskDistance: 45.6,
    clampedRiskDistance: 42.6,
    clampApplied: "MAX",
    deltaSource: "OBSERVED",
    marketRegime: "UP",
    expiryType: "WEEKLY",
    signalType: "M12b",
  });
  assert.equal(rec.tmVersion, "TM_V1");
  assert.equal(rec.planId, "tm1-test-plan");
  assert.equal(rec.horizon, "30m");
  assert.equal(rec.observationResolution, "3MIN_LTP_SAMPLED");
  assert.equal(rec.rawRiskDistance, 45.6);
  assert.equal(rec.clampedRiskDistance, 42.6);
  assert.equal(rec.clampApplied, "MAX");
  assert.equal(rec.deltaSource, "OBSERVED");
  assert.equal(rec.marketRegime, "UP");
  assert.equal(rec.expiryType, "WEEKLY");
  assert.equal(rec.signalType, "M12b");

  const result = evaluateOutcome(rec, [snap(3, 24600, 300, 10)], BASE_MS + 60 * 60 * 1000);
  // Fields must survive through evaluateOutcome unchanged (it never touches them).
  assert.equal(result.planId, "tm1-test-plan");
  assert.equal(result.clampApplied, "MAX");
});

test("TM_V1: pre-existing callers that omit the new optional fields still get sane defaults", () => {
  const rec = baseInput(); // none of the TM_V1 fields passed
  assert.equal(rec.tmVersion, "TM_V1");
  assert.equal(rec.planId, null);
  assert.equal(rec.horizon, null);
  assert.equal(rec.rawRiskDistance, null);
  assert.equal(rec.clampApplied, null);
  assert.equal(rec.marketRegime, null);
});

test("computeOutcomeStats: AMBIGUOUS_BOTH_HIT records are excluded from determinate stats (never counted as a win or a loss)", () => {
  const rec = baseInput({ entry: 150, sl: 120, t1: 180, t2: 220 });
  const ambiguous = { ...rec, status: "AMBIGUOUS_BOTH_HIT" as const, evaluatedAt: new Date().toISOString(), outcomeDetail: "test" };
  const stats = computeOutcomeStats([ambiguous]);
  assert.equal(stats.totalRecords, 1);
  assert.equal(stats.determinateRecords, 0);
  assert.equal(stats.byStatus["AMBIGUOUS_BOTH_HIT"], 1);
});

// ============================================================================
// T3 (2026-08-21, "premium-only" live-tracking group addition): a third,
// fuller target beyond T1/T2.
// ============================================================================

test("T3: hit directly when premium gaps straight through T1/T2/T3 in one snapshot", () => {
  const rec = baseInput({ entry: 150, sl: 120, t1: 180, t2: 220, t3: 300 });
  const snaps = [snap(3, 24600, 350, 10)]; // 350 >= t3 (300)
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T3_HIT");
  assert.ok(result.outcomeDetail?.includes("T3"));
});

test("T3: T2 still resolves correctly when premium reaches T2 but not T3", () => {
  const rec = baseInput({ entry: 150, sl: 120, t1: 180, t2: 220, t3: 300 });
  const snaps = [snap(3, 24600, 250, 10)]; // >= t2 (220), < t3 (300)
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T2_HIT");
});

test("T3: a record created without t3 (pre-T3 caller) never produces TARGET_T3_HIT, falls through to T2/T1 as before", () => {
  const rec = baseInput({ entry: 150, sl: 120, t1: 180, t2: 220 }); // t3 omitted -> null
  assert.equal(rec.t3, null);
  const snaps = [snap(3, 24600, 1000, 1)]; // an absurd premium -- still can't match a null t3
  const result = evaluateOutcome(rec, snaps, BASE_MS + 10 * 60 * 1000);
  assert.equal(result.status, "TARGET_T2_HIT"); // falls through to T2, the next real threshold
});

test("computeOutcomeStats: TARGET_T3_HIT counts as a determinate target hit everywhere (byVerdict, byHorizon)", () => {
  const rec = { ...baseInput({ entry: 150, sl: 120, t1: 180, t2: 220, t3: 300, horizon: "30m" }), status: "TARGET_T3_HIT" as const };
  const stats = computeOutcomeStats([rec]);
  assert.equal(stats.determinateRecords, 1);
  assert.equal(stats.byVerdict["Bullish Biased"].targetHit, 1);
  assert.equal(stats.byHorizon["30m"].targetHit, 1);
});

// ============================================================================
// TM_V1 dashboard stat additions (2026-08-21): byHorizon, clampFrequency,
// avgMaeR/avgMfeR
// ============================================================================

test("computeOutcomeStats: byHorizon groups determinate records by their observation horizon", () => {
  const rec30 = { ...baseInput({ entry: 150, sl: 120, t1: 180, t2: 220, horizon: "30m" }), status: "TARGET_T1_HIT" as const };
  const rec60a = { ...baseInput({ idSuffix: "b", entry: 150, sl: 120, t1: 180, t2: 220, horizon: "60m" }), status: "STOP_HIT" as const };
  const rec60b = { ...baseInput({ idSuffix: "c", entry: 150, sl: 120, t1: 180, t2: 220, horizon: "60m" }), status: "TARGET_T2_HIT" as const };
  const pendingNoHorizon = baseInput({ idSuffix: "d" }); // stays PENDING, excluded from byHorizon (not determinate)
  const stats = computeOutcomeStats([rec30, rec60a, rec60b, pendingNoHorizon]);
  assert.equal(stats.byHorizon["30m"].total, 1);
  assert.equal(stats.byHorizon["30m"].targetHit, 1);
  assert.equal(stats.byHorizon["60m"].total, 2);
  assert.equal(stats.byHorizon["60m"].targetHit, 1);
  assert.equal(stats.byHorizon["60m"].stopHit, 1);
  assert.equal(stats.byHorizon["EOD"], undefined); // never fabricates an entry for a horizon with zero records
});

test("computeOutcomeStats: pre-TM_V1 / horizon-less records are skipped from byHorizon, not fabricated in", () => {
  const rec = { ...baseInput({ entry: 150, sl: 120, t1: 180, t2: 220 }), status: "TARGET_T1_HIT" as const }; // horizon defaults to null
  const stats = computeOutcomeStats([rec]);
  assert.deepEqual(stats.byHorizon, {});
});

test("computeOutcomeStats: clampFrequency counts MIN/MAX/NONE across ALL records (clamp decided at plan time, not outcome time)", () => {
  const min1 = baseInput({ idSuffix: "a", clampApplied: "MIN" }); // stays PENDING -- still counted, clamp is plan-time
  const max1 = baseInput({ idSuffix: "b", clampApplied: "MAX" });
  const none1 = { ...baseInput({ idSuffix: "c", clampApplied: "NONE" }), status: "STOP_HIT" as const };
  const unknown1 = baseInput({ idSuffix: "d" }); // clampApplied omitted -> null
  const stats = computeOutcomeStats([min1, max1, none1, unknown1]);
  assert.equal(stats.clampFrequency.MIN, 1);
  assert.equal(stats.clampFrequency.MAX, 1);
  assert.equal(stats.clampFrequency.NONE, 1);
  assert.equal(stats.clampFrequency.unknown, 1);
});

test("computeOutcomeStats: avgMaeR/avgMfeR average only determinate records with a real R, stay null with no qualifying data", () => {
  const noData = computeOutcomeStats([baseInput()]); // PENDING, no excursion computed yet
  assert.equal(noData.avgMaeR, null);
  assert.equal(noData.avgMfeR, null);

  // Two determinate records with pre-set maeR/mfeR (as evaluateOutcome would attach them).
  const rec1 = { ...baseInput({ idSuffix: "a", entry: 150, sl: 120, t1: 180, t2: 220 }), status: "TARGET_T1_HIT" as const, maeR: 0.2, mfeR: 1.1 };
  const rec2 = { ...baseInput({ idSuffix: "b", entry: 150, sl: 120, t1: 180, t2: 220 }), status: "STOP_HIT" as const, maeR: 1.0, mfeR: 0.3 };
  const stats = computeOutcomeStats([rec1, rec2]);
  assert.equal(stats.avgMaeR, Number(((0.2 + 1.0) / 2).toFixed(3)));
  assert.equal(stats.avgMfeR, Number(((1.1 + 0.3) / 2).toFixed(3)));
});

test("computeOutcomeStats: tmV1RecordCount counts every TM_V1-stamped record regardless of status", () => {
  const a = baseInput({ idSuffix: "a" }); // PENDING
  const b = { ...baseInput({ idSuffix: "b" }), status: "INCOMPLETE_WINDOW" as const };
  const stats = computeOutcomeStats([a, b]);
  assert.equal(stats.tmV1RecordCount, 2); // both stamped tmVersion: "TM_V1" by createOutcomeRecord
});
