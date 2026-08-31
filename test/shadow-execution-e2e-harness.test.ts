import test from "node:test";
import assert from "node:assert/strict";
import { runShadowExecutionE2EHarness } from "../shadow-execution-e2e-harness.ts";

const baseSnapshot = {
  version: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  state: "READY" as const,
  newEntryAllowed: true,
  managementAllowed: false,
  emergencyExitRequired: false,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  failClosed: true as const,
};

test("routes safe READY snapshot end-to-end to shadow submission state", () => {
  const out = runShadowExecutionE2EHarness({
    snapshot: baseSnapshot,
    exactContractBound: true,
    hasConfirmedOpenPosition: false,
    shadowEntryAuthorizationDecision: "AUTHORIZE_SIMULATION",
  });
  assert.equal(out.action, "ENTRY_ELIGIBLE_SHADOW");
  assert.equal(out.route, "SHADOW_ENTRY_PIPELINE");
  assert.equal(out.adapterDecision, "ENTRY_STATE_READY");
  assert.equal(out.target, "SHADOW_SUBMISSION_STATE");
  assert.equal(out.placesOrder, false);
  assert.equal(out.authorizesOrder, false);
});

test("fails closed when entry simulation authorization is missing", () => {
  const out = runShadowExecutionE2EHarness({
    snapshot: baseSnapshot,
    exactContractBound: true,
    hasConfirmedOpenPosition: false,
    shadowEntryAuthorizationDecision: "BLOCK",
  });
  assert.equal(out.target, "BLOCKED");
  assert.ok(out.reasonCodes.includes("SHADOW_ENTRY_NOT_AUTHORIZED"));
});

test("routes reconciliation end-to-end without creating an order", () => {
  const out = runShadowExecutionE2EHarness({
    snapshot: { ...baseSnapshot, state: "RECONCILE", newEntryAllowed: false, managementAllowed: true },
    exactContractBound: true,
    hasConfirmedOpenPosition: true,
    reconciliationEvidenceReady: true,
  });
  assert.equal(out.target, "RECONCILIATION_ENGINE");
  assert.equal(out.placesOrder, false);
});

test("routes emergency end-to-end only with confirmed position and ready exit intent", () => {
  const out = runShadowExecutionE2EHarness({
    snapshot: { ...baseSnapshot, state: "EMERGENCY", newEntryAllowed: false, managementAllowed: true, emergencyExitRequired: true },
    exactContractBound: true,
    hasConfirmedOpenPosition: true,
    exitIntentDecision: "READY",
  });
  assert.equal(out.target, "EXIT_INTENT_STATE");
  assert.equal(out.placesOrder, false);
});

test("blocks emergency path without a confirmed position", () => {
  const out = runShadowExecutionE2EHarness({
    snapshot: { ...baseSnapshot, state: "EMERGENCY", newEntryAllowed: false, managementAllowed: true, emergencyExitRequired: true },
    exactContractBound: true,
    hasConfirmedOpenPosition: false,
    exitIntentDecision: "READY",
  });
  assert.equal(out.target, "BLOCKED");
  assert.ok(out.reasonCodes.includes("EMERGENCY_EXIT_WITHOUT_CONFIRMED_POSITION"));
});

test("same input replays deterministically with identical safe output", () => {
  const input = {
    snapshot: baseSnapshot,
    exactContractBound: true,
    hasConfirmedOpenPosition: false,
    shadowEntryAuthorizationDecision: "AUTHORIZE_SIMULATION" as const,
  };
  const a = runShadowExecutionE2EHarness(input);
  const b = runShadowExecutionE2EHarness(input);
  assert.deepEqual(a, b);
});
