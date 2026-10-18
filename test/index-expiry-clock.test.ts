import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveIndexExpiryClock as clock } from '../index-expiry-clock.js';
import { mapKiteFullPacketToH1ExactPriceGreek } from '../h1-kite-exact-price-greek-adapter.js';
import { crosscheckH1KiteGreeks } from '../h1-kite-greek-math-crosscheck.js';
import { KiteImmediateTokenRegistry } from '../kite-immediate-token-registry.js';

for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
  test(`${symbol}: October expiry uses 15:40 and DTE-0 keeps intraday time`, () => {
    const morning = clock(symbol, '2026-10-13', '2026-10-13T09:33:00+05:30')!;
    assert.equal(morning.expiryAt, '2026-10-13T10:10:00.000Z');
    assert.equal(morning.minutesToExpiry, 367);
    assert.equal(clock(symbol, '2026-10-13', '2026-10-13T15:00:00+05:30')!.minutesToExpiry, 40);
    assert.equal(clock(symbol, '2026-10-13', '2026-10-13T15:39:59.999+05:30')!.expired, false);
    assert.equal(clock(symbol, '2026-10-13', '2026-10-13T15:40:00+05:30')!.expired, true);
  });
  test(`${symbol}: effective dates and knowledge cutoff are distinct`, () => {
    assert.equal(clock(symbol, '2026-07-31', '2026-07-31T04:00:00Z')!.closeIst, '15:30');
    assert.equal(clock(symbol, '2026-08-03', '2026-07-31T04:00:00Z')!.closeIst, '15:40');
    assert.equal(clock(symbol, '2026-12-04', '2026-10-16T04:00:00Z')!.closeIst, '15:40');
    assert.equal(clock(symbol, '2026-12-07', '2026-10-16T04:00:00Z')!.closeIst, '15:30');
    assert.equal(clock(symbol, '2026-12-07', '2026-10-14T04:00:00Z')!.closeIst, '15:40');
    assert.equal(clock(symbol, '2026-08-03', '2026-01-15T04:00:00Z')!.closeIst, '15:30');
    assert.equal(clock(symbol, '2026-12-07', '2026-10-15T04:00:00Z'), null);
    assert.equal(clock(symbol, '2026-08-03', '2026-01-16T04:00:00Z'), null);
  });
}

test('rejects malformed identities, rolled dates and invalid times', () => {
  for (const expiry of ['2026-02-31', '2026-13-01', '2026-1-01', '', 'not-a-date']) {
    assert.equal(clock('NIFTY', expiry, '2026-10-13T04:00:00Z'), null);
  }
  assert.equal(clock('MCX', '2026-10-13', '2026-10-13T04:00:00Z'), null);
  assert.equal(clock('NIFTY', '2026-10-13', NaN), null);
  assert.equal(clock('NIFTY', '2026-10-13', 'bad'), null);
  assert.equal(clock('NIFTY', '2026-10-13', '2026-10-13T09:33:00'), null);
  assert.equal(clock('NIFTY', '2026-10-13', 8_640_000_000_000_000), null);
});

test('IST knowledge date is invariant to the timestamp offset representation', () => {
  assert.deepEqual(clock('NIFTY', '2026-12-07', '2026-10-15T18:30:00Z'),
    clock('NIFTY', '2026-12-07', '2026-10-16T00:00:00+05:30'));
  assert.equal(clock('NIFTY', '2026-12-07', '2026-10-15T18:29:59Z'), null);
});

test('fresh October quotes after 15:30 share the corrected producer/cross-check clock', () => {
  const policy = { annualRiskFreeRate: .05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 };
  for (const symbol of ['NIFTY', 'SENSEX', 'BANKNIFTY'] as const) {
    const registry = new KiteImmediateTokenRegistry([{ instrumentToken: 111, symbol, role: 'OPTION', instrumentLabel: 'clock-boundary', expiry: '2026-10-13', strike: 100, optionSide: 'CE' }]);
    const observedAt = '2026-10-13T10:05:00.000Z', receivedAt = '2026-10-13T10:05:00.500Z';
    const underlying = { source: 'LIVE_RUNTIME_EXACT' as const, symbol, price: 100, observedAt, receivedAt };
    const packet = { mode: 'full' as const, instrumentToken: 111, lastPrice: .1, exchangeTimestamp: observedAt, isIndex: false };
    const out = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, receivedAt, policy);
    assert.ok(out);
    assert.equal(out.dte, 0);
    assert.equal(crosscheckH1KiteGreeks(out, underlying, policy).ready, true);
    const atClose = '2026-10-13T10:10:00.000Z';
    assert.equal(mapKiteFullPacketToH1ExactPriceGreek({ ...packet, exchangeTimestamp: atClose }, registry,
      { ...underlying, observedAt: atClose, receivedAt: atClose }, atClose, policy), null);
  }
});
