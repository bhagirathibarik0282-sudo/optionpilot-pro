import test from "node:test";
import assert from "node:assert/strict";
import { buildH1Dte0TransitionCalibration } from "../h1-dte0-transition-calibration-v1.js";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";

const request: H1ReplayRequest = {
  symbol: "NIFTY",
  tradeDate: "2026-09-08",
  fromTime: "14:18",
  toTime: "14:21",
  scope: "CORE",
};

test("DTE0 transition calibration accepts PostgreSQL Date buckets and remains read-only", () => {
  const replay: H1ReplayHttpResult = {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request,
    counts: { market: 2, options: 2, chain: 0, markers: 2, canonical: 2 },
    options: [
      {
        minute_bucket: new Date("2026-09-08T08:48:00.000Z"),
        expiry_bucket: "Current Expiry",
        dte: 0,
        strike: 23650,
        option_type: "PE",
        atm_offset: 0,
        ltp: 27.05,
        delta: -0.4580926637474765,
        gamma: 0.005122,
        theta: -304.7342168577404,
        iv: 27.992511932688004,
        liquidity_status: "TIGHT",
        validation_status: "RESEARCH_ELIGIBLE",
      },
      {
        minute_bucket: new Date("2026-09-08T08:51:00.000Z"),
        expiry_bucket: "Current Expiry",
        dte: 0,
        strike: 23650,
        option_type: "PE",
        atm_offset: 0,
        ltp: 29.6,
        delta: -0.4815095726092138,
        gamma: 0.005075,
        theta: -323.7757547966657,
        iv: 28.99065277570466,
        liquidity_status: "TIGHT",
        validation_status: "RESEARCH_ELIGIBLE",
      },
    ],
  };

  const result = buildH1Dte0TransitionCalibration(request, replay);
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.safety.readOnly, true);
  assert.equal(result.safety.affectsSelector, false);
  assert.equal(result.safety.affectsTelegram, false);
  assert.equal(result.safety.affectsExecution, false);
  assert.equal(result.safety.thresholdPromoted, false);
  assert.equal(result.safety.dte0ThresholdInvented, false);
  assert.equal(result.atmDte0PointCount, 2);
  assert.equal(result.windowCount, 1);

  const window = result.windows[0];
  assert.equal(window.side, "PE");
  assert.equal(window.from, "2026-09-08T08:48:00.000Z");
  assert.equal(window.to, "2026-09-08T08:51:00.000Z");
  assert.ok((window.observed.premiumMovePct ?? 0) > 9);
  assert.ok(window.observed.absoluteDeltaChange > 0.02);
  assert.ok(window.observed.absoluteDeltaChange < 0.03);
  assert.equal(window.currentPolicy.premiumPass, true);
  assert.equal(window.currentPolicy.deltaPass, false);
  assert.equal(window.currentPolicy.gammaPass, true);
  assert.equal(window.currentPolicy.deltaGammaPass, false);
  assert.equal(window.thresholdPromoted, false);
});
