import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ReplayContinuity, parseH1ReplayRequest } from "../h1-replay-http.js";

test("accepts bounded NIFTY full-session replay request", () => {
  const parsed = parseH1ReplayRequest({
    symbol: "nifty",
    tradeDate: "2026-08-31",
    fromTime: "09:15",
    toTime: "15:30",
    scope: "core",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      symbol: "NIFTY",
      tradeDate: "2026-08-31",
      fromTime: "09:15",
      toTime: "15:30",
      scope: "CORE",
    });
  }
});

test("rejects symbols outside the fixed index whitelist", () => {
  const parsed = parseH1ReplayRequest({ symbol: "MIDCPNIFTY", tradeDate: "2026-08-31" });
  assert.deepEqual(parsed, { ok: false, reason: "INVALID_SYMBOL" });
});

test("rejects invalid calendar dates", () => {
  const parsed = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-02-31" });
  assert.deepEqual(parsed, { ok: false, reason: "INVALID_TRADE_DATE" });
});

test("rejects ranges outside the regular market session", () => {
  const beforeOpen = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "09:14", toTime: "15:30" });
  assert.deepEqual(beforeOpen, { ok: false, reason: "OUTSIDE_MARKET_SESSION" });

  const afterClose = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "09:15", toTime: "15:31" });
  assert.deepEqual(afterClose, { ok: false, reason: "OUTSIDE_MARKET_SESSION" });
});

test("rejects reverse time ranges and unknown scopes", () => {
  const reversed = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "12:00", toTime: "11:59" });
  assert.deepEqual(reversed, { ok: false, reason: "INVALID_TIME_RANGE" });

  const badScope = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", scope: "raw" });
  assert.deepEqual(badScope, { ok: false, reason: "INVALID_SCOPE" });
});


test("continuity audit exposes missing 3-minute recorder buckets instead of calling a partial day complete", () => {
  const request = {
    symbol: "SENSEX",
    tradeDate: "2026-09-03",
    fromTime: "09:15",
    toTime: "09:24",
    scope: "CORE",
  } as const;
  const rows = [
    { minute_bucket: "2026-09-03T03:45:00.000Z", truth_verdict: "TRUE" },
    { minute_bucket: "2026-09-03T03:51:00.000Z", truth_verdict: "STALE" },
  ];
  const canonical = [{ minute_bucket: "2026-09-03T03:45:00.000Z" }];
  const c = buildH1ReplayContinuity(request, rows, canonical);
  assert.equal(c.expectedBuckets, 4);
  assert.equal(c.observedMarkerBuckets, 2);
  assert.equal(c.complete, false);
  assert.deepEqual(c.missingBuckets, [
    "2026-09-03T03:48:00.000Z",
    "2026-09-03T03:54:00.000Z",
  ]);
  assert.equal(c.truthCounts.TRUE, 1);
  assert.equal(c.truthCounts.STALE, 1);
  assert.equal(c.canonicalArchiveBuckets, 1);
  assert.equal(c.allParameterArchiveSemantics, "FULL_RUNTIME_INDEX_METRICS_JSONB");
});
