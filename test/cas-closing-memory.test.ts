import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { buildCasClosingMemory, summarizeCasMemory, dteBucket, returnPct, CAS_MEMORY_KIND } from '../cas-closing-memory.js';
import { nextCasRunAt, startCasClosingMemoryRuntime, casClosingMemoryRuntimeStatus } from '../cas-closing-memory-runtime.js';
import { researchRouter } from '../research-router.js';
import { renderCasClosingMemoryHtml } from '../cas-closing-memory-view.js';
import type { H1ReplayHttpResult } from '../h1-replay-http.js';

function replay(): H1ReplayHttpResult {
  const market = [], options = [];
  for (let i = 0; i <= 10; i++) {
    const at = new Date(Date.parse('2026-10-08T09:30:00Z') + i * 180000).toISOString(), id = 'snapshot-' + i;
    market.push({ symbol: 'NIFTY', minute_bucket: at, truth_verdict: 'TRUE', snapshot_id: id, spot_ltp: 22000 + i * 10, future_ltp: 22050 + i * 10, india_vix: 15 });
    for (const side of ['CE', 'PE']) options.push({ symbol: 'NIFTY', minute_bucket: at, expiry: '2026-10-13', dte: 5, strike: 22050,
      option_type: side, atm_offset: i <= 5 ? 0 : -1, truth_verdict: 'TRUE', snapshot_id: id, quote_age_seconds: 10, quote_timestamp: at,
      ltp: side === 'CE' ? 100 + i * 10 : 150 - i * 5, oi: '1000', iv: 14, extrinsic: 90 });
  }
  return { ok: true, mode: 'READ_ONLY_H1_3M_REPLAY', productionImpact: 'NONE', request: { symbol: 'NIFTY', tradeDate: '2026-10-08', fromTime: '15:00', toTime: '15:30', scope: 'CORE' }, market, options };
}
const build = (r = replay()) => buildCasClosingMemory('2026-10-08', 'NIFTY', r, new Date('2026-10-08T10:05:00Z'));
test('freezes start ATM strike even after ATM moves; CE/PE returns are same-contract endpoints', () => {
  const m = build(); assert.equal(m.qualifiedWindow, true); assert.equal(m.contracts[0].qualified, true);
  assert.equal(m.contracts[0].strike, 22050); assert.ok(Math.abs(m.contracts[0].ceReturnPct! - 100 / 3) < 1e-9);
  assert.equal(m.contracts[0].peReturnPct, -19.999999999999996); assert.equal(m.version, CAS_MEMORY_KIND);
  assert.equal(m.affectsVerdict, false); assert.equal(m.affectsTelegram, false); assert.equal(m.affectsExecution, false);
  assert.equal(m.actualAuctionDataAvailable, false);
});
test('missing exact frozen contract cannot borrow a new ATM premium', () => {
  const r = replay(); const ce = r.options!.find(o => o.minute_bucket === '2026-10-08T10:00:00.000Z' && o.option_type === 'CE')!;
  ce.strike = 22100; ce.atm_offset = 0; const m = build(r);
  assert.equal(m.contracts[0].qualified, false); assert.equal(m.contracts[0].ceReturnPct, null);
});
for (const [field, value] of [['quote_age_seconds', 61], ['quote_age_seconds', null], ['quote_age_seconds', -1], ['snapshot_id', 'other'], ['truth_verdict', 'PARTIAL'], ['ltp', 0], ['quote_timestamp', null]] as const) {
  test('fails closed on option ' + field + '=' + value, () => {
    const r = replay(); const ce = r.options!.find(o => o.minute_bucket === '2026-10-08T10:00:00.000Z' && o.option_type === 'CE')!;
    ce[field] = value; const m = build(r); assert.equal(m.contracts[0].qualified, false); assert.equal(m.contracts[0].ceReturnPct, null);
  });
}
test('missing baseline preserves qualified endpoint response as partial and excludes it from every mean', () => {
  const r = replay(); r.market = r.market!.filter(m => String(m.minute_bucket) >= '2026-10-08T09:45:00.000Z');
  const m = build(r); assert.equal(m.status, 'PARTIAL'); assert.notEqual(m.contracts[0].ceReturnPct, null);
  assert.equal(m.contracts[0].qualified, false); assert.deepEqual(summarizeCasMemory([m]).averages, []);
});
test('absent closing endpoint stays unavailable without forward fill', () => {
  const r = replay(); r.market = r.market!.filter(m => m.minute_bucket !== '2026-10-08T10:00:00.000Z');
  const m = build(r); assert.equal(m.status, 'UNAVAILABLE'); assert.equal(m.spotReturnPct, null);
});
test('calendar and replay identity are verified', () => {
  assert.throws(() => buildCasClosingMemory('2026-10-02', 'NIFTY', { ...replay(), request: { ...replay().request!, tradeDate: '2026-10-02' } }), /DATE_OR_SYMBOL/);
  assert.throws(() => buildCasClosingMemory('2026-10-10', 'NIFTY', replay()), /IDENTITY/);
  assert.throws(() => build({ ...replay(), ok: false }), /UNAVAILABLE/);
  const r = replay(); r.request!.symbol = 'SENSEX'; assert.throws(() => build(r), /IDENTITY/);
});
test('DTE must agree with fixed expiry calendar date', () => {
  const r = replay(); r.options!.forEach(o => o.dte = 0); const m = build(r);
  assert.equal(m.contracts[0].qualified, false); assert.equal(m.contracts[0].reason, 'INVALID_DTE');
  assert.equal(dteBucket(null), null); assert.equal(dteBucket(-1), null); assert.equal(returnPct(0, 10), null);
});
test('next capture skips weekends and holidays; no unreviewed next-year schedule', () => {
  assert.equal(nextCasRunAt(new Date('2026-10-09T10:06:00Z'))?.toISOString(), '2026-10-12T10:05:00.000Z');
  assert.equal(nextCasRunAt(new Date('2026-10-19T10:06:00Z'))?.toISOString(), '2026-10-21T10:05:00.000Z');
  assert.equal(nextCasRunAt(new Date('2026-12-31T10:06:00Z')), null);
  startCasClosingMemoryRuntime(); assert.equal(casClosingMemoryRuntimeStatus().started, false);
});
test('read-only routes expose no unauthenticated capture mutation; DB outage returns 503', async () => {
  const app = new Hono(); app.route('/api/research', researchRouter);
  const previous = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try {
    const res = await app.request('/api/research/cas-closing-memory'); assert.equal(res.status, 503);
    assert.equal((await res.json() as any).affectsExecution, false);
    const html = await app.request('/api/research/cas-closing-memory/view'); assert.equal(html.status, 200);
    assert.equal((await app.request('/api/research/cas-closing-memory', { method: 'POST' })).status, 404);
    assert.ok(renderCasClosingMemoryHtml().includes('business-dashboard/view'));
  } finally { if (previous == null) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
