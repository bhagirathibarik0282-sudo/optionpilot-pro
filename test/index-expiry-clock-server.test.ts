import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { resolveIndexExpiryClock } from '../index-expiry-clock.js';

// Execute the actual server clock/CE/PE calculation blocks without importing
// server.ts, which starts infrastructure. Broker/network functions are absent.
const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = source.indexOf('function daysToDerivativeExpiry(');
const end = source.indexOf('// Fetch and cache Kite instruments list', start);
assert.ok(start >= 0 && end > start);
const helper = transformSync(source.slice(start, end), { loader: 'ts' }).code;
const days = runInNewContext(helper + '\ndaysToDerivativeExpiry;', { resolveIndexExpiryClock });

test('actual server helper uses index policy and retains the commodity convention', () => {
  const now = Date.parse('2026-10-13T10:05:00Z');
  assert.equal(days('2026-10-13', now, 'NIFTY'), 5 / 1440);
  assert.equal(days('2026-10-13', now), 0);
  assert.ok(Number.isNaN(days('2026-02-31', now, 'NIFTY')));
});

for (const side of ['CE', 'PE'] as const) {
  test(`actual ${side} block withholds unresolved Greeks and accepts October 15:35 time`, () => {
    const lower = side.toLowerCase();
    const first = source.indexOf(`const daysToExpiry = daysToDerivativeExpiry(${lower}Inst.expiry || expiryDate, Date.now(), symbol);`);
    const last = source.indexOf(`expiry.${lower}Strikes.push({`, first);
    assert.ok(first >= 0 && last > first);
    const code = source.slice(first, last) + `\n({computedIv, greeks, gamma: gamma${side === 'CE' ? 'Ce' : 'Pe'}});`;
    for (const symbol of ['NIFTY', 'SENSEX', 'BANKNIFTY']) {
      for (const unknown of [false, true]) {
        let calls = 0;
        const now = Date.parse(unknown ? '2026-10-15T04:00:00Z' : '2026-10-13T10:05:00Z');
        const expiry = unknown ? '2026-12-08' : '2026-10-13';
        const result = runInNewContext(code, {
          symbol, daysToDerivativeExpiry: days, Date: { now: () => now },
          ceInst: { expiry }, peInst: { expiry }, expiryDate: expiry,
          q: { last_price: 10 }, baseMetrics: { current: 100 }, strike: 100,
          calcImpliedVolatility: (...args: unknown[]) => { calls++; assert.equal(args[3], 5 / 1440); return 20; },
          calcGreeks: () => { calls++; return { delta: .5, vega: 1, theta: -1 }; },
          calcAdvancedGreeks: () => { calls++; return { gamma: .01 }; },
        });
        if (unknown) {
          assert.equal(calls, 0);
          assert.ok(Number.isNaN(result.computedIv));
          for (const field of ['delta', 'vega', 'theta']) assert.ok(Number.isNaN(result.greeks[field]));
          assert.ok(Number.isNaN(result.gamma));
        } else {
          assert.equal(calls, 3);
          assert.equal(result.computedIv, 20);
          assert.equal(result.gamma, .01);
        }
      }
    }
  });
}
