import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ReplayContinuity, buildH1ReplayMarkerGapEvidence, parseH1ReplayRequest } from "../h1-replay-http.js";

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

  const afterClose = parseH1ReplayRequest({ symbol: "NIFTY", tradeDate: "2026-08-31", fromTime: "09:15", toTime: "15:41" });
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


test("continuity coverage counts only expected 3-minute grid buckets", () => {
  const request = {
    symbol: "NIFTY",
    tradeDate: "2026-09-07",
    fromTime: "09:15",
    toTime: "09:24",
    scope: "CORE",
  } as const;
  const rows = [
    { minute_bucket: "2026-09-07T03:45:00.000Z", truth_verdict: "TRUE" },
    { minute_bucket: "2026-09-07T03:46:00.000Z", truth_verdict: "TRUE" },
    { minute_bucket: "2026-09-07T03:48:00.000Z", truth_verdict: "TRUE" },
    { minute_bucket: "2026-09-07T03:51:00.000Z", truth_verdict: "TRUE" },
    { minute_bucket: "2026-09-07T03:52:00.000Z", truth_verdict: "TRUE" },
    { minute_bucket: "2026-09-07T03:54:00.000Z", truth_verdict: "TRUE" },
  ];
  const canonical = rows.map((r) => ({ minute_bucket: r.minute_bucket }));
  const out = buildH1ReplayContinuity(request, rows, canonical);
  assert.equal(out.expectedBuckets, 4);
  assert.equal(out.observedMarkerBuckets, 6);
  assert.equal(out.coveragePct, 100);
  assert.equal(out.canonicalArchiveBuckets, 6);
  assert.equal(out.canonicalCoveragePct, 100);
  assert.equal(out.complete, true);
});


test("marker gap evidence reports raw normalized rows without granting authority", () => {
  const missing = [
    "2026-09-10T04:27:00.000Z",
    "2026-09-10T05:09:00.000Z",
  ];
  const out = buildH1ReplayMarkerGapEvidence(missing, [
    { source: "market", minute_bucket: "2026-09-10T04:27:00.000Z", row_count: 1 },
    { source: "option", minute_bucket: "2026-09-10T04:27:00.000Z", row_count: "12" },
    { source: "chain", minute_bucket: "2026-09-10T04:27:00.000Z", row_count: 2 },
    { source: "market", minute_bucket: "2026-09-10T05:09:00.000Z", row_count: 1 },
  ]);

  assert.equal(out.semantics, "RAW_NORMALIZED_TABLE_PRESENCE_WITHOUT_TRUTH_MARKER_JOIN");
  assert.equal(out.markerJoinBypassedForInspection, true);
  assert.deepEqual(out.buckets, [
    {
      minuteBucket: "2026-09-10T04:27:00.000Z",
      marketRows: 1,
      optionRows: 12,
      chainRows: 2,
    },
    {
      minuteBucket: "2026-09-10T05:09:00.000Z",
      marketRows: 1,
      optionRows: 0,
      chainRows: 0,
    },
  ]);
  assert.equal(out.writePerformed, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

async function replayReadHarness(missing = false, failGapRead = false) {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { transformSync } = await import('esbuild');
  const source = readFileSync(new URL('../h1-replay-http.ts', import.meta.url), 'utf8');
  const module = { exports: {} as any }, calls: string[] = [];
  const bucket = '2026-10-16T03:45:00.000Z';
  const observed = [{ symbol: 'NIFTY', minute_bucket: bucket, truth_verdict: 'TRUE' }];
  runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, performance, Date,
    require: (name: string) => name === './db.js' ? {
      dbIsConfigured: () => true,
      dbQuerySafe: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("SELECT 'market'::text AS source")) return failGapRead ? null : { rows: [{ source: 'option', minute_bucket: '2026-10-16T03:48:00.000Z', row_count: '12' }] };
        if (sql.includes("kind = 'H1_CANONICAL_MARKET_ARCHIVE'")) return { rows: observed };
        if (sql.includes('SELECT minute_bucket, truth_verdict FROM markers')) return { rows: missing ? observed : [...observed, { ...observed[0], minute_bucket: '2026-10-16T03:48:00.000Z' }] };
        return { rows: observed };
      },
    } : { standardIndexObservationClose: () => '15:30' },
  });
  const result = await module.exports.runH1ReplayHttp({ symbol: 'NIFTY', tradeDate: '2026-10-16', fromTime: '09:15', toTime: '09:18', scope: 'CORE' });
  return { result: JSON.parse(JSON.stringify(result)), calls };
}

test('complete marker grid skips raw presence reads without changing observations', async () => {
  const { result, calls } = await replayReadHarness();
  assert.equal(result.ok, true);
  assert.equal(calls.length, 5);
  assert.deepEqual(result.markerGapEvidence.buckets, []);
  assert.equal(result.market.length, 1);
  assert.equal(result.counts.options, 1);
  assert.equal(result.queryTimingsMs.raw_gaps, 0);
  assert.equal(result.continuity.complete, true);
});

test('missing marker retains raw normalized evidence and read timing', async () => {
  const { result, calls } = await replayReadHarness(true);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 6);
  assert.deepEqual(result.markerGapEvidence.buckets, [{ minuteBucket: '2026-10-16T03:48:00.000Z', marketRows: 0, optionRows: 12, chainRows: 0 }]);
  assert.equal(result.continuity.complete, false);
  assert.equal(typeof result.queryTimingsMs.raw_gaps, 'number');
});

test('required raw gap read failure remains fail closed', async () => {
  const { result } = await replayReadHarness(true, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'H1_REPLAY_DB_QUERY_FAILED');
  assert.equal(result.market, undefined);
});
