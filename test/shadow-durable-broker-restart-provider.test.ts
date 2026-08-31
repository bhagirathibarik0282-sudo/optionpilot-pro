import test from "node:test";
import assert from "node:assert/strict";
import { runShadowDurableBrokerRestartProvider } from "../shadow-durable-broker-restart-provider.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "provider-key-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "IDLE",
  finalTarget: "NONE",
  resultFingerprint: "fp-provider-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

const durableFacts = {
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

function input() {
  return {
    providerVersion: "SHADOW_DURABLE_BROKER_RESTART_PROVIDER_V1" as const,
    executionId: "exec-provider-1",
    persistence,
    nowIso: "2026-08-31T08:55:00.000Z",
    maxBrokerFactsAgeMs: 300000,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

function safeRuntimeResult() {
  return {
    runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1" as const,
    runtimeAccepted: true,
    version: "SHADOW_POSTGRES_RESTART_RECOVERY_E2E_V1" as const,
    durableBackend: "POSTGRES" as const,
    decision: "RESUME_IDLE_SHADOW" as const,
    persistenceDecision: "PERSISTENCE_CONFIRMED" as any,
    persistenceConfirmed: true,
    semanticReadBackConfirmed: true,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false as const,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    reasonCodes: ["SAFE"],
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
}

test("loads broker recovery facts by executionId and injects only durable facts into runtime", async () => {
  let loadedExecutionId = "";
  let observedBrokerRecovery: unknown = null;
  const result = await runShadowDurableBrokerRestartProvider(input(), {
    loadBrokerFacts: async (executionId) => {
      loadedExecutionId = executionId;
      return durableFacts;
    },
    query: async () => ({ rows: [] }),
    runRuntime: async (envelope) => {
      observedBrokerRecovery = envelope.recovery.brokerRecovery;
      return safeRuntimeResult() as any;
    },
  });
  assert.equal(loadedExecutionId, "exec-provider-1");
  assert.deepEqual(observedBrokerRecovery, durableFacts);
  assert.equal(result.decision, "RESUME_IDLE_SHADOW");
  assert.equal(result.newEntryResumeAllowed, false);
  assert.equal(result.placesOrder, false);
});

test("missing durable broker facts halt before runtime", async () => {
  let runtimeCalls = 0;
  const result = await runShadowDurableBrokerRestartProvider(input(), {
    loadBrokerFacts: async () => null,
    query: async () => ({ rows: [] }),
    runRuntime: async () => { runtimeCalls += 1; return safeRuntimeResult() as any; },
  });
  assert.equal(result.decision, "HALT");
  assert.equal(result.runtimeAccepted, false);
  assert.equal(runtimeCalls, 0);
  assert.ok(result.reasonCodes.includes("DURABLE_BROKER_RECOVERY_FACTS_UNAVAILABLE"));
});

test("stale durable broker facts halt before runtime", async () => {
  let runtimeCalls = 0;
  const result = await runShadowDurableBrokerRestartProvider(input(), {
    loadBrokerFacts: async () => ({ ...durableFacts, stateFactsFresh: false }),
    query: async () => ({ rows: [] }),
    runRuntime: async () => { runtimeCalls += 1; return safeRuntimeResult() as any; },
  });
  assert.equal(result.decision, "HALT");
  assert.equal(runtimeCalls, 0);
  assert.ok(result.reasonCodes.includes("DURABLE_BROKER_RECOVERY_FACTS_STALE"));
});

test("durable facts that violate exact-contract invariant halt before runtime", async () => {
  let runtimeCalls = 0;
  const result = await runShadowDurableBrokerRestartProvider(input(), {
    loadBrokerFacts: async () => ({ ...durableFacts, exactContractBound: false }),
    query: async () => ({ rows: [] }),
    runRuntime: async () => { runtimeCalls += 1; return safeRuntimeResult() as any; },
  });
  assert.equal(result.decision, "HALT");
  assert.equal(runtimeCalls, 0);
  assert.ok(result.reasonCodes.includes("DURABLE_BROKER_RECOVERY_FACTS_INVARIANT_VIOLATED"));
});

test("loader failure is fail-closed and never reaches runtime", async () => {
  let runtimeCalls = 0;
  const result = await runShadowDurableBrokerRestartProvider(input(), {
    loadBrokerFacts: async () => { throw new Error("db unavailable"); },
    query: async () => ({ rows: [] }),
    runRuntime: async () => { runtimeCalls += 1; return safeRuntimeResult() as any; },
  });
  assert.equal(result.decision, "HALT");
  assert.equal(runtimeCalls, 0);
  assert.equal(result.authorizesOrder, false);
  assert.equal(result.brokerOrderAllowed, false);
  assert.equal(result.placesOrder, false);
});
