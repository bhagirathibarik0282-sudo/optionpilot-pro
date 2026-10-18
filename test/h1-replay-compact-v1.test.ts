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
    queryTimingsMs: { market: 12.3, raw_gaps: 0 },
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
  assert.deepEqual(compact.queryTimingsMs, source.queryTimingsMs);
  assert.deepEqual(compact.continuity, source.continuity);
  assert.deepEqual(expandRows(compact.market!), source.market);
  assert.deepEqual(expandRows(compact.options!), source.options);
  assert.deepEqual(expandRows(compact.chain!), source.chain);
  assert.deepEqual(expandRows(compact.canonical!), source.canonical);
});

test("dashboard projection removes duplicated strike archives while preserving displayed data and calibration", async () => {
  const { deriveObservationData } = await import("../business-dashboard-v1-view.js");
  const bucket = "2026-10-16T10:00:00Z";
  const source: any = {
    ok: true, request: { symbol: "NIFTY", tradeDate: "2026-10-16", fromTime: "15:27", toTime: "15:30", scope: "FULL" },
    market: [{ symbol: "NIFTY", minute_bucket: bucket, spot_ltp: 23000 }],
    options: [{ symbol: "NIFTY", minute_bucket: bucket, expiry: "2026-10-20", strike: 23000, option_type: "CE", ltp: 155.9, oi: 7215260 }],
    chain: [{ symbol: "NIFTY", minute_bucket: bucket, expiry: "2026-10-20", truth_verdict: "TRUE", calculation_version: "H1_RUNTIME_BRIDGE_V1", full_chain_oi_pcr: 0.5 }],
    canonical: [{ symbol: "NIFTY", minute_bucket: bucket, source_timestamp: bucket, truth_verdict: "TRUE", calculation_version: "H1_RUNTIME_BRIDGE_V1", market: {
      symbol: "NIFTY", gapScore: { fullChainPcr: 1.3158 },
      expiries: [{ expiry: "current", expiryDate: "2026-10-20", ceStrikes: Array.from({ length: 100 }, (_, strike) => ({ strike, oi: 100000 })), peStrikes: [] }],
    } }],
  };
  const original = JSON.stringify(source);
  const full = compactH1Replay(source), projected = compactH1Replay(source, true);
  assert.equal(full.lossless, true);
  assert.equal(projected.lossless, false);
  assert.equal(projected.canonicalProjection, "PCR_PROVENANCE_V1");
  assert.deepEqual(deriveObservationData(projected), deriveObservationData(full));
  assert.equal(deriveObservationData(projected).chain[0].full_chain_oi_pcr, 1.3158);
  assert.deepEqual(projected.dte0Calibration, full.dte0Calibration);
  assert.deepEqual(projected.options, full.options);
  assert.ok(JSON.stringify(projected).length < JSON.stringify(full).length);
  assert.equal(JSON.stringify(source), original, "projection must not mutate source archives");
});

test("dashboard PCR projection preserves duplicate, mismatched and unavailable evidence", async () => {
  const { resolveRecordedFullPcr } = await import("../business-dashboard-v1-view.js");
  const row: any = { symbol: "NIFTY", minute_bucket: "2026-10-16T10:00:00Z", truth_verdict: "TRUE", calculation_version: "H1_RUNTIME_BRIDGE_V1", expiry: "2026-10-20" };
  const canonical = { ...row, market: { symbol: "NIFTY", gapScore: { fullChainPcr: 1.3158 }, expiries: [{ expiry: "current", expiryDate: row.expiry }] } };
  const variants = [[], [canonical, canonical], [{ ...canonical, symbol: "SENSEX" }], [{ ...canonical, truth_verdict: "FALSE" }], [{ ...canonical, market: { ...canonical.market, expiries: [canonical.market.expiries[0], canonical.market.expiries[0]] } }], [{ ...canonical, market: null }], [{ ...canonical, market: { ...canonical.market, gapScore: { fullChainPcr: "1.3158" } } }]];
  for (const records of variants) {
    const source: any = { ok: false, request: null, chain: [row], canonical: records };
    const full = compactH1Replay(source), projected = compactH1Replay(source, true);
    assert.deepEqual(resolveRecordedFullPcr(projected), resolveRecordedFullPcr(full));
    assert.equal(resolveRecordedFullPcr(projected)[0].full_chain_oi_pcr, null);
  }
});
