import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createSupervisor } from '../scripts/optionpilot-service-supervisor.mjs';

async function waitFor(check: () => boolean, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw new Error('WAIT_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 25)); }
}
async function harness(t: any, iso: string) {
  const stateDir = await mkdtemp(join(tmpdir(), 'op-runtime-'));
  const probe = net.createServer().listen(0); await once(probe, 'listening');
  const childPort = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  let clock = new Date(iso);
  const instance = createSupervisor({ port: 0, childPort, stateDir,
    runtimeEntry: 'test/fixtures/runtime-child.mjs', now: () => clock,
    cadenceMs: 25, probeMs: 25, env: { ...process.env, RESEARCH_ADMIN_TOKEN: 'test-admin' } });
  if (!instance.server.listening) await once(instance.server, 'listening');
  const url = `http://127.0.0.1:${(instance.server.address() as net.AddressInfo).port}`;
  t.after(async () => { await instance.close(); await rm(stateDir, { recursive: true, force: true }); });
  return { instance, url, at: (iso: string) => { clock = new Date(iso); } };
}
test('off-hours deploy has explicit maintenance health; app stays stopped', async t => {
  const { instance, url } = await harness(t, '2026-10-28T15:00:00Z');
  assert.equal(instance.status().running, false);
  const health = await fetch(`${url}/health`); assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, 'SUPERVISOR');
  assert.equal((await fetch(url)).status, 503);
  assert.equal((await fetch(`${url}/ops/runtime-window`, { method: 'POST', body: '{"minutes":30}' })).status, 401);
});
test('scheduled start proxies POST and cookies; closing waits for in-flight request and restarts next morning', async t => {
  const { instance, url, at } = await harness(t, '2026-10-28T04:00:00Z');
  await waitFor(() => instance.status().ready);
  const response = await fetch(url, { method: 'POST', body: 'payload' });
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal((await response.json()).body, 'payload');
  const slow = fetch(`${url}/slow`);
  await new Promise(resolve => setTimeout(resolve, 50));
  at('2026-10-28T10:45:00Z'); await instance.reconcile();
  assert.equal(instance.status().running, true);
  assert.equal((await slow).status, 200);
  await waitFor(() => !instance.status().running);
  at('2026-10-29T03:15:00Z'); await instance.reconcile();
  await waitFor(() => instance.status().ready);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
test('authenticated temporary maintenance starts app, rejects invalid duration, and expires', async t => {
  const { instance, url, at } = await harness(t, '2026-10-28T15:00:00Z');
  const options = (minutes: number) => ({ method: 'POST', headers: { Authorization: 'Bearer test-admin' }, body: JSON.stringify({ minutes }) });
  assert.equal((await fetch(`${url}/ops/runtime-window`, options(61))).status, 400);
  assert.equal((await fetch(`${url}/ops/runtime-window`, options(30))).status, 200);
  await waitFor(() => instance.status().ready);
  at('2026-10-28T15:31:00Z'); await instance.reconcile();
  await waitFor(() => !instance.status().running);
});
test('SSE stream cannot keep the app alive after operating hours', async t => {
  const { instance, url, at } = await harness(t, '2026-10-28T04:00:00Z');
  await waitFor(() => instance.status().ready);
  const response = await fetch(`${url}/stream`);
  at('2026-10-28T10:45:00Z'); await instance.reconcile();
  assert.match(await response.text(), /data: ready/);
  await waitFor(() => !instance.status().running);
});
