import test from 'node:test';
import assert from 'node:assert/strict';
import { installRuntimeIoTracker } from '../scripts/runtime-io-tracker.mjs';

test('shutdown accounts for fetch, promise SQL, callback SQL and stops future interval work', async () => {
  let release!: (value: string) => void, callback: Function | null = null, tick!: Function, cleared = 0, ticks = 0;
  const wait = new Promise<string>(resolve => { release = resolve; });
  class Client { query(...args: any[]) { if (typeof args.at(-1) === 'function') { callback = args.at(-1); return; } return wait; } }
  const target: any = { fetch: () => wait, setInterval: (fn: Function) => { tick = fn; return 1; }, clearInterval: () => { cleared++; } };
  const tracker = installRuntimeIoTracker(target, Client);
  const fetched = target.fetch('fixture'); const sql = new Client().query('fixture');
  new Client().query('fixture', () => {});
  assert.equal(tracker.pending(), 3);
  target.setInterval(() => { ticks++; }, 1); tick();
  tracker.stopIntervals(); tick(); assert.equal(ticks, 1); assert.equal(cleared, 1);
  release('ok'); assert.equal(await fetched, 'ok'); assert.equal(await sql, 'ok');
  (callback as any)(null, {}); assert.equal(tracker.pending(), 0);
});
test('failed asynchronous I/O releases its drain counter', async () => {
  class Client { query() { return Promise.reject(new Error('sql failed')); } }
  const target: any = { fetch: () => Promise.reject(new Error('fetch failed')), setInterval, clearInterval };
  const tracker = installRuntimeIoTracker(target, Client);
  await assert.rejects(target.fetch('fixture')); await assert.rejects(new Client().query());
  assert.equal(tracker.pending(), 0);
});
