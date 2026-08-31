import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowStartupRecoveryDiagnosticSnapshot } from "../shadow-startup-recovery-diagnostic-snapshot.js";
import { buildShadowStartupRecoveryDiagnosticReport } from "../shadow-startup-recovery-diagnostic-report.js";
import { bindShadowStartupRecoveryReadonlyRoute } from "../shadow-startup-recovery-hono-binding-adapter.js";
import type { ShadowReplayDbQuery } from "../shadow-replay-postgres-store.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "e2e-key-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "IDLE",
  finalTarget: "NONE",
  resultFingerprint: "fp-e2e-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function brokerRecovery(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as any;
}

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

function diagnosticInput(startupFactsFresh = true, recovery = brokerRecovery()) {
  return {
    diagnosticVersion: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1" as const,
    observedAt: "2026-08-31T05:40:00.000Z",
    dryRun: {
      startupVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1" as const,
      startupFactsFresh,
      runtime: {
        runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1" as const,
        recovery: { persistence, brokerRecovery: recovery },
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

const registrationInput = {
  version: "SHADOW_STARTUP_RECOVERY_ROUTE_REGISTRATION_V1" as const,
  method: "GET" as const,
  path: "/api/shadow/startup-recovery" as const,
  readOnly: true as const,
  diagnosticOnly: true as const,
  registrationSideEffectsAllowed: false as const,
  startupSideEffectsAllowed: false as const,
  newEntryResumeAllowed: false as const,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

async function runIntegrated(startupFactsFresh = true, recovery = brokerRecovery()) {
  const snapshot = await buildShadowStartupRecoveryDiagnosticSnapshot(diagnosticInput(startupFactsFresh, recovery), fakeQuery());
  const report = buildShadowStartupRecoveryDiagnosticReport(snapshot);
  let captured: ((context: unknown) => unknown) | null = null;
  const app = { get(path: string, handler: (context: unknown) => unknown) { assert.equal(path, "/api/shadow/startup-recovery"); captured = handler; } } as any;
  const binding = bindShadowStartupRecoveryReadonlyRoute(app, registrationInput, () => ({
    method: "GET" as const,
    path: "/api/shadow/startup-recovery" as const,
    report,
    readOnly: true as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  }));
  assert.equal(binding.accepted, true);
  assert.equal(binding.bound, true);
  assert.ok(captured);
  const response = captured!({});
  return { snapshot, report, binding, response: response as any };
}

test("full startup recovery chain reaches read-only Hono response with zero order authority", async () => {
  const result = await runIntegrated();
  assert.equal(result.snapshot.decision, "RESUME_IDLE_SHADOW");
  assert.equal(result.report.status, "PASS");
  assert.equal(result.response.httpStatus, 200);
  assert.equal(result.response.readOnly, true);
  assert.equal(result.response.newEntryResumeAllowed, false);
  assert.equal(result.response.authorizesOrder, false);
  assert.equal(result.response.brokerOrderAllowed, false);
  assert.equal(result.response.placesOrder, false);
});

test("stale startup facts propagate end-to-end as BLOCK/503 and never enable entry", async () => {
  const result = await runIntegrated(false);
  assert.equal(result.snapshot.decision, "HALT");
  assert.equal(result.report.status, "BLOCK");
  assert.equal(result.response.httpStatus, 503);
  assert.equal(result.response.newEntryResumeAllowed, false);
  assert.equal(result.response.placesOrder, false);
});

test("repeated read-only requests are deterministic and retain zero broker authority", async () => {
  const snapshot = await buildShadowStartupRecoveryDiagnosticSnapshot(diagnosticInput(), fakeQuery());
  const report = buildShadowStartupRecoveryDiagnosticReport(snapshot);
  let captured: ((context: unknown) => unknown) | null = null;
  const app = { get(_path: string, handler: (context: unknown) => unknown) { captured = handler; } } as any;
  bindShadowStartupRecoveryReadonlyRoute(app, registrationInput, () => ({
    method: "GET" as const, path: "/api/shadow/startup-recovery" as const, report,
    readOnly: true as const, authorizesOrder: false as const, brokerOrderAllowed: false as const,
    placesOrder: false as const, shadowOnly: true as const, failClosed: true as const,
  }));
  const first: any = captured!({});
  const second: any = captured!({});
  assert.equal(first.body, second.body);
  assert.equal(first.placesOrder, false);
  assert.equal(second.placesOrder, false);
});

test("tampered route registration fails closed before Hono binding", async () => {
  let calls = 0;
  const app = { get() { calls += 1; } } as any;
  const bad: any = { ...registrationInput, placesOrder: true };
  const binding = bindShadowStartupRecoveryReadonlyRoute(app, bad, () => { throw new Error("must not run"); });
  assert.equal(binding.accepted, false);
  assert.equal(binding.bound, false);
  assert.equal(binding.placesOrder, false);
  assert.equal(calls, 0);
});
