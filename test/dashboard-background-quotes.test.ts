import test from 'node:test';
import assert from 'node:assert/strict';
import { DashboardBackgroundQuoteCollector, QUOTE_SYMBOLS, buildBackgroundQuotes, backgroundQuoteFreshness, type BackgroundQuotes, type BackgroundQuoteDependencies } from '../dashboard-background-quotes.js';

function fixture(overrides: Partial<BackgroundQuoteDependencies> = {}) {
  let now = new Date('2026-10-09T05:50:00Z'), calls = 0;
  const saved: BackgroundQuotes[] = [];
  const deps: BackgroundQuoteDependencies = {
    now: () => now,
    authority: async () => ({ accessToken: 'test-only', expiresAt: now.getTime() + 3600_000 }),
    fetchQuotes: async () => { calls++; return { 'NSE:HDFCBANK': { last_price: 100, ohlc: { close: 100 } } }; },
    persist: async value => { saved.push(value); return true; },
    ...overrides,
  };
  const collector = new DashboardBackgroundQuoteCollector(deps);
  return { collector, saved, calls: () => calls, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, setTime: (value: string) => { now = new Date(value); } };
}

test('records repeatedly with no browser or HTTP request, persists real zero and missing separately', async () => {
  const f = fixture();
  await f.collector.tick();
  assert.equal(f.collector.status, 'RECORDING');
  assert.equal(f.saved[0].stocks.NIFTY[0].change, 0);
  assert.equal(f.saved[0].stocks.NIFTY[1].change, null);
  f.advance(30_000); await f.collector.tick(); assert.equal(f.calls(), 1);
  f.advance(150_000); await f.collector.tick(); assert.equal(f.calls(), 2);
  assert.equal(f.saved.length, 2);
  assert.equal(JSON.stringify(f.saved).includes('test-only'), false);
  assert.equal(QUOTE_SYMBOLS.length, new Set(QUOTE_SYMBOLS).size);
});

test('does not fetch outside equity market hours, weekends or holidays', async () => {
  const f = fixture();
  for (const time of ['2026-10-09T03:40:00Z', '2026-10-09T10:10:00Z', '2026-10-10T05:50:00Z', '2026-10-02T05:50:00Z']) {
    f.setTime(time); await f.collector.tick();
  }
  assert.equal(f.calls(), 0); assert.equal(f.collector.status, 'MARKET_CLOSED');
  f.setTime('2026-10-09T03:45:00Z'); await f.collector.tick(); assert.equal(f.calls(), 1);
});

test('re-resolves persisted authority after expiry and retries without any browser login request', async () => {
  let available = false, resolves = 0;
  const f = fixture({ authority: async () => { resolves++; return available ? { accessToken: 'renewed', expiresAt: Date.parse('2026-10-09T10:00:00Z') } : null; } });
  await f.collector.tick(); assert.equal(f.collector.status, 'KITE_RECONNECT_REQUIRED');
  assert.equal(f.calls(), 0);
  available = true; f.advance(60_000); await f.collector.tick();
  assert.equal(resolves, 2); assert.equal(f.calls(), 1);
});

test('bounds concurrent ticks and recovers after upstream failure without changing last good receipt', async () => {
  let release!: () => void, calls = 0;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ fetchQuotes: async () => { calls++; await wait; if (calls === 2) throw new Error('private'); return { 'NSE:HDFCBANK': { last_price: 101, ohlc: { close: 100 } } }; } });
  const first = f.collector.tick(); await f.collector.tick(); release(); await first;
  assert.equal(calls, 1);
  const timestamp = f.collector.snapshot!.timestamp;
  f.advance(180_000); await f.collector.tick(); assert.equal(f.collector.status, 'COLLECTION_FAILED');
  assert.equal(f.collector.snapshot!.timestamp, timestamp);
  f.advance(60_000); await f.collector.tick(); assert.equal(f.collector.status, 'RECORDING');
});

test('empty or malformed observations do not overwrite a successful snapshot', async () => {
  let empty = false;
  const f = fixture({ fetchQuotes: async () => empty ? {} : { 'NSE:HDFCBANK': { last_price: 100, ohlc: { close: 99 } } } });
  await f.collector.tick(); const previous = f.collector.snapshot;
  empty = true; f.advance(180_000); await f.collector.tick();
  assert.equal(f.collector.status, 'QUOTES_UNAVAILABLE'); assert.equal(f.collector.snapshot, previous);
  const invalid = buildBackgroundQuotes({ 'NSE:HDFCBANK': { last_price: NaN, ohlc: { close: 100 } } }, new Date('2026-10-09T05:50:00Z'));
  assert.equal(invalid.stocks.NIFTY[0].change, null);
});

test('storage failure is explicit and never claimed as durably recording', async () => {
  const f = fixture({ persist: async () => false });
  await f.collector.tick(); assert.equal(f.collector.status, 'STORAGE_UNAVAILABLE');
  assert.ok(f.collector.snapshot);
});

test('restored quotes retain original receipt and never become current by reading them', () => {
  const at = new Date('2026-10-09T05:50:00Z');
  const restored = JSON.parse(JSON.stringify(buildBackgroundQuotes({}, at))) as BackgroundQuotes;
  assert.equal(backgroundQuoteFreshness(restored, new Date('2026-10-09T05:55:00Z')), 'RECENT_RECEIPT');
  assert.equal(backgroundQuoteFreshness(restored, new Date('2026-10-09T05:57:00Z')), 'STALE');
  assert.equal(backgroundQuoteFreshness(restored, new Date('2026-10-12T03:45:00Z')), 'STALE');
  assert.equal(backgroundQuoteFreshness(restored, new Date('2026-10-09T05:49:00Z')), 'STALE');
  assert.equal(backgroundQuoteFreshness(null, at), 'UNAVAILABLE');
  assert.equal(restored.timestamp, at.toISOString());
});

test('public dashboard read needs no browser Kite session and cannot trigger broker fetching', async () => {
  const { researchRouter } = await import('../research-router.js');
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('unexpected broker request'); };
  try {
    const response = await researchRouter.request('/background-quotes?symbol=NIFTY');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).freshness, 'UNAVAILABLE');
    const invalid = await researchRouter.request('/background-quotes?symbol=INVALID');
    assert.equal(invalid.status, 400);
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
