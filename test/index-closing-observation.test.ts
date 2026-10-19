import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';
import { transformSync } from 'esbuild';
import { isClosingObservationAt, standardIndexObservationClose } from '../index-observation-session.js';
import { isIndianEquityMarketOpenAt } from '../market-session-calendar.js';
import { buildH1ReplayContinuity, parseH1ReplayRequest } from '../h1-replay-http.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
test('October closing observations do not extend the candidate market gate', () => {
  for (const time of ['15:33', '15:36', '15:39']) {
    const now = new Date(`2026-10-16T${time}:07+05:30`);
    assert.equal(isClosingObservationAt(now), true);
    assert.equal(isIndianEquityMarketOpenAt(now), false);
  }
  for (const iso of ['2026-10-16T15:41:00+05:30', '2026-10-17T15:36:00+05:30', '2026-10-20T15:36:00+05:30', '2026-07-31T15:36:00+05:30', '2027-01-04T15:36:00+05:30']) {
    assert.equal(isClosingObservationAt(new Date(iso)), false);
  }
});

test('date-aware replay exposes missing closing buckets without manufacturing records', () => {
  const parsed = parseH1ReplayRequest({ tradeDate: '2026-10-16', fromTime: '15:30', symbol: 'NIFTY' });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.toTime, '15:40');
  const c = buildH1ReplayContinuity(parsed.value, [{ minute_bucket: '2026-10-16T10:00:00Z', truth_verdict: 'TRUE' }], []);
  assert.equal(c.complete, false);
  assert.equal(c.expectedBuckets, 4);
  assert.deepEqual(c.missingBuckets, ['2026-10-16T10:03:00.000Z', '2026-10-16T10:06:00.000Z', '2026-10-16T10:09:00.000Z']);
  assert.equal(standardIndexObservationClose('2026-12-07'), '15:45');
  assert.equal(standardIndexObservationClose('2026-07-31'), '15:30');
  assert.equal(parseH1ReplayRequest({ tradeDate: '2026-10-16', toTime: '15:41' }).ok, false);
});

test('actual scheduler records each closing minute without business processing or backfill', async () => {
  const start = server.indexOf('let lastRecorderSlot = -1;');
  const end = server.indexOf('// Telegram Market Snapshot fast cycle', start);
  let at = '2026-10-16T10:00:07Z', tick: () => Promise<void> = async () => {};
  const captures: unknown[][] = [];
  class Clock extends Date { constructor(v?: any) { super(v === undefined ? at : v); } }
  runInNewContext(server.slice(start, end), {
    Date: Clock, isClosingObservationAt,
    isMarketOpenNowServer: () => isIndianEquityMarketOpenAt(new Date(at)),
    setInterval: (fn: () => Promise<void>, ms: number) => { assert.equal(ms, 30000); tick = fn; },
    captureRecorderSnapshot: (...args: unknown[]) => captures.push(args),
  });
  for (const iso of ['10:00:07', '10:01:07', '10:03:07', '10:03:37', '10:06:07', '10:09:07', '10:12:07']) {
    at = '2026-10-16T' + iso + 'Z'; await tick();
  }
  assert.deepEqual(captures, [['SCHEDULED_3MIN', false], ['CLOSING_OBSERVATION_1MIN', true], ['CLOSING_OBSERVATION_1MIN', true], ['CLOSING_OBSERVATION_1MIN', true], ['CLOSING_OBSERVATION_1MIN', true]]);
});

test('actual observation-only capture writes H1 then returns before selector, journal, outcomes and Telegram', async () => {
  const start = server.indexOf('async function captureRecorderSnapshot(');
  const end = server.indexOf('// ============== DAILY JOURNAL', start);
  assert.ok(start >= 0 && end > start);
  const code = transformSync(server.slice(start, end), { loader: 'ts' }).code;
  const at = '2026-10-16T10:03:07Z', calls: unknown[][] = [];
  class Clock extends Date { constructor(v?: any) { super(v === undefined ? at : v); } static now() { return Date.parse(at); } }
  const forbidden = () => { throw Error('authority-side callback reached'); };
  const capture = runInNewContext(code + '\ncaptureRecorderSnapshot;', {
    Date: Clock, indiaTradingDate: () => '2026-10-16', recorderSession: { tradingDate: '2026-10-16' },
    sessions: new Map([['test', { expiresAt: Date.parse(at) + 60000 }]]),
    resolveKiteAuthoritySession: async () => ({ status: { active: true }, session: { accessToken: 'fixture', userId: 'fixture', loginTime: Date.parse(at), expiresAt: Date.parse(at) + 60000 } }),
    refreshMarketSnapshot: async () => ({ NIFTY: {}, SENSEX: {}, BANKNIFTY: {} }),
    computeTruthReport: () => ({ overallVerdict: 'TRUE' }),
    recordH1FromRuntimeSnapshot: async (...args: unknown[]) => { calls.push(args); },
    captureV2RolloverSummary: forbidden, collectH1LiveSelectorDecisions: forbidden,
    toTruthValidatedRecorderIndexSnapshot: forbidden, appendJournalEntry: forbidden,
    captureV2ShadowCycle: forbidden, runTelegramAlertCycle: forbidden, dbInsert: forbidden,
    console: { error: (...args: unknown[]) => { throw Error(JSON.stringify(args)); } },
  });
  await capture('CLOSING_OBSERVATION_1MIN', true);
  await capture('SCHEDULED_1MIN_ARCHIVE', true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].length, 2); // No candidate decisions supplied.
});

test('dashboard full-session selection uses the same clock and emits valid scripts', async () => {
  const html = renderBusinessDashboardV1Html({} as any);
  const match = html.match(/setDate:(async\(date,options=\{\}\)=>\{.*?\}),refresh:/);
  assert.ok(match);
  const fields = new Map(['date', 'baseline', 'from', 'to'].map(id => [id, { value: '' }]));
  let loads = 0;
  const select = runInNewContext('(' + match[1] + ')', {
    busy: false, $: (id: string) => fields.get(id), recordedDates: [],
    observationSessionClose: standardIndexObservationClose, load: async () => { loads++; },
  });
  for (const [date, end] of [['2026-07-31', '15:30'], ['2026-10-16', '15:40'], ['2026-12-07', '15:45']]) {
    await select(date, { fullSession: true });
    assert.equal(fields.get('to')!.value, end);
  }
  assert.equal(loads, 3);
  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Script(script[1]);
});

test('one-minute replay continuity starts on cutover date and retains historical three-minute grids',()=>{
 for(const [date,cadence,count] of [['2026-10-16',3,3],['2026-10-19',1,7]] as const){
  const parsed=parseH1ReplayRequest({tradeDate:date,fromTime:'09:15',toTime:'09:21',symbol:'NIFTY'});assert.ok(parsed.ok);
  const markers=[0,3,6].map(n=>({minute_bucket:new Date(Date.parse(date+'T03:45:00Z')+n*60000).toISOString(),truth_verdict:'TRUE'}));
  const c=buildH1ReplayContinuity(parsed.value,markers,markers);assert.equal(c.cadenceMinutes,cadence);assert.equal(c.expectedBuckets,count);assert.equal(c.missingBuckets.length,count-3);
 }
});
