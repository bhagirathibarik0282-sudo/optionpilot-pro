// Unit tests for outcome-engine.ts — run with: npx tsx test/outcome-engine.test.ts
// Uses Node's built-in test runner (node:test) — no new dependency added.
import test from "node:test";
import assert from "node:assert/strict";
import { createOutcomeRecord, evaluateOutcome, computeOutcomeStats, type SnapshotForOutcome } from "../outcome-engine.js";

const BASE_MS = new Date("2026-08-10T04:00:00.000Z").getTime(); // ~9:30 IST

function baseInput(overrides: Partial<Parameters<typeof createOutcomeRecord>[0]> = {}) {
  return createOutcomeRecord({
    symbol: "NIFTY",
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
