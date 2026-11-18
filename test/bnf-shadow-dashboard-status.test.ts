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

test('stale worker counts never appear as current paper proof', async () => {
  const app = new Hono();
  const stale = {
    enabled:true,phase:'WAIT_FEED',reason:'FEED_NOT_OPEN',childRunning:false,feedConnected:false,
    lots:2,sourceCounts:{observations:5231,signals:2,rejected:0,warmup:0},
    paper:{reportedAt:new Date().toISOString(),active:{state:'OPEN',requestedQty:60,filledQty:60,exitedQty:0},lastResult:null},
  };
  mountDashboardLiveRoutes(app,undefined,undefined,undefined,()=>stale);
  const response=await app.request('/dashboard-live/bnf-shadow');
  const data=await response.json();
  assert.equal(data.phase,'WAIT_FEED');
  assert.equal(data.sourceCounts.signals,null);
  assert.equal(data.sourceCounts.observations,null);
  assert.equal(data.paper,null);
  assert.equal(data.brokerOrders,0);
});

test('READY worker exposes only explicitly allowlisted paper quantities', async () => {
  const app=new Hono();
  const source={
    enabled:true,phase:'READY',reason:'WAIT_EXACT_180S_WARMUP',childRunning:true,feedConnected:true,
    lots:2,sourceCounts:{observations:5231,signals:1,rejected:13,warmup:20},
    paper:{reportedAt:new Date().toISOString(),active:{state:'OPEN',requestedQty:60,filledQty:30,exitedQty:0,
      account:'DO_NOT_LEAK',token:'DO_NOT_LEAK'},lastResult:null},
  };
  mountDashboardLiveRoutes(app,undefined,undefined,undefined,()=>source);
  const data=await (await app.request('/dashboard-live/bnf-shadow')).json();
  assert.equal(data.sourceCounts.observations,5231);
  assert.equal(data.sourceCounts.signals,1);
  assert.deepEqual(data.paper.active,{state:'OPEN',requestedQty:60,filledQty:30,exitedQty:0});
  assert.ok(!JSON.stringify(data).includes('DO_NOT_LEAK'));
  assert.equal(data.brokerOrders,0);
});
