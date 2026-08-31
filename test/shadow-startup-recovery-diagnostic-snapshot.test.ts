import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowStartupRecoveryDiagnosticSnapshot } from "../shadow-startup-recovery-diagnostic-snapshot.js";
import type { ShadowReplayDbQuery } from "../shadow-replay-postgres-store.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "diag-key-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "IDLE",
  finalTarget: "NONE",
  resultFingerprint: "fp-diag-1",
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
      if (!row) row = {
        stable_replay_key: params[0], snapshot_version: params[1], harness_version: params[2],
        action_state: params[3], final_target: params[4], result_fingerprint: params[5],
      };
      return { rows: [] };
    }
    if (/SELECT/i.test(sql)) return { rows: row ? [row] : [] } as any;
    return { rows: [] };
  };
}

function input() {
  return {
    diagnosticVersion: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1" as const,
    observedAt: "2026-08-31T05:40:00.000Z",
    dryRun: {
      startupVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1" as const,
      startupFactsFresh: true,
      runtime: {
        runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1" as const,
        recovery: { persistence, brokerRecovery },
        authorizesOrder: false as const,
        brokerOrderAllowed: false as const,
        placesOrder: false as const,
        shadowOnly: true as const,
        failClosed: true as const,
      },
      authorizesOrder: false as const,
      brokerOrderAllowed: false as const,
      placesOrder: false as const,
      shadowOnly: true as const,
      failClosed: true as const,
    },
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

test("builds diagnostic-only snapshot for safe startup dry run", async () => {
  const result = await buildShadowStartupRecoveryDiagnosticSnapshot(input(), fakeQuery());
  assert.equal(result.diagnosticAccepted, true);
  assert.equal(result.decision, "RESUME_IDLE_SHADOW");
  assert.equal(result.observedAt, "2026-08-31T05:40:00.000Z");
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.startupSideEffectsAllowed, false);
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.placesOrder, false);
});

test("rejects fabricated or malformed observation timestamp before DB use", async () => {
  let calls = 0;
  const query: ShadowReplayDbQuery = async () => { calls += 1; return { rows: [] }; };
  const value: any = input();
  value.observedAt = "today";
  const result = await buildShadowStartupRecoveryDiagnosticSnapshot(value, query);
  assert.equal(result.diagnosticAccepted, false);
  assert.equal(result.decision, "HALT");
  assert.equal(calls, 0);
});

test("diagnostic invariant tampering fails closed before DB use", async () => {
  let calls = 0;
  const query: ShadowReplayDbQuery = async () => { calls += 1; return { rows: [] }; };
  const value: any = input();
  value.placesOrder = true;
  const result = await buildShadowStartupRecoveryDiagnosticSnapshot(value, query);
  assert.equal(result.diagnosticAccepted, false);
  assert.equal(result.startupSideEffectsAllowed, false);
  assert.equal(calls, 0);
});

test("stale startup facts are observable as HALT without enabling entry", async () => {
  const value = input();
  value.dryRun.startupFactsFresh = false;
  const result = await buildShadowStartupRecoveryDiagnosticSnapshot(value, fakeQuery());
  assert.equal(result.diagnosticAccepted, true);
  assert.equal(result.decision, "HALT");
  assert.equal(result.startupAccepted, false);
  assert.equal(result.newEntryResumeAllowed, false);
});

test("database failure propagates as diagnostic HALT", async () => {
  const query: ShadowReplayDbQuery = async () => null;
  const result = await buildShadowStartupRecoveryDiagnosticSnapshot(input(), query);
  assert.equal(result.diagnosticAccepted, true);
  assert.equal(result.decision, "HALT");
  assert.equal(result.startupSideEffectsAllowed, false);
  assert.equal(result.placesOrder, false);
});
