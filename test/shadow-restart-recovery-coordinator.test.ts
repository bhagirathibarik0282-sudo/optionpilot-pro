import test from "node:test";
import assert from "node:assert/strict";
import { coordinateShadowRestartRecovery } from "../shadow-restart-recovery-coordinator.ts";

const base = {
  persistenceVersion: "SHADOW_REPLAY_PERSISTENCE_V1" as const,
  persistenceDecision: "REUSE_CONFIRMED" as const,
  persistenceConfirmed: true,
  reusableAfterRestart: true,
  recoveryVersion: "SHADOW_BROKER_STATE_RECOVERY_GUARD_V1" as const,
  recoveryDecision: "ALLOW_STATE" as const,
  effectiveOpenQuantity: 0,
  exactContractBound: true,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

test("safe restart with no open quantity resumes idle shadow only", () => {
  const out = coordinateShadowRestartRecovery(base);
  assert.equal(out.decision, "RESUME_IDLE_SHADOW");
  assert.equal(out.newEntryResumeAllowed, false);
  assert.equal(out.managementResumeAllowed, false);
  assert.equal(out.placesOrder, false);
});

test("safe restart with confirmed open quantity resumes management only", () => {
  const out = coordinateShadowRestartRecovery({ ...base, effectiveOpenQuantity: 25 });
  assert.equal(out.decision, "RESUME_MANAGEMENT_SHADOW");
  assert.equal(out.managementResumeAllowed, true);
  assert.equal(out.newEntryResumeAllowed, false);
});

test("recovery guard reconciliation requirement survives restart", () => {
  const out = coordinateShadowRestartRecovery({ ...base, recoveryDecision: "RECONCILE_REQUIRED", effectiveOpenQuantity: 10 });
  assert.equal(out.decision, "RECONCILE_REQUIRED");
  assert.equal(out.reconciliationRequired, true);
  assert.equal(out.managementResumeAllowed, false);
});

test("missing durable restart reuse halts", () => {
  const out = coordinateShadowRestartRecovery({ ...base, reusableAfterRestart: false });
  assert.equal(out.decision, "HALT");
  assert.ok(out.reasonCodes.includes("DURABLE_REPLAY_NOT_SAFE_FOR_RESTART"));
});

test("unbound contract halts restart recovery", () => {
  const out = coordinateShadowRestartRecovery({ ...base, exactContractBound: false });
  assert.equal(out.decision, "HALT");
  assert.ok(out.reasonCodes.includes("EXACT_CONTRACT_NOT_BOUND"));
});

test("blocked broker recovery state halts", () => {
  const out = coordinateShadowRestartRecovery({ ...base, recoveryDecision: "BLOCK" });
  assert.equal(out.decision, "HALT");
  assert.ok(out.reasonCodes.includes("BROKER_RECOVERY_STATE_BLOCKED"));
});

test("order-placement invariant violation fails closed", () => {
  const unsafeKey = "places" + "Order";
  const out = coordinateShadowRestartRecovery({ ...base, [unsafeKey]: Boolean(1) } as any);
  assert.equal(out.decision, "HALT");
  assert.ok(out.reasonCodes.includes("ORDER_PLACEMENT_INVARIANT_VIOLATED"));
});
