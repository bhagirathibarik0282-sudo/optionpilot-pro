import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeWindowOpen, maintenanceExpiry, operatingStatus } from '../runtime-operating-window.js';

test('runtime starts before market, closes after recording and rejects holidays/weekends', () => {
  for (const iso of ['2026-10-28T03:15:00Z', '2026-10-28T10:44:59Z']) assert.equal(runtimeWindowOpen(new Date(iso)), true);
  for (const iso of ['2026-10-28T03:14:59Z', '2026-10-28T10:45:00Z', '2026-10-25T04:00:00Z', '2026-10-20T04:00:00Z']) assert.equal(runtimeWindowOpen(new Date(iso)), false);
  assert.equal(runtimeWindowOpen(new Date(NaN)), false);
});
test('maintenance is bounded to one hour and expires across restarts', () => {
  const now = new Date('2026-10-28T15:00:00Z');
  assert.equal(maintenanceExpiry('2026-10-28T15:30:00Z', now), Date.parse('2026-10-28T15:30:00Z'));
  for (const value of ['bad', '2026-10-28T14:59:00Z', '2026-10-28T16:01:00Z']) assert.equal(maintenanceExpiry(value, now), 0);
  assert.equal(operatingStatus(now, now.getTime() + 1).shouldRun, true);
  assert.equal(operatingStatus(now, now.getTime()).shouldRun, false);
});
