import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePreviousSpotSession } from '../dashboard-previous-spot-session.js';
import type { LiveEntry } from '../dashboard-live-feed.js';

const spot: LiveEntry = { token: 256265, label: 'NIFTY 50', role: 'SPOT', symbol: 'NIFTY' };
const older = ['2026-11-06T00:00:00+0530', 100, 105, 95, 101, 0];
const prior = ['2026-11-08T00:00:00+0530', 101, 107, 98, 102, 0];
const read = (candles: unknown[], entry = spot) =>
  parsePreviousSpotSession({ status: 'success', data: { candles } }, entry, '2026-11-09');

test('takes the latest dated broker session even when it falls on a weekend', () => {
  assert.deepEqual(read([prior, older]), {
    source: 'KITE_DAILY_CANDLE', symbol: 'NIFTY', token: 256265,
    sessionDate: '2026-11-08', high: 107, low: 98, close: 102,
  });
});

test('rejects ambiguous or invalid latest data without falling back to an older candle', () => {
  assert.equal(read([older, prior, prior]), null);
  assert.equal(read([older, [...prior.slice(0, 4), 110, 0]]), null);
  assert.equal(read([older, ['2026-11-09T00:00:00+0530', ...prior.slice(1)]]), null);
  assert.equal(read([prior], { ...spot, role: 'OPTION' }), null);
});
