import test from "node:test";
import assert from "node:assert/strict";
import { runShadowRestartRecoveryE2E } from "../shadow-restart-recovery-e2e-harness.js";

const persistence = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "REUSE_IDENTICAL" as const,
  stableReplayKey: "SHADOW_EXEC:exec-1:NIFTY:CE:25000:2026-09-03",
  resultFingerprint: "fp-1",
  writeAttempted: false,
  writeSucceeded: false,
  readBackFound: true,
  readBackReplayKey: "SHADOW_EXEC:exec-1:NIFTY:CE:25000:2026-09-03",
  readBackResultFingerprint: "fp-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

const brokerRecovery = {
  stateVersion: "SHADOW_BROKER_SUBMISSION_STATE_V1" as const,
  state: "ACKNOWLEDGED" as const,
  stateFactsFresh: true,
  filledQuantity: 0,
  totalQuantity: 50,
  cancelled: false,
  exactContractBound: true,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

test("restart with durable replay and no open fill resumes idle only", () => {
  const out = runShadowRestartRecoveryE2E({ persistence, brokerRecovery });
  assert.equal(out.decision, "RESUME_IDLE_SHADOW");
  assert.equal(out.newEntryResumeAllowed, false);
  assert.equal(out.managementResumeAllowed, false);
});

test("restart with confirmed filled exposure resumes management only", () => {
  const out = runShadowRestartRecoveryE2E({
    persistence,
    brokerRecovery: { ...brokerRecovery, state: "FILLED", filledQuantity: 50 },
  });
  assert.equal(out.decision, "RESUME_MANAGEMENT_SHADOW");
  assert.equal(out.effectiveOpenQuantity, 50);
  assert.equal(out.newEntryResumeAllowed, false);
});

test("stale broker facts force reconciliation", () => {
  const out = runShadowRestartRecoveryE2E({
    persistence,
    brokerRecovery: { ...brokerRecovery, stateFactsFresh: false },
  });
  assert.equal(out.decision, "RECONCILE_REQUIRED");
  assert.equal(out.reconciliationRequired, true);
});

test("partial fill plus cancellation preserves exposure and reconciles", () => {
  const out = runShadowRestartRecoveryE2E({
    persistence,
    brokerRecovery: { ...brokerRecovery, state: "CANCELLED", cancelled: true, filledQuantity: 20 },
  });
  assert.equal(out.decision, "RECONCILE_REQUIRED");
  assert.equal(out.effectiveOpenQuantity, 20);
});

test("missing durable readback halts restart", () => {
  const out = runShadowRestartRecoveryE2E({
    persistence: { ...persistence, readBackFound: false },
    brokerRecovery,
  });
  assert.equal(out.decision, "HALT");
  assert.equal(out.newEntryResumeAllowed, false);
});

test("unbound contract halts restart", () => {
  const out = runShadowRestartRecoveryE2E({
    persistence,
    brokerRecovery: { ...brokerRecovery, exactContractBound: false },
  });
  assert.equal(out.decision, "HALT");
});

test("same restart input is deterministic", () => {
  const a = runShadowRestartRecoveryE2E({ persistence, brokerRecovery });
  const b = runShadowRestartRecoveryE2E({ persistence, brokerRecovery });
  assert.deepEqual(a, b);
  assert.equal(a.placesOrder, false);
  assert.equal(a.authorizesOrder, false);
});
