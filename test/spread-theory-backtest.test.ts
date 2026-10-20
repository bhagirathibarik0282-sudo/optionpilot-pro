import test from "node:test";
import assert from "node:assert/strict";
import { parseSpreadTheory, qualifySpreadRows, evaluateSpreadTheory, type Point } from "../spread-theory-backtest.js";

const time = (hm: string) => new Date("2026-10-12T" + hm + ":00+05:30").toISOString();
const sample = (hm: string, spot: number, ce: number, pe: number): Point => ({
  minute: time(hm), spot, ce, pe, gap: Number((ce - pe).toFixed(2)),
});
function joined(hm: string, options?: { otherSnapshot?: boolean; diagnostic?: boolean; age?: number }) {
  const minute_bucket = time(hm), q = new Date(Date.parse(minute_bucket) + 8000).toISOString();
  return {
    minute_bucket, spot_ltp: 22520, market_snapshot_id: "S1", truth_verdict: "TRUE",
    ce_ltp: 110, pe_ltp: 100, ce_snapshot_id: "S1",
    pe_snapshot_id: options?.otherSnapshot ? "S2" : "S1",
    ce_validation_status: options?.diagnostic ? "TIMESTAMP_PRESENT" : "RESEARCH_ELIGIBLE",
    pe_validation_status: "RESEARCH_ELIGIBLE",
    ce_quote_timestamp: q, pe_quote_timestamp: q,
    ce_quote_age_seconds: options?.age ?? 8, pe_quote_age_seconds: 8,
  };
}
test("rejects invalid or unbounded multi-day requests", () => {
  assert.equal(parseSpreadTheory({ symbol: "NIFTY", dates: "2026-10-08,2026-10-09" }).ok, true);
  assert.equal(parseSpreadTheory({ dates: "2026-02-30" }).ok, false);
  assert.equal(parseSpreadTheory({ symbol: "FOO", dates: "2026-10-08" }).ok, false);
  assert.equal(parseSpreadTheory({ dates: "2026-10-08,2026-10-08" }).ok, false);
  assert.equal(parseSpreadTheory({ dates: "2026-10-01,2026-10-02,2026-10-03,2026-10-04,2026-10-05,2026-10-06,2026-10-07" }).ok, false);
});
test("allows only research-eligible same snapshot quotes and rejects duplicated buckets", () => {
  const rows = [joined("09:36"), joined("09:39", { otherSnapshot: true }),
    joined("09:42", { diagnostic: true }), joined("09:45", { age: 31 }),
    joined("09:48"), joined("09:48")];
  const out = qualifySpreadRows(rows);
  assert.equal(out.observedBuckets, 5);
  assert.equal(out.excludedBuckets, 3);
  assert.equal(out.diagnosticBuckets, 1);
  assert.equal(out.contextPoints.length, 2);
  assert.equal(out.points.length, 1);
  assert.equal(out.points[0].gap, 10);
});
test("diagnostic context retains crossovers that strict research eligibility must omit", () => {
  const rows = [joined("11:32", { diagnostic: true }), joined("11:33")];
  rows[0].ce_ltp = 116.95;
  rows[1].ce_ltp = 99.05;
  const out = qualifySpreadRows(rows);
  assert.equal(out.points.length, 1);
  assert.equal(out.contextPoints.length, 2);
  const all = evaluateSpreadTheory(out.contextPoints, 1);
  const strict = evaluateSpreadTheory(out.points, 1);
  assert.equal(all.crossovers.total, 1);
  assert.equal(strict.crossovers.total, 0);
});
test("exact cadence: a missing 3m bucket cannot imply momentum or crossover", () => {
  const result = evaluateSpreadTheory([
    sample("09:33", 22510, 100, 95),
    sample("09:39", 22490, 95, 100),
    sample("09:42", 22495, 110, 100),
  ], 3);
  assert.equal(result.contemporaneous.compared, 1);
  assert.equal(result.crossovers.total, 1);
  assert.equal(result.crossovers.untested, 1);
});
test("distinguishes retrospectively held crossover from immediate reversal", () => {
  const held = evaluateSpreadTheory([
    sample("09:30", 22520, 110, 100), sample("09:33", 22510, 95, 100),
    sample("09:36", 22508, 94, 101), sample("09:39", 22505, 93, 102),
    sample("09:42", 22503, 90, 102), sample("09:48", 22495, 85, 105),
  ], 3);
  assert.equal(held.crossovers.total, 1);
  assert.equal(held.crossovers.confirmedNext3Buckets, 1);
  assert.equal(held.forward15m.compared, 1);
  assert.equal(held.forward15m.spreadDirectionMatched, 1);
  assert.equal(held.forward15m.spotMomentumBaselineMatched, 1);
  const reversed = evaluateSpreadTheory([
    sample("09:30", 22520, 110, 100), sample("09:33", 22510, 95, 100),
    sample("09:36", 22515, 108, 100), sample("09:39", 22512, 104, 100),
    sample("09:42", 22510, 102, 100),
  ], 3);
  assert.equal(reversed.crossovers.reversedWithin3Buckets, 1);
});
