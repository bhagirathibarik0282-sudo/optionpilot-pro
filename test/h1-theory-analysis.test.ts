import test from "node:test";
import assert from "node:assert/strict";
import { analyzeH1TheoryReplay } from "../h1-theory-analysis.js";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";

const request: H1ReplayRequest = { symbol: "NIFTY", tradeDate: "2026-09-02", fromTime: "09:15", toTime: "10:00", scope: "CORE" };

function replay(): H1ReplayHttpResult {
  const market = [];
  const chain = [];
  const options = [];
  for (let i = 0; i <= 15; i += 1) {
    const minute = 15 + i * 3;
    const timestamp = `2026-09-02T${minute < 60 ? "03" : "04"}:${String(minute % 60).padStart(2, "0")}:00.000Z`;
    const spot = i < 6 ? 24000 - i * 2 : 23988 + (i - 5) * 8;
    market.push({ minute_bucket: timestamp, truth_verdict: "TRUE", spot_ltp: spot, future_ltp: spot + 100, future_oi: 1_000_000 + i * 1_000 });
    chain.push({ minute_bucket: timestamp, expiry: "2026-09-08", band7_oi_pcr: 0.8 + i * 0.01, call_wall_strike: i < 6 ? 24100 : 24200, put_wall_strike: i < 6 ? 23900 : 24000, atm_iv: 12 + i * 0.02 });
    options.push(
      { minute_bucket: timestamp, expiry: "2026-09-08", atm_offset: 0, option_type: "CE", ltp: 100 + i * 5 },
      { minute_bucket: timestamp, expiry: "2026-09-08", atm_offset: 0, option_type: "PE", ltp: 120 - i * 3 },
    );
  }
  return { ok: true, mode: "READ_ONLY_H1_3M_REPLAY", productionImpact: "NONE", request, counts: { market: market.length, chain: chain.length, options: options.length, markers: market.length }, market, chain, options };
}

test("builds fail-closed date-wise 3m/6m/15m/30m theory evidence", () => {
  const result = analyzeH1TheoryReplay(request, replay());
  assert.equal(result.ok, true);
  assert.deepEqual(result.latestWindows.map((row) => row.windowMinutes), [3, 6, 15, 30]);
  assert.equal(result.latestWindows[3].status, "VERIFIED_OBSERVATION");
  assert.equal(result.dayVerdict, "BULLISH");
  assert.equal(result.affectsExecution, false);
  assert.equal(result.labels.includes("PROVISIONAL_HYPOTHESIS"), true);
  assert.equal(result.dataQuality.coverageStatus, "PARTIAL");
  assert.equal(result.cas.state, "UNAVAILABLE");
});

test("does not convert missing replay evidence into a neutral verdict", () => {
  const result = analyzeH1TheoryReplay(request, { ok: false, mode: "READ_ONLY_H1_3M_REPLAY", productionImpact: "NONE", request, reason: "NO_ROWS" });
  assert.equal(result.ok, false);
  assert.equal(result.dayVerdict, "UNAVAILABLE");
  assert.equal(result.dataQuality.coverageStatus, "INSUFFICIENT");
  assert.equal(result.cas.evidenceStatus, "DATA_UNAVAILABLE");
});

test("excludes non-TRUE truth-marker rows from theory evidence", () => {
  const source = replay();
  source.market = source.market?.map((row, index) => index === 0 ? { ...row, truth_verdict: "STALE" } : row);
  const result = analyzeH1TheoryReplay(request, source);
  assert.equal(result.dataQuality.marketMinutes, 15);
  assert.equal(result.dataQuality.coverageStatus, "PARTIAL");
  assert.equal(result.dataQuality.markerCount, 15);
});
