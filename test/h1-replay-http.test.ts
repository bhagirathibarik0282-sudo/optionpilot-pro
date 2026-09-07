import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("option OI truth persistence keeps native and derived change separate with auditable provenance", () => {
  const dbSource = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const replaySource = readFileSync(new URL("../h1-replay-http.ts", import.meta.url), "utf8");

  assert.match(dbSource, /oi_change BIGINT,/);
  assert.match(dbSource, /derived_oi_change BIGINT,/);
  assert.match(dbSource, /derived_oi_change_source TEXT,/);
  assert.match(dbSource, /derived_oi_change_gap_seconds INTEGER,/);
  assert.match(dbSource, /DERIVED_PREVIOUS_PERSISTED_SNAPSHOT/);
  assert.match(dbSource, /AT TIME ZONE 'Asia\/Kolkata'/);
  assert.match(dbSource, /EXTRACT\(EPOCH FROM \(\$2::timestamptz - p\.minute_bucket\)\)::integer/);
  assert.match(dbSource, /oi=EXCLUDED\.oi, oi_change=EXCLUDED\.oi_change,/);
  assert.doesNotMatch(dbSource, /oi_change=EXCLUDED\.derived_oi_change/);
  assert.match(replaySource, /o\.derived_oi_change, o\.derived_oi_change_source, o\.derived_oi_change_gap_seconds/);
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
