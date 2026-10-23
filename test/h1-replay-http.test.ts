import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ReplayContinuity, buildH1ReplayMarkerGapEvidence, parseH1ReplayRequest, runH1ReplayRead } from "../h1-replay-http.js";

test('replay freezes one latest-marker lookup for all normalized tables and exposes read timings',async()=>{
 const request={symbol:'NIFTY',tradeDate:'2026-10-23',fromTime:'09:15',toTime:'09:15',scope:'CORE'} as const;
 const calls:{sql:string;params:unknown[]}[]=[],markers=[{minute_bucket:new Date('2026-10-23T03:45:00Z'),truth_verdict:'STALE'}];
 const read=async(sql:string,params:unknown[])=>{calls.push({sql,params});return (sql.includes("kind = 'H1_TRUTH_MARKER'")?markers:sql.includes('jsonb_to_recordset')?[{symbol:'NIFTY',minute_bucket:markers[0].minute_bucket,truth_verdict:'STALE'}]:[]) as any;};
 const r=await runH1ReplayRead(request,read);assert.equal(r.ok,true);assert.equal(calls.filter(c=>c.sql.includes("kind = 'H1_TRUTH_MARKER'")).length,1);
 const tableCalls=calls.filter(c=>c.sql.includes('jsonb_to_recordset'));assert.equal(tableCalls.length,3);
 for(const c of tableCalls){assert.equal(c.params[0],'NIFTY');assert.equal(c.params[1],JSON.stringify(markers));assert.equal(c.params[2],'2026-10-23T09:15:00+05:30');assert.equal(c.params[3],'2026-10-23T09:15:00+05:30');assert(c.sql.includes('JOIN markers'));assert(c.sql.includes('minute_bucket <= $4::timestamptz'));}
 assert(tableCalls.find(c=>c.sql.includes('option_snapshot_1m'))!.sql.includes('atm_offset BETWEEN -7 AND 7'));assert.equal(r.market?.[0].truth_verdict,'STALE');assert.equal(r.continuity?.truthCounts.STALE,1);assert.equal(r.counts?.markers,1);assert('markers' in r.queryTimingsMs!);
});

test('no markers never exposes unmarked normalized prices; failed reads remain failed with timings',async()=>{
 const request={symbol:'SENSEX',tradeDate:'2026-10-23',fromTime:'09:15',toTime:'09:15',scope:'FULL'} as const;const calls:string[]=[];
 const r=await runH1ReplayRead(request,async(sql:string)=>{calls.push(sql);return [] as any;});assert.equal(r.ok,true);assert.deepEqual(r.market,[]);assert(!calls.some(s=>s.includes('jsonb_to_recordset')));assert.equal(r.continuity?.complete,false);assert.equal(r.queryTimingsMs?.market,0);
 const bad=await runH1ReplayRead(request,async()=>{throw Error('read failed');});assert.equal(bad.ok,false);assert.equal(bad.reason,'read failed');assert(!bad.market);assert('markers' in bad.queryTimingsMs!);
});

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

test('only the explicit dashboard projection changes the canonical SQL; default research remains raw',async()=>{
 const request={symbol:'NIFTY',tradeDate:'2026-10-23',fromTime:'09:15',toTime:'09:15',scope:'CORE'} as const;
 for(const projected of [false,true]){const sqls:string[]=[];const r=await runH1ReplayRead(request,async(sql:string)=>{sqls.push(sql);return [] as any;},projected);assert.equal(r.ok,true);const canonical=sqls.find(s=>s.includes("kind = 'H1_CANONICAL_MARKET_ARCHIVE'"))!;assert.equal(canonical.includes('jsonb_array_elements'),projected);if(!projected)assert(canonical.includes("payload->'market' AS market"));}
});
