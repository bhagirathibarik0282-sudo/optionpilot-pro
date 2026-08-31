import test from "node:test";
import assert from "node:assert/strict";
import { runShadowPostgresRestartRuntime } from "../shadow-postgres-restart-runtime-adapter.js";
import type { ShadowReplayDbQuery } from "../shadow-replay-postgres-store.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "runtime-key-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "IDLE",
  finalTarget: "NONE",
  resultFingerprint: "fp-runtime-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

const brokerRecovery = {
  stateVersion: "SHADOW_BROKER_SUBMISSION_STATE_V1" as const,
  state: "AUTHORIZED" as const,
  stateFactsFresh: true,
  filledQuantity: 0,
  totalQuantity: 1,
  cancelled: false,
  exactContractBound: true,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function fakeQuery(): ShadowReplayDbQuery {
  let row: Record<string, unknown> | null = null;
  return async (sql: string, params: unknown[] = []) => {
    if (/CREATE TABLE/i.test(sql)) return { rows: [] };
    if (/INSERT INTO shadow_replay_durable_v1/i.test(sql)) {
      if (!row) {
        row = {
          stable_replay_key: params[0], snapshot_version: params[1], harness_version: params[2],
          action_state: params[3], final_target: params[4], result_fingerprint: params[5],
        };
      }
      return { rows: [] };
    }
    if (/SELECT/i.test(sql)) return { rows: row ? [row] : [] } as any;
    return { rows: [] };
  };
}

function envelope() {
  return {
    runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1" as const,
    recovery: { persistence, brokerRecovery },
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

test("accepts valid shadow runtime facts and never enables entry replay", async () => {
  const result = await runShadowPostgresRestartRuntime(envelope(), fakeQuery());
  assert.equal(result.runtimeAccepted, true);
  assert.equal(result.decision, "RESUME_IDLE_SHADOW");
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.placesOrder, false);
});

test("invalid runtime version fails closed before DB use", async () => {
  let calls = 0;
  const query: ShadowReplayDbQuery = async () => { calls += 1; return { rows: [] }; };
  const input: any = envelope();
  input.runtimeVersion = "BAD";
  const result = await runShadowPostgresRestartRuntime(input, query);
  assert.equal(result.runtimeAccepted, false);
  assert.equal(result.decision, "HALT");
  assert.equal(calls, 0);
});

test("runtime order invariant tampering fails closed before DB use", async () => {
  let calls = 0;
  const query: ShadowReplayDbQuery = async () => { calls += 1; return { rows: [] }; };
  const input: any = envelope();
  input.placesOrder = true;
  const result = await runShadowPostgresRestartRuntime(input, query);
  assert.equal(result.decision, "HALT");
  assert.equal(result.runtimeAccepted, false);
  assert.equal(calls, 0);
});

test("database unavailability halts restart", async () => {
  const query: ShadowReplayDbQuery = async () => null;
  const result = await runShadowPostgresRestartRuntime(envelope(), query);
  assert.equal(result.runtimeAccepted, true);
  assert.equal(result.decision, "HALT");
  assert.equal(result.persistenceConfirmed, false);
  assert.equal(result.newEntryResumeAllowed, false);
});

test("stale broker facts require reconciliation, never entry replay", async () => {
  const input = envelope();
  input.recovery.brokerRecovery.stateFactsFresh = false;
  const result = await runShadowPostgresRestartRuntime(input, fakeQuery());
  assert.equal(result.runtimeAccepted, true);
  assert.equal(result.decision, "RECONCILE_REQUIRED");
  assert.equal(result.reconciliationRequired, true);
  assert.equal(result.newEntryResumeAllowed, false);
});
