import test from "node:test";
import assert from "node:assert/strict";
import { runH1DirectionResponseResearchHttp } from "../h1-direction-response-research-http-v1.js";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";

function replay(request: H1ReplayRequest): H1ReplayHttpResult {
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request,
    counts: { market: 2, options: 4, chain: 0, markers: 2, canonical: 2 },
    market: [
      { minute_bucket: `${request.tradeDate}T03:45:00.000Z`, spot_ltp: 100 },
      { minute_bucket: `${request.tradeDate}T03:48:00.000Z`, spot_ltp: 101 },
    ],
    options: [
      { minute_bucket: `${request.tradeDate}T03:45:00.000Z`, expiry: `${request.tradeDate}T00:00:00.000Z`, strike: 100, option_type: "CE", ltp: 10 },
      { minute_bucket: `${request.tradeDate}T03:48:00.000Z`, expiry: `${request.tradeDate}T00:00:00.000Z`, strike: 100, option_type: "CE", ltp: 11 },
      { minute_bucket: `${request.tradeDate}T03:45:00.000Z`, expiry: `${request.tradeDate}T00:00:00.000Z`, strike: 100, option_type: "PE", ltp: 10 },
      { minute_bucket: `${request.tradeDate}T03:48:00.000Z`, expiry: `${request.tradeDate}T00:00:00.000Z`, strike: 100, option_type: "PE", ltp: 9 },
    ],
  };
}

test("runs existing replay sequentially and returns threshold-free research summary", async () => {
  const seen: string[] = [];
  const out = await runH1DirectionResponseResearchHttp({
    symbol: "NIFTY",
    dates: "2026-09-08,2026-09-15",
    fromTime: "09:15",
    toTime: "15:30",
    scope: "FULL",
  }, async (request) => {
    seen.push(request.tradeDate);
    return replay(request);
  });

  assert.equal(out.ok, true);
  assert.deepEqual(seen, ["2026-09-08", "2026-09-15"]);
  assert.equal(out.replaySummaries.length, 2);
  assert.equal(out.research?.combinedComparableCount, 4);
  assert.equal(out.research?.safety.thresholdSelected, false);
  assert.equal(out.research?.safety.thresholdPromoted, false);
  assert.equal(out.safety.affectsSelector, false);
  assert.equal(out.safety.affectsTelegram, false);
  assert.equal(out.safety.affectsExecution, false);
  assert.equal(out.safety.grantsPromotionAuthority, false);
});

test("fails closed on invalid or duplicate date sets", async () => {
  const duplicate = await runH1DirectionResponseResearchHttp({ dates: "2026-09-15,2026-09-15" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, "DUPLICATE_DATES_NOT_ALLOWED");
  assert.equal(duplicate.research, null);

  const invalid = await runH1DirectionResponseResearchHttp({ dates: "not-a-date" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.failedTradeDate, "not-a-date");
  assert.equal(invalid.research, null);
});

test("stops on replay failure and never returns partial research", async () => {
  const out = await runH1DirectionResponseResearchHttp({
    symbol: "NIFTY",
    dates: "2026-09-08,2026-09-15",
    scope: "FULL",
  }, async (request) => request.tradeDate === "2026-09-08"
    ? replay(request)
    : {
      ok: false,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request,
      reason: "NO_DATA",
    });

  assert.equal(out.ok, false);
  assert.equal(out.failedTradeDate, "2026-09-15");
  assert.equal(out.research, null);
  assert.equal(out.replaySummaries.length, 2);
  assert.equal(out.safety.failClosed, true);
});
