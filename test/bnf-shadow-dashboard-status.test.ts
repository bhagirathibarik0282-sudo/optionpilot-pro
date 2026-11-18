import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { mountDashboardLiveRoutes } from '../dashboard-live-http.js';

test('BANKNIFTY paper status uses the existing read-only live router', async () => {
  const app = new Hono();
  mountDashboardLiveRoutes(app);
  const response = await app.request('/dashboard-live/bnf-shadow');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.mode, 'SHADOW');
  assert.equal(body.brokerOrders, 0);
  assert.equal(typeof body.enabled, 'boolean');
  assert.ok(typeof body.phase === 'string');
  assert.equal(typeof body.workerRunning, 'boolean');
  assert.equal(typeof body.feedConnected, 'boolean');
  assert.ok(body.sourceCounts);
  assert.deepEqual(Object.keys(body.sourceCounts).sort(), ['observations', 'rejected', 'signals', 'warmup']);
  assert.ok(!('accessToken' in body));
  assert.ok(!('account' in body));
});
