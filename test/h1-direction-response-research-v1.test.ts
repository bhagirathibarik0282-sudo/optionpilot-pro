import test from "node:test";
import assert from "node:assert/strict";
import { buildH1DirectionResponseResearch } from "../h1-direction-response-research-v1.js";
import type { H1ReplayHttpResult } from "../h1-replay-http.js";

function replay(): H1ReplayHttpResult {
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: {
      symbol: "NIFTY",
      tradeDate: "2026-09-15",
      fromTime: "09:15",
      toTime: "09:21",
      scope: "FULL",
    },
    market: [
      { minute_bucket: "2026-09-15T03:45:00.000Z", spot_ltp: 100 },
      { minute_bucket: "2026-09-15T03:48:00.000Z", spot_ltp: 101 },
      { minute_bucket: "2026-09-15T03:51:00.000Z", spot_ltp: 100 },
    ],
    options: [
      { minute_bucket: "2026-09-15T03:45:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
      { minute_bucket: "2026-09-15T03:48:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 11 },
      { minute_bucket: "2026-09-15T03:51:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
      { minute_bucket: "2026-09-15T03:45:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
      { minute_bucket: "2026-09-15T03:48:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9 },
      { minute_bucket: "2026-09-15T03:51:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
    ],
  };
}

test("summarizes same-contract direction response without selecting a threshold", () => {
  const out = buildH1DirectionResponseResearch([{ tradeDate: "2026-09-15", replay: replay() }]);
  assert.equal(out.version, "H1_DIRECTION_RESPONSE_RESEARCH_V1");
  assert.equal(out.dateSummaries.length, 1);
  assert.equal(out.dateSummaries[0].marketPairCount, 2);
  assert.equal(out.combinedComparableCount, 4);
  assert.equal(out.combinedAgreementRate, 1);
  assert.equal(out.intervalWeighted.intervalCount, 2);
  assert.equal(out.intervalWeighted.bothSidesPresentIntervalCount, 2);
  assert.equal(out.intervalWeighted.meanSideBalancedAgreementShare, 1);
  assert.equal(out.intervalWeighted.strictMajorityIntervalRate, 1);
  assert.equal(out.evidenceState, "OBSERVATIONS_AVAILABLE_NO_POLICY_PROMOTION");
  assert.ok(out.blockers.includes("DIRECTION_POLICY_THRESHOLD_NOT_SELECTED"));
  assert.ok(out.blockers.includes("DIRECTION_POLICY_TEMPORAL_HOLDOUT_NOT_EVALUATED"));
  assert.equal(out.safety.thresholdSelected, false);
  assert.equal(out.safety.thresholdPromoted, false);
  assert.equal(out.safety.grantsPromotionAuthority, false);
  assert.equal(out.safety.affectsSelector, false);
  assert.equal(out.safety.affectsTelegram, false);
  assert.equal(out.safety.affectsExecution, false);
});

test("fails closed descriptively when replay observations are absent", () => {
  const out = buildH1DirectionResponseResearch([{
    tradeDate: "2026-09-15",
    replay: {
      ok: false,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request: null,
      reason: "NO_DATA",
    },
  }]);
  assert.equal(out.combinedComparableCount, 0);
  assert.equal(out.combinedAgreementRate, null);
  assert.equal(out.intervalWeighted.intervalCount, 0);
  assert.equal(out.intervalWeighted.meanSideBalancedAgreementShare, null);
  assert.equal(out.intervalWeighted.strictMajorityIntervalRate, null);
  assert.equal(out.evidenceState, "INSUFFICIENT_REPLAY_OBSERVATIONS");
  assert.equal(out.safety.failClosed, true);
});

test("interval weighting prevents many contracts in one market move from inflating independent evidence", () => {
  const t0 = "2026-09-15T03:45:00.000Z";
  const t1 = "2026-09-15T03:48:00.000Z";
  const t2 = "2026-09-15T03:51:00.000Z";
  const options: Record<string, unknown>[] = [
    { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
    { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 11 },
    { minute_bucket: t2, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10.5 },
    { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
    { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9 },
    { minute_bucket: t2, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9.5 },
  ];
  for (const strike of [101, 102, 103, 104]) {
    options.push(
      { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "CE", ltp: 10 },
      { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "CE", ltp: 11 },
      { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "PE", ltp: 10 },
      { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "PE", ltp: 9 },
    );
  }

  const uneven: H1ReplayHttpResult = {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: {
      symbol: "NIFTY",
      tradeDate: "2026-09-15",
      fromTime: "09:15",
      toTime: "09:21",
      scope: "FULL",
    },
    market: [
      { minute_bucket: t0, spot_ltp: 100 },
      { minute_bucket: t1, spot_ltp: 101 },
      { minute_bucket: t2, spot_ltp: 102 },
    ],
    options,
  };

  const out = buildH1DirectionResponseResearch([{ tradeDate: "2026-09-15", replay: uneven }]);
  assert.equal(out.combinedComparableCount, 12);
  assert.equal(out.combinedAgreementRate, 10 / 12);
  assert.equal(out.intervalWeighted.intervalCount, 2);
  assert.equal(out.intervalWeighted.bothSidesPresentIntervalCount, 2);
  assert.equal(out.intervalWeighted.meanSideBalancedAgreementShare, 0.5);
  assert.equal(out.intervalWeighted.strictMajorityIntervalRate, 0.5);
  assert.ok(out.blockers.includes("DIRECTION_POLICY_SELECTION_RUBRIC_NOT_DEFINED"));
});


test("ignores exact-3m pairs that are off the canonical replay grid", () => {
  const out = buildH1DirectionResponseResearch([{
    tradeDate: "2026-09-15",
    replay: {
      ok: true,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request: {
        symbol: "NIFTY",
        tradeDate: "2026-09-15",
        fromTime: "09:15",
        toTime: "09:21",
        scope: "FULL",
      },
      market: [
        { minute_bucket: "2026-09-15T03:45:00.000Z", spot_ltp: 100 },
        { minute_bucket: "2026-09-15T03:46:00.000Z", spot_ltp: 101 },
        { minute_bucket: "2026-09-15T03:49:00.000Z", spot_ltp: 102 },
      ],
      options: [
        { minute_bucket: "2026-09-15T03:46:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
        { minute_bucket: "2026-09-15T03:49:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 11 },
        { minute_bucket: "2026-09-15T03:46:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
        { minute_bucket: "2026-09-15T03:49:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9 },
      ],
    },
  }]);
  assert.equal(out.dateSummaries[0].marketPairCount, 0);
  assert.equal(out.intervalWeighted.intervalCount, 0);
});
