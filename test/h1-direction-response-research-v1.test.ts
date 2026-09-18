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
  assert.equal(out.evidenceState, "INSUFFICIENT_REPLAY_OBSERVATIONS");
  assert.equal(out.safety.failClosed, true);
});
