import test from "node:test";
import assert from "node:assert/strict";
import { persistShadowReplayToPostgres } from "../shadow-replay-postgres-persistence.js";
import type { ShadowReplayDbQuery } from "../shadow-replay-postgres-store.js";

const base = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "SHADOW_EXEC:exec-5d:NIFTY:CE:25000:2026-09-03",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "SHADOW_READY",
  finalTarget: "NO_BROKER_ORDER",
  resultFingerprint: "fp-5d-001",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function memoryQuery(): ShadowReplayDbQuery {
  let row: any = null;
  return async <T>(sql: string, params: unknown[] = []) => {
    if (sql.includes("CREATE TABLE")) return { rows: [] as T[] };
    if (sql.includes("INSERT INTO shadow_replay_durable_v1")) {
      if (!row) {
        row = {
          stable_replay_key: params[0],
          snapshot_version: params[1],
          harness_version: params[2],
          action_state: params[3],
          final_target: params[4],
          result_fingerprint: params[5],
        };
      }
      return { rows: [] as T[] };
    }
    if (sql.includes("FROM shadow_replay_durable_v1")) {
      return { rows: (row ? [row] : []) as T[] };
    }
    return { rows: [] as T[] };
  };
}

test("persists and exact-readbacks through Postgres composition", async () => {
  const out = await persistShadowReplayToPostgres(base, memoryQuery());
  assert.equal(out.decision, "PERSISTENCE_CONFIRMED");
  assert.equal(out.persistenceConfirmed, true);
  assert.equal(out.semanticReadBackConfirmed, true);
  assert.equal(out.durableBackend, "POSTGRES");
  assert.equal(out.placesOrder, false);
});

test("reuses identical durable replay through composition", async () => {
  const query = memoryQuery();
  const first = await persistShadowReplayToPostgres(base, query);
  assert.equal(first.decision, "PERSISTENCE_CONFIRMED");
  const second = await persistShadowReplayToPostgres({ ...base, journalDecision: "REUSE_IDENTICAL" }, query);
  assert.equal(second.decision, "REUSE_CONFIRMED");
  assert.equal(second.reusableAfterRestart, true);
});

test("same key with changed semantics fails closed", async () => {
  const query = memoryQuery();
  const first = await persistShadowReplayToPostgres(base, query);
  assert.equal(first.decision, "PERSISTENCE_CONFIRMED");
  const changed = await persistShadowReplayToPostgres({ ...base, actionState: "CHANGED_STATE" }, query);
  assert.equal(changed.decision, "BLOCK");
  assert.equal(changed.persistenceConfirmed, false);
  assert.ok(changed.reasonCodes.includes("DURABLE_READ_BACK_SEMANTIC_MISMATCH"));
});

test("database unavailable fails closed", async () => {
  const unavailable: ShadowReplayDbQuery = async () => null;
  const out = await persistShadowReplayToPostgres(base, unavailable);
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.persistenceConfirmed, false);
  assert.equal(out.placesOrder, false);
});

test("upstream replay conflict never touches database", async () => {
  let touched = false;
  const query: ShadowReplayDbQuery = async <T>() => {
    touched = true;
    return { rows: [] as T[] };
  };
  const out = await persistShadowReplayToPostgres({ ...base, journalDecision: "BLOCK_CONFLICT" }, query);
  assert.equal(out.decision, "BLOCK");
  assert.equal(touched, false);
});

test("order invariant tampering is blocked before database touch", async () => {
  let touched = false;
  const query: ShadowReplayDbQuery = async <T>() => {
    touched = true;
    return { rows: [] as T[] };
  };
  const unsafeKey = "places" + "Order";
  const out = await persistShadowReplayToPostgres({ ...base, [unsafeKey]: true } as any, query);
  assert.equal(out.decision, "BLOCK");
  assert.equal(touched, false);
  assert.equal(out.brokerOrderAllowed, false);
});
