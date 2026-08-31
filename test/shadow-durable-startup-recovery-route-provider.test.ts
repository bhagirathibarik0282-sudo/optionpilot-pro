import test from "node:test";
import assert from "node:assert/strict";
import { runShadowDurableStartupRecoveryRouteProvider } from "../shadow-durable-startup-recovery-route-provider.js";
import type { ShadowPostgresRestartRuntimeResult } from "../shadow-postgres-restart-runtime-adapter.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "route-key-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "IDLE",
  finalTarget: "NONE",
  resultFingerprint: "fp-route-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function input() {
  return {
    providerVersion: "SHADOW_DURABLE_STARTUP_RECOVERY_ROUTE_PROVIDER_V1" as const,
    method: "GET" as const,
    path: "/api/shadow/startup-recovery" as const,
    executionId: "exec-route-1",
    persistence,
    observedAt: "2026-08-31T09:10:00.000Z",
    startupFactsFresh: true,
    readOnly: true as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

function runtime(decision: ShadowPostgresRestartRuntimeResult["decision"] = "RESUME_IDLE_SHADOW"): ShadowPostgresRestartRuntimeResult {
  return {
    runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1",
    runtimeAccepted: true,
    version: "SHADOW_POSTGRES_RESTART_RECOVERY_E2E_V1",
    durableBackend: "POSTGRES",
    decision,
    persistenceDecision: "PERSISTENCE_CONFIRMED",
    persistenceConfirmed: true,
    semanticReadBackConfirmed: true,
    managementResumeAllowed: decision === "RESUME_MANAGEMENT_SHADOW",
    newEntryResumeAllowed: false,
    reconciliationRequired: decision === "RECONCILE_REQUIRED",
    effectiveOpenQuantity: decision === "RESUME_MANAGEMENT_SHADOW" ? 1 : 0,
    reasonCodes: ["DURABLE_ROUTE_TEST"],
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

test("valid durable route path returns read-only PASS without entry authority", async () => {
  let seenExecutionId = "";
  const result = await runShadowDurableStartupRecoveryRouteProvider(input(), {
    runProvider: async (providerInput) => {
      seenExecutionId = providerInput.executionId;
      assert.equal((providerInput as any).brokerRecovery, undefined);
      return runtime();
    },
  });
  assert.equal(seenExecutionId, "exec-route-1");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.readOnly, true);
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.placesOrder, false);
});

test("stale startup facts block before durable provider call", async () => {
  let calls = 0;
  const value = input();
  value.startupFactsFresh = false;
  const result = await runShadowDurableStartupRecoveryRouteProvider(value, {
    runProvider: async () => { calls += 1; return runtime(); },
  });
  assert.equal(calls, 0);
  assert.equal(result.httpStatus, 503);
  assert.match(result.body, /DURABLE_STARTUP_ROUTE_STARTUP_FACTS_STALE/);
});

test("missing or blocked durable recovery propagates BLOCK read-only", async () => {
  const blocked = runtime("HALT");
  blocked.runtimeAccepted = false;
  blocked.persistenceConfirmed = false;
  blocked.semanticReadBackConfirmed = false;
  blocked.persistenceDecision = "BLOCK";
  blocked.reasonCodes = ["DURABLE_BROKER_RECOVERY_FACTS_UNAVAILABLE"];
  const result = await runShadowDurableStartupRecoveryRouteProvider(input(), {
    runProvider: async () => blocked,
  });
  assert.equal(result.httpStatus, 503);
  assert.match(result.body, /DURABLE_BROKER_RECOVERY_FACTS_UNAVAILABLE/);
  assert.equal(result.routeSideEffectsAllowed, false);
});

test("runtime invariant tampering is rejected fail-closed", async () => {
  const tampered: any = runtime();
  tampered.placesOrder = true;
  const result = await runShadowDurableStartupRecoveryRouteProvider(input(), {
    runProvider: async () => tampered,
  });
  assert.equal(result.httpStatus, 503);
  assert.match(result.body, /DURABLE_STARTUP_ROUTE_RUNTIME_INVARIANT_VIOLATED/);
});
