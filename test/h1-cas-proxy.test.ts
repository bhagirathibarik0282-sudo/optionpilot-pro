import test from "node:test";
import assert from "node:assert/strict";
import { analyzeH1CasProxy } from "../h1-cas-proxy.js";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";

const request: H1ReplayRequest = { symbol: "NIFTY", tradeDate: "2026-09-02", fromTime: "09:15", toTime: "15:30", scope: "CORE" };

function replay(distorted = false): H1ReplayHttpResult {
  const market = []; const chain = []; const options = [];
  for (let i = 0; i <= 10; i += 1) {
    const timestamp = new Date(Date.parse("2026-09-02T09:30:00.000Z") + i * 3 * 60_000).toISOString();
    const closingStep = Math.max(0, i - 5);
    const spot = 24000 + closingStep * 5;
    const future = distorted ? 24100 - closingStep * 3 : spot + 100;
    market.push({ minute_bucket: timestamp, truth_verdict: "TRUE", spot_ltp: spot, future_ltp: future, future_oi: 1_000_000 + closingStep * 2_000 });
    chain.push({ minute_bucket: timestamp, expiry: "2026-09-08", band7_oi_pcr: 0.9 + closingStep * 0.01, call_wall_strike: 24200, put_wall_strike: 23900, atm_iv: 12 + closingStep * 0.05 });
    const spread = distorted && i >= 5 ? 8 : 2;
    options.push(
      { minute_bucket: timestamp, expiry: "2026-09-08", atm_offset: 0, option_type: "CE", ltp: 100 + closingStep * 6, bid: 99, ask: 99 + spread, volume: 1000 + closingStep * 100 },
      { minute_bucket: timestamp, expiry: "2026-09-08", atm_offset: 0, option_type: "PE", ltp: distorted ? 100 + closingStep * 2 : 100 - closingStep * 4, bid: 99, ask: 99 + spread, volume: 1000 + closingStep * 80 },
    );
  }
  return { ok: true, mode: "READ_ONLY_H1_3M_REPLAY", productionImpact: "NONE", request, counts: { market: market.length, chain: chain.length, options: options.length, markers: market.length }, market, chain, options };
}

test("classifies aligned closing evidence as a bullish pressure proxy", () => {
  const result = analyzeH1CasProxy(request, replay());
  assert.equal(result.state, "DIRECTIONAL_PRESSURE_PROXY");
  assert.equal(result.direction, "BULLISH");
  assert.equal(result.metrics.responseEfficiency, "CONFIRMED");
  assert.equal(result.nextSessionRiskMap, "BULLISH_CLOSING_PRESSURE");
  assert.equal(result.fullCasReadiness.ready, false);
  assert.equal(result.affectsExecution, false);
});

test("flags expanded spreads plus conflicting futures/premiums as distortion risk", () => {
  const result = analyzeH1CasProxy(request, replay(true));
  assert.equal(result.state, "MICROSTRUCTURE_DISTORTION_RISK");
  assert.equal(result.evidenceStatus, "CONFLICT");
  assert.equal(result.nextSessionRiskMap, "DISTORTION_RISK");
});

test("fails closed when the close windows are absent", () => {
  const result = analyzeH1CasProxy(request, { ok: false, mode: "READ_ONLY_H1_3M_REPLAY", productionImpact: "NONE", request, reason: "NO_ROWS" });
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.evidenceStatus, "DATA_UNAVAILABLE");
  assert.ok(result.missing.includes("INDICATIVE_CLOSE"));
});
