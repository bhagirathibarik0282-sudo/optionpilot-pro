import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { createScheduledMarketRefresh, scheduledMarketRefreshAllowed } from '../scheduled-market-refresh.js';

const live = new Date('2026-10-28T04:00:00Z');
test('automatic polling keeps open and closing observations, skips idle periods', () => {
  for (const time of ['2026-10-28T03:45:00Z', '2026-10-28T10:00:00Z', '2026-10-28T10:10:00Z', '2026-12-08T10:15:00Z']) {
    assert.equal(scheduledMarketRefreshAllowed(new Date(time)), true, time);
  }
  for (const time of ['2026-10-28T02:30:00Z', '2026-10-28T10:11:00Z', '2026-10-28T18:00:00Z', '2026-10-25T04:00:00Z', '2026-10-20T04:00:00Z']) {
    assert.equal(scheduledMarketRefreshAllowed(new Date(time)), false, time);
  }
  assert.equal(scheduledMarketRefreshAllowed(new Date(NaN)), false);
});

test('slow jobs never overlap, independent jobs run, and failed jobs can retry', async () => {
  const run = createScheduledMarketRefresh();
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = run('m1', async () => { calls++; await pending; }, live);
  await run('m1', async () => { calls++; }, live);
  await run('multi', async () => { calls++; }, live);
  assert.equal(calls, 2);
  release(); await first;
  await assert.rejects(run('m1', async () => { throw new Error('upstream'); }, live));
  await run('m1', async () => { calls++; }, live);
  assert.equal(calls, 3);
});

// Execute the real server cycle bodies with broker fetches replaced by counters.
// This proves the production wiring skips work before any network call.
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
for (const name of ['dhanM1ProductionRefreshCycle', 'tradeLabDhanMultiExpiryRefreshCycle']) {
  test(`${name} makes zero automatic broker calls when closed and resumes at open`, async () => {
    const start = server.indexOf(`async function ${name}() {`);
    const end = server.indexOf('\n}\n', start) + 2;
    assert.ok(start > 0 && end > start);
    const source = transformSync(server.slice(start, end), { loader: 'ts' }).code;
    let now = new Date('2026-10-28T18:00:00Z');
    let calls = 0;
    const run = createScheduledMarketRefresh();
    const cycle = runInNewContext(`${source}; ${name}`, {
      runScheduledMarketRefresh: (key: string, task: () => Promise<void>) => run(key, task, now),
      dhanM1BuildProductionSnapshot: async () => { calls++; return null; },
      buildTradeLabDhanMultiExpirySnapshot: async () => { calls++; return { status: 'UNAVAILABLE' }; },
      process: { env: {} }, PORT: 8080,
    });
    await cycle(); assert.equal(calls, 0);
    now = live;
    await cycle(); assert.equal(calls, name === 'dhanM1ProductionRefreshCycle' ? 2 : 3);
  });
}

test('session scheduler expires sessions while skipping closed-market refreshes', async () => {
  const start = server.indexOf('  setInterval(() => {\n    const effectiveTtl = getAdaptiveSnapshotTtlMs();');
  const end = server.indexOf('  }, 30 * 1000);', start) + '  }, 30 * 1000);'.length;
  let tick!: () => void;
  let open = false, calls = 0;
  const sessions = new Map([
    ['expired', { expiresAt: 0 }],
    ['valid', { expiresAt: Date.now() + 60_000, snapshotTime: 0 }],
  ]);
  runInNewContext(server.slice(start, end), {
    setInterval: (fn: () => void) => { tick = fn; },
    getAdaptiveSnapshotTtlMs: () => 60_000,
    sessions, scheduledMarketRefreshAllowed: () => open,
    refreshMarketSnapshot: async () => { calls++; }, Date, console,
  });
  tick(); assert.equal(sessions.has('expired'), false); assert.equal(calls, 0);
  open = true; tick(); assert.equal(calls, 1);
});
