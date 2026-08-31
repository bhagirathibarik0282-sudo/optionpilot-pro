import test from "node:test";
import assert from "node:assert/strict";
import { coordinateShadowExecutionIntent } from "../shadow-execution-intent-coordinator.ts";

const base = {
  actionPlanVersion: "EXECUTION_ACTION_PLANNER_V1" as const,
  action: "HALT_NEW_ACTIONS" as const,
  entryIntentEligible: false,
  managementIntentAllowed: false,
  reconciliationRequired: false,
  emergencyExitIntentRequired: false,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
  exactContractBound: true,
  hasConfirmedOpenPosition: false,
};

test("routes an authorized shadow entry only to the shadow entry pipeline", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "ENTRY_ELIGIBLE_SHADOW",
    entryIntentEligible: true,
    shadowEntryAuthorizationDecision: "AUTHORIZE_SIMULATION",
  });
  assert.equal(out.route, "SHADOW_ENTRY_PIPELINE");
  assert.equal(out.downstreamEntryEligible, true);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.placesOrder, false);
});

test("blocks shadow entry without simulation authorization", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "ENTRY_ELIGIBLE_SHADOW",
    entryIntentEligible: true,
    shadowEntryAuthorizationDecision: "BLOCK",
  });
  assert.equal(out.route, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["SHADOW_ENTRY_NOT_AUTHORIZED"]);
});

test("routes reconciliation only when evidence is ready", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "RECONCILE_ONLY",
    reconciliationRequired: true,
    managementIntentAllowed: true,
    hasConfirmedOpenPosition: true,
    reconciliationEvidenceReady: true,
  });
  assert.equal(out.route, "RECONCILIATION_PIPELINE");
  assert.equal(out.downstreamReconciliationRequired, true);
  assert.equal(out.downstreamManagementEligible, true);
});

test("fails closed when reconciliation evidence is missing", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "RECONCILE_ONLY",
    reconciliationRequired: true,
  });
  assert.equal(out.route, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["RECONCILIATION_EVIDENCE_NOT_READY"]);
});

test("blocks reconciliation when exact contract is not bound", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "RECONCILE_ONLY",
    reconciliationRequired: true,
    managementIntentAllowed: true,
    hasConfirmedOpenPosition: true,
    reconciliationEvidenceReady: true,
    exactContractBound: false,
  });
  assert.equal(out.route, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["RECONCILIATION_CONTRACT_NOT_BOUND"]);
  assert.equal(out.downstreamManagementEligible, false);
  assert.equal(out.downstreamReconciliationRequired, false);
});

test("routes emergency exit only with confirmed position, contract and ready exit intent", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "EMERGENCY_EXIT_INTENT",
    managementIntentAllowed: true,
    emergencyExitIntentRequired: true,
    hasConfirmedOpenPosition: true,
    exitIntentDecision: "READY",
  });
  assert.equal(out.route, "EMERGENCY_EXIT_PIPELINE");
  assert.equal(out.downstreamEmergencyExitEligible, true);
  assert.equal(out.downstreamManagementEligible, true);
  assert.equal(out.placesOrder, false);
});

test("blocks emergency exit when no confirmed position exists", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    action: "EMERGENCY_EXIT_INTENT",
    managementIntentAllowed: true,
    emergencyExitIntentRequired: true,
    exitIntentDecision: "READY",
  });
  assert.equal(out.route, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["EMERGENCY_EXIT_WITHOUT_CONFIRMED_POSITION"]);
});

test("preserves management-only semantics under halt", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    managementIntentAllowed: true,
    hasConfirmedOpenPosition: true,
  });
  assert.equal(out.route, "MANAGEMENT_ONLY");
  assert.equal(out.downstreamManagementEligible, true);
});

test("blocks management-only routing when exact contract is not bound", () => {
  const out = coordinateShadowExecutionIntent({
    ...base,
    managementIntentAllowed: true,
    hasConfirmedOpenPosition: true,
    exactContractBound: false,
  });
  assert.equal(out.route, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["MANAGEMENT_CONTRACT_NOT_BOUND"]);
  assert.equal(out.downstreamManagementEligible, false);
});

test("halts to no-new-action when no position management is needed", () => {
  const out = coordinateShadowExecutionIntent(base);
  assert.equal(out.route, "NO_NEW_ACTION");
  assert.equal(out.downstreamEntryEligible, false);
});

test("blocks contradictory halt flags", () => {
  const out = coordinateShadowExecutionIntent({ ...base, entryIntentEligible: true });
  assert.equal(out.route, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["INCONSISTENT_HALT_ACTION_PLAN"]);
});

test("blocks any upstream broker-order invariant violation", () => {
  const out = coordinateShadowExecutionIntent({ ...base, brokerOrderAllowed: true } as any);
  assert.equal(out.route, "BLOCKED");
  assert.ok(out.reasonCodes.includes("BROKER_ORDER_INVARIANT_VIOLATED"));
});

test("blocks any upstream place-order invariant violation", () => {
  const out = coordinateShadowExecutionIntent({ ...base, placesOrder: true } as any);
  assert.equal(out.route, "BLOCKED");
  assert.ok(out.reasonCodes.includes("ORDER_PLACEMENT_INVARIANT_VIOLATED"));
});
