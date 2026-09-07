import test from "node:test";
import assert from "node:assert/strict";
import { compactH1Replay, compactRows, expandRows } from "../h1-replay-compact-v1.js";

test("compact rows round-trip without value loss", () => {
  const source = [
    { symbol: "NIFTY", strike: 24000, option_type: "CE", ltp: 101.25, delta: 0.51, valid: true, note: null },
    { symbol: "NIFTY", strike: 24050, option_type: "PE", ltp: 97.8, delta: -0.47, valid: false, note: "x" },
  ];
  const compact = compactRows(source);
  assert.deepEqual(expandRows(compact), source);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(source).length);
});

test("compact replay preserves counts, continuity and authority boundary", () => {
  const source: any = {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: { symbol: "NIFTY", tradeDate: "2026-09-07", fromTime: "09:15", toTime: "15:30", scope: "CORE" },
    counts: { market: 1, options: 2, chain: 1, markers: 1, canonical: 1 },
    market: [{ symbol: "NIFTY", minute_bucket: "2026-09-07T03:45:00.000Z", spot_ltp: 24000 }],
    options: [{ symbol: "NIFTY", strike: 24000, option_type: "CE", ltp: 100 }, { symbol: "NIFTY", strike: 24000, option_type: "PE", ltp: 95 }],
    chain: [{ symbol: "NIFTY", call_wall_strike: 24100, put_wall_strike: 23900 }],
    canonical: [{ symbol: "NIFTY", market: { spot: 24000 } }],
    continuity: { cadenceMinutes: 3, expectedBuckets: 1, observedMarkerBuckets: 1, missingBuckets: [], firstObserved: "2026-09-07T03:45:00.000Z", lastObserved: "2026-09-07T03:45:00.000Z", coveragePct: 100, complete: true, truthCounts: { TRUE: 1 }, canonicalArchiveBuckets: 1, canonicalCoveragePct: 100, allParameterArchiveSemantics: "FULL_RUNTIME_INDEX_METRICS_JSONB" },
  };
  const compact = compactH1Replay(source);
  assert.equal(compact.mode, "READ_ONLY_H1_3M_REPLAY_COMPACT_V1");
  assert.equal(compact.productionImpact, "NONE");
  assert.equal(compact.lossless, true);
  assert.deepEqual(compact.counts, source.counts);
  assert.deepEqual(compact.continuity, source.continuity);
  assert.deepEqual(expandRows(compact.market!), source.market);
  assert.deepEqual(expandRows(compact.options!), source.options);
  assert.deepEqual(expandRows(compact.chain!), source.chain);
  assert.deepEqual(expandRows(compact.canonical!), source.canonical);
});
