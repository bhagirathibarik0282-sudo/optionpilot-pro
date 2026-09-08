import test from "node:test";
import assert from "node:assert/strict";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";
import {
  buildH1EodBusinessBacktestSummary,
  H1_EOD_BUSINESS_BACKTEST_MAX_TOP,
  parseH1EodBusinessBacktestTop,
} from "../h1-eod-business-backtest-summary-v1.js";

const request: H1ReplayRequest = {
  symbol: "NIFTY",
  tradeDate: "2026-09-08",
  fromTime: "09:15",
  toTime: "15:30",
  scope: "CORE",
};

function optionRow(minute_bucket: string, ltp: number, delta: number, dte = 0) {
  return {
    minute_bucket: new Date(minute_bucket),
    expiry: dte === 0 ? "2026-09-08" : "2026-09-15",
    expiry_bucket: "Current Expiry",
    dte,
    strike: 23650,
    option_type: "PE",
    atm_offset: 0,
    ltp,
    delta,
    gamma: 0.005075,
    theta: -323.7757547966657,
    iv: 28.99065277570466,
    liquidity_status: "TIGHT",
    validation_status: "RESEARCH_ELIGIBLE",
  };
}

const replay: H1ReplayHttpResult = {
  ok: true,
  mode: "READ_ONLY_H1_3M_REPLAY",
  productionImpact: "NONE",
  request,
  counts: { market: 2, options: 5, chain: 1, markers: 2, canonical: 2 },
  market: [
    {
      minute_bucket: new Date("2026-09-08T03:45:00.000Z"),
      spot_ltp: 23743.1,
      spot_open: 23743.1,
      spot_high: 23758.95,
      spot_low: 23623.1,
      spot_prev_close: 23779.15,
    },
    {
      minute_bucket: new Date("2026-09-08T08:51:00.000Z"),
      spot_ltp: 23670,
      spot_open: 23743.1,
      spot_high: 23758.95,
      spot_low: 23623.1,
      spot_prev_close: 23779.15,
      vwap: 23700,
      future_ltp: 23705,
      future_oi: 1000,
      future_oi_change: 20,
      future_basis: 35,
      india_vix: 12.1,
      india_vix_change: 0.2,
    },
  ],
  options: [
    optionRow("2026-09-08T08:48:00.000Z", 27.05, -0.4580926637474765),
    optionRow("2026-09-08T08:51:00.000Z", 29.6, -0.4815095726092138),
    optionRow("2026-09-08T08:57:00.000Z", 31, -0.49),
    optionRow("2026-09-08T09:06:00.000Z", 33, -0.51),
    optionRow("2026-09-08T09:21:00.000Z", 36, -0.53),
  ],
  chain: [
    {
      minute_bucket: new Date("2026-09-08T08:51:00.000Z"),
      expiry_bucket: "Current Expiry",
      full_chain_oi_pcr: 0.63,
      band7_oi_pcr: 0.74,
      volume_pcr: 1.12,
      max_pain: 23650,
      call_wall_strike: 23700,
      put_wall_strike: 23600,
    },
  ],
  continuity: {
    cadenceMinutes: 3,
    expectedBuckets: 126,
    observedMarkerBuckets: 125,
    missingBuckets: ["2026-09-08T10:00:00.000Z"],
    firstObserved: "2026-09-08T03:45:00.000Z",
    lastObserved: "2026-09-08T09:59:00.000Z",
    coveragePct: 99.2,
    complete: false,
    truthCounts: { TRUE: 120, STALE: 5 },
    canonicalArchiveBuckets: 125,
    canonicalCoveragePct: 99.2,
    allParameterArchiveSemantics: "FULL_RUNTIME_INDEX_METRICS_JSONB",
  },
};

test("EOD business summary stays bounded and preserves Sep-8 PE response evidence", () => {
  const result = buildH1EodBusinessBacktestSummary(request, replay, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.mode, "H1_EOD_BUSINESS_BACKTEST_SUMMARY_V1");
  assert.equal(result.canonicalLiveProof, false);
  assert.equal(result.selectorQualificationProven, false);
  assert.equal(result.boundedOutput.rawOptionRowsOmitted, true);
  assert.equal(result.transitionEvidence.topReturned, 1);
  assert.equal(result.transitionEvidence.windows[0].side, "PE");
  assert.equal(result.transitionEvidence.windows[0].dte, 0);
  assert.ok((result.transitionEvidence.windows[0].observed.premiumMovePct ?? 0) > 9);
  assert.equal(result.transitionEvidence.windows[0].responsePolicy?.premiumPass, true);
  assert.equal(result.transitionEvidence.windows[0].responsePolicy?.deltaPass, false);
  assert.equal(result.dte0Evidence.thresholdPromoted, false);
  assert.equal(result.safety.affectsTelegram, false);
  assert.equal(result.safety.affectsExecution, false);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('"options"'), false);
  assert.equal(serialized.includes('"market"'), false);
  assert.ok(serialized.length < 25_000);
});

test("non-DTE0 transitions are compacted without inventing a policy", () => {
  const nonDteReplay: H1ReplayHttpResult = {
    ...replay,
    options: [
      optionRow("2026-09-08T05:00:00.000Z", 100, -0.4, 7),
      optionRow("2026-09-08T05:03:00.000Z", 106, -0.42, 7),
    ],
  };
  const result = buildH1EodBusinessBacktestSummary(request, nonDteReplay, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.transitionEvidence.topReturned, 1);
  assert.equal(result.transitionEvidence.windows[0].dte, 7);
  assert.equal(result.transitionEvidence.windows[0].responsePolicy, null);
  assert.equal(result.transitionEvidence.windows[0].responsePolicySource, "NOT_APPLIED_OUTSIDE_DTE0");
  assert.equal(result.transitionEvidence.windows[0].selectorQualification, "NOT_PROVEN_FROM_HISTORICAL_REPLAY");
});

test("top is fail-closed to 1..20", () => {
  assert.deepEqual(parseH1EodBusinessBacktestTop(undefined), { ok: true, value: 10 });
  assert.deepEqual(parseH1EodBusinessBacktestTop("1"), { ok: true, value: 1 });
  assert.deepEqual(parseH1EodBusinessBacktestTop(String(H1_EOD_BUSINESS_BACKTEST_MAX_TOP)), { ok: true, value: 20 });
  assert.deepEqual(parseH1EodBusinessBacktestTop("0"), { ok: false, reason: "INVALID_TOP" });
  assert.deepEqual(parseH1EodBusinessBacktestTop("21"), { ok: false, reason: "INVALID_TOP" });
  assert.deepEqual(parseH1EodBusinessBacktestTop("1.5"), { ok: false, reason: "INVALID_TOP" });
});
