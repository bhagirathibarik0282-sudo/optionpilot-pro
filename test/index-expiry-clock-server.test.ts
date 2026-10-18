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

test('actual advanced Gamma respects five remaining minutes rather than a 52.56-minute floor', () => {
  const mathStart = source.indexOf('function normPdf(');
  const mathEnd = source.indexOf('// Implied Volatility solver', mathStart);
  const greekStart = source.indexOf('function calcGreeks(');
  const greekEnd = source.indexOf('function findActiveIndexFuture(', greekStart);
  assert.ok(mathStart >= 0 && mathEnd > mathStart && greekEnd > greekStart);
  const code = transformSync(source.slice(mathStart, mathEnd) + source.slice(greekStart, greekEnd), { loader: 'ts' }).code;
  const advanced = runInNewContext(code + '\ncalcAdvancedGreeks;', { BS_RISK_FREE_RATE: .1 });
  const years = 5 / 525600, sigma = .2, spot = 100, strike = 100;
  // Independent central second difference of the option price; no Greek call.
  const cdf = (x: number) => {
    // Integrated normal-density series, accurate in this near-zero stencil.
    let term = x, integral = x;
    for (let n = 1; n <= 20; n++) {
      term *= -x * x / (2 * n);
      integral += term / (2 * n + 1);
    }
    return .5 + integral / Math.sqrt(2 * Math.PI);
  };
  const price = (s: number) => {
    const d1 = (Math.log(s / strike) + (.1 + sigma * sigma / 2) * years) / (sigma * Math.sqrt(years));
    return s * cdf(d1) - strike * Math.exp(-.1 * years) * cdf(d1 - sigma * Math.sqrt(years));
  };
  const h = .001, numericalGamma = (price(spot + h) - 2 * price(spot) + price(spot - h)) / (h * h);
  assert.ok(Math.abs(advanced(spot, strike, 20, 5 / 1440, true, true).gamma - numericalGamma) < .005);
  assert.equal(advanced(spot, strike, 20, 0, true, true), null);
  assert.equal(advanced(spot, strike, 20, NaN, true, true), null);
  assert.ok(advanced(spot, strike, 20, 5 / 1440, true).gamma < numericalGamma / 2);
});
