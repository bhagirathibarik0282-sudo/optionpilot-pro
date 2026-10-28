// Credential-free smoke test. Run in an isolated git worktree: prepare wiring
// intentionally modifies generated runtime files just as production startup does.
import { createSupervisor } from './optionpilot-service-supervisor.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
const probe = net.createServer().listen(0); await once(probe, 'listening');
const childPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
const data = await mkdtemp(join(tmpdir(), 'op-smoke-'));
const supervisor = createSupervisor({ port: 0, childPort, stateDir: data,
  now: () => new Date('2026-10-28T04:00:00Z'), cadenceMs: 100, probeMs: 100,
  env: { PATH: process.env.PATH, NODE_ENV: 'production', RAILWAY_VOLUME_MOUNT_PATH: data } });
try {
  if (!supervisor.server.listening) await once(supervisor.server, 'listening');
  const deadline = Date.now() + 60_000;
  while (!supervisor.status().ready) {
    if (Date.now() > deadline) throw new Error('REAL_RUNTIME_STARTUP_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const response = await fetch(`http://127.0.0.1:${supervisor.server.address().port}/health`);
  if (response.status !== 200 || !(await response.json()).ok) throw new Error('REAL_RUNTIME_HEALTH_FAILED');
  console.log('REAL_RUNTIME_HEALTH_PASS');
} finally {
  await supervisor.close();
  await rm(data, { recursive: true, force: true });
}
console.log('REAL_RUNTIME_GRACEFUL_DRAIN_PASS');
