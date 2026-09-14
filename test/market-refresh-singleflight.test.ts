import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KeyedSingleFlight, marketAuthorityKey } from "../market-refresh-singleflight.js";
import { shouldRefreshCandidateSnapshot } from "../candidate-snapshot-freshness.js";

test("collapses concurrent refreshes for the same market authority", async () => {
  const gate = new KeyedSingleFlight<number>();
  let upstreamCalls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const task = async () => {
    upstreamCalls += 1;
    await pending;
    return 42;
  };

  const first = gate.run("same-authority", task);
  const second = gate.run("same-authority", task);
  release();

  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
  assert.equal(upstreamCalls, 1);
});

test("briefly reuses a successful refresh but never caches a failure", async () => {
  const gate = new KeyedSingleFlight<number>();
  let calls = 0;

  assert.equal(await gate.run("ok", async () => ++calls, 5_000), 1);
  assert.equal(await gate.run("ok", async () => ++calls, 5_000), 1);
  assert.equal(calls, 1);

  await assert.rejects(gate.run("retry", async () => { throw new Error("temporary"); }, 5_000));
  assert.equal(await gate.run("retry", async () => 7, 5_000), 7);
});

test("authority key is deterministic and does not expose the access token", () => {
  const token = "sensitive-broker-token";
  const key = marketAuthorityKey(token);
  assert.equal(key, marketAuthorityKey(token));
  assert.equal(key.includes(token), false);
  assert.equal(key.length, 64);
});

test("candidate snapshot freshness refreshes missing, invalid, future and expired state", () => {
  const base = { hasSnapshot: true, snapshotTimeMs: 1_000, nowMs: 2_000, ttlMs: 3_000 };
  assert.equal(shouldRefreshCandidateSnapshot(base), false);
  assert.equal(shouldRefreshCandidateSnapshot({ ...base, hasSnapshot: false }), true);
  assert.equal(shouldRefreshCandidateSnapshot({ ...base, snapshotTimeMs: null }), true);
  assert.equal(shouldRefreshCandidateSnapshot({ ...base, snapshotTimeMs: 3_000 }), true);
  assert.equal(shouldRefreshCandidateSnapshot({ ...base, snapshotTimeMs: -1 }), true);
  assert.equal(shouldRefreshCandidateSnapshot({ ...base, snapshotTimeMs: 1_000, nowMs: 4_000 }), true);
});

test("all three candidate-facing routes enforce a fresh snapshot", () => {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(source, /async function ensureFreshCandidateMarketSnapshot[\s\S]*getAdaptiveSnapshotTtlMs\(\)[\s\S]*await refreshMarketSnapshot\(session\)/);
  assert.equal((source.match(/await ensureFreshCandidateMarketSnapshot\(session\);/g) || []).length, 3);
});
