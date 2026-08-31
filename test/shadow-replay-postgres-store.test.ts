import test from "node:test";
import assert from "node:assert/strict";
import {
  PostgresShadowReplayDurableStore,
  type ShadowReplayDbQuery,
} from "../shadow-replay-postgres-store.js";

const record = {
  stableReplayKey: "SHADOW_EXEC:exec-1:NIFTY:CE:25000:2026-09-03",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "SUBMIT_SHADOW",
  finalTarget: "SIMULATED_SUBMISSION",
  resultFingerprint: "fp-123",
};

function row(overrides: Partial<Record<string, string>> = {}) {
  return {
    stable_replay_key: record.stableReplayKey,
    snapshot_version: record.snapshotVersion,
    harness_version: record.harnessVersion,
    action_state: record.actionState,
    final_target: record.finalTarget,
    result_fingerprint: record.resultFingerprint,
    ...overrides,
  };
}

test("creates isolated schema, writes immutable replay, and exact-readbacks", async () => {
  const sqlSeen: string[] = [];
  const paramsSeen: unknown[][] = [];

  const query: ShadowReplayDbQuery = async <T>(sql: string, params: unknown[] = []) => {
    sqlSeen.push(sql);
    paramsSeen.push(params);
    if (sql.includes("SELECT")) return { rows: [row()] as T[] };
    return { rows: [] as T[] };
  };

  const store = new PostgresShadowReplayDurableStore(query);
  await store.write(record);
  const readBack = await store.read(record.stableReplayKey);

  assert.deepEqual(readBack, record);
  assert.equal(sqlSeen.filter((sql) => sql.includes("CREATE TABLE IF NOT EXISTS shadow_replay_durable_v1")).length, 1);
  assert.ok(sqlSeen.some((sql) => sql.includes("ON CONFLICT (stable_replay_key) DO NOTHING")));
  assert.equal(sqlSeen.some((sql) => /DO UPDATE/i.test(sql)), false);
  assert.deepEqual(paramsSeen.find((params) => params.length === 6), [
    record.stableReplayKey,
    record.snapshotVersion,
    record.harnessVersion,
    record.actionState,
    record.finalTarget,
    record.resultFingerprint,
  ]);
});

test("never overwrites an existing replay identity", async () => {
  let insertSql = "";
  const query: ShadowReplayDbQuery = async <T>(sql: string) => {
    if (sql.includes("INSERT INTO shadow_replay_durable_v1")) insertSql = sql;
    return { rows: [] as T[] };
  };

  const store = new PostgresShadowReplayDurableStore(query);
  await store.write(record);

  assert.match(insertSql, /ON CONFLICT \(stable_replay_key\) DO NOTHING/);
  assert.doesNotMatch(insertSql, /DO UPDATE/i);
});

test("fails closed when schema or database query is unavailable", async () => {
  const query: ShadowReplayDbQuery = async () => null;
  const store = new PostgresShadowReplayDurableStore(query);

  await assert.rejects(() => store.write(record), /SHADOW_REPLAY_DURABLE_SCHEMA_UNAVAILABLE/);
});

test("fails closed when durable read query fails", async () => {
  let calls = 0;
  const query: ShadowReplayDbQuery = async <T>() => {
    calls += 1;
    if (calls === 1) return { rows: [] as T[] };
    return null;
  };
  const store = new PostgresShadowReplayDurableStore(query);

  await assert.rejects(() => store.read(record.stableReplayKey), /SHADOW_REPLAY_DURABLE_READ_FAILED/);
});

test("rejects malformed persisted semantics instead of normalizing or guessing", async () => {
  const query: ShadowReplayDbQuery = async <T>(sql: string) => {
    if (sql.includes("SELECT")) {
      return { rows: [row({ final_target: "" })] as T[] };
    }
    return { rows: [] as T[] };
  };
  const store = new PostgresShadowReplayDurableStore(query);

  await assert.rejects(() => store.read(record.stableReplayKey), /INVALID_SHADOW_REPLAY_DURABLE_READBACK/);
});

test("rejects invalid input semantics before durable write", async () => {
  let touched = false;
  const query: ShadowReplayDbQuery = async <T>() => {
    touched = true;
    return { rows: [] as T[] };
  };
  const store = new PostgresShadowReplayDurableStore(query);

  await assert.rejects(
    () => store.write({ ...record, actionState: "" }),
    /INVALID_SHADOW_REPLAY_DURABLE_RECORD/,
  );
  assert.equal(touched, false);
});
