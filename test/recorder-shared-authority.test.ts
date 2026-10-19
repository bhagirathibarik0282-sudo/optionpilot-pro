import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf('async function captureRecorderSnapshot(');
const end = server.indexOf('// ============== DAILY JOURNAL', start);
const code = transformSync(server.slice(start, end), { loader: 'ts' }).code;
const now = Date.parse('2026-10-19T04:00:00Z');
const session = (token: string, expiresAt = now + 60000) => ({ accessToken: token, userId: 'fixture', email: null, loginTime: now - 60000, expiresAt });
function harness(resolve: () => Promise<any>) {
  const used: any[] = [], saved: any[] = [], blocked: any[] = [];
  const recorder = { tradingDate: '2026-10-19', status: 'RECORDING', lastErrorRedacted: null };
  const forbidden = () => { throw Error('unexpected authority side effect'); };
  class Clock extends Date { static now() { return now; } }
  const capture = runInNewContext(code + '\ncaptureRecorderSnapshot;', {
    Date: Clock, indiaTradingDate: () => '2026-10-19', recorderSession: recorder,
    // Both legacy paths contain a locally unexpired, superseded token.
    sessions: new Map([['old-browser', session('superseded-browser')]]),
    phase62RestoredKiteAuthority: session('superseded-cache'),
    resolveVerifiedKiteAuthoritySession: resolve,
    refreshMarketSnapshot: async (s: any) => { used.push(s); return { NIFTY: {}, BANKNIFTY: {}, SENSEX: {} }; },
    computeTruthReport: () => ({ overallVerdict: 'TRUE' }),
    recordH1FromRuntimeSnapshot: async (...args: any[]) => { saved.push(args); },
    dbInsert: async (kind: string, payload: any) => { blocked.push({ kind, payload }); },
    captureV2RolloverSummary: forbidden, collectH1LiveSelectorDecisions: forbidden,
    toTruthValidatedRecorderIndexSnapshot: forbidden, appendJournalEntry: forbidden,
    captureV2ShadowCycle: forbidden, runTelegramAlertCycle: forbidden,
    console: { error() {} },
  });
  return { capture, used, saved, blocked, recorder };
}
test('actual capture ignores older browser/cache authority and observes rotation on the next minute', async () => {
  let calls = 0;
  const h = harness(async () => ({ status: { active: true }, session: session('current-' + ++calls) }));
  await h.capture('SCHEDULED_1MIN_ARCHIVE', true);
  await h.capture('SCHEDULED_1MIN_ARCHIVE', true);
  assert.equal(calls, 2);
  assert.deepEqual(h.used.map(s => s.accessToken), ['current-1', 'current-2']);
  assert.equal(h.saved.length, 2);
  assert.equal(h.used[0].marketSnapshot, undefined);
  assert.equal(h.blocked.length, 0);
});
for (const [name, resolved] of [
  ['missing', { status: { active: false }, session: null }],
  ['inactive despite payload', { status: { active: false }, session: session('do-not-use') }],
  ['expired', { status: { active: true }, session: session('do-not-use', now) }],
] as const) test('actual capture fails closed for ' + name + ' authority without legacy fallback', async () => {
  const h = harness(async () => resolved);
  await h.capture('SCHEDULED_1MIN_ARCHIVE', true);
  assert.equal(h.used.length, 0); assert.equal(h.saved.length, 0);
  assert.equal(h.recorder.status, 'DEGRADED');
  assert.equal(h.blocked[0].kind, 'H1_RECORDER_AUTHORITY_BLOCKED');
  assert(!JSON.stringify(h.blocked).includes('do-not-use'));
});
test('resolver storage failure does not fall back to a cached token or make broker calls', async () => {
  const h = harness(async () => { throw Error('fixture storage unavailable'); });
  await h.capture('SCHEDULED_1MIN_ARCHIVE', true);
  assert.equal(h.used.length, 0); assert.equal(h.saved.length, 0);
  assert.equal(h.recorder.status, 'DEGRADED');
});
