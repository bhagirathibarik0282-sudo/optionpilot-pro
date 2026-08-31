import test from "node:test";
import assert from "node:assert/strict";
import { planExecutionAction } from "../execution-action-planner.ts";

const base = {
  version: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  state: "READY" as const,
  newEntryAllowed: true,
  managementAllowed: false,
  emergencyExitRequired: false,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  failClosed: true as const,
};

test("READY becomes shadow entry eligible only", () => {
  const out = planExecutionAction(base);
  assert.equal(out.action, "ENTRY_ELIGIBLE_SHADOW");
  assert.equal(out.entryIntentEligible, true);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.brokerOrderAllowed, false);
  assert.equal(out.placesOrder, false);
});

test("RECONCILE never allows a new entry", () => {
  const out = planExecutionAction({ ...base, state: "RECONCILE", newEntryAllowed: false, managementAllowed: true });
  assert.equal(out.action, "RECONCILE_ONLY");
  assert.equal(out.reconciliationRequired, true);
  assert.equal(out.entryIntentEligible, false);
});

test("HALT blocks new actions while preserving safe management flag", () => {
  const out = planExecutionAction({ ...base, state: "HALT", newEntryAllowed: false, managementAllowed: true });
  assert.equal(out.action, "HALT_NEW_ACTIONS");
  assert.equal(out.managementIntentAllowed, true);
  assert.equal(out.entryIntentEligible, false);
});

test("EMERGENCY produces exit intent only and never a broker order", () => {
  const out = planExecutionAction({
    ...base,
    state: "EMERGENCY",
    newEntryAllowed: false,
    managementAllowed: true,
    emergencyExitRequired: true,
  });
  assert.equal(out.action, "EMERGENCY_EXIT_INTENT");
  assert.equal(out.emergencyExitIntentRequired, true);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.placesOrder, false);
});

test("blocks READY state that contradicts entry eligibility", () => {
  const out = planExecutionAction({ ...base, newEntryAllowed: false });
  assert.equal(out.action, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["READY_STATE_WITHOUT_ENTRY_ELIGIBILITY"]);
});

test("blocks emergency state without required emergency invariants", () => {
  const out = planExecutionAction({ ...base, state: "EMERGENCY", newEntryAllowed: false });
  assert.equal(out.action, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["INCONSISTENT_EMERGENCY_SNAPSHOT"]);
});

test("blocks emergency flag outside EMERGENCY state", () => {
  const out = planExecutionAction({ ...base, emergencyExitRequired: true });
  assert.equal(out.action, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["EMERGENCY_FLAG_OUTSIDE_EMERGENCY_STATE"]);
});

test("blocks any upstream broker-order invariant violation", () => {
  const out = planExecutionAction({ ...base, brokerOrderAllowed: true } as any);
  assert.equal(out.action, "BLOCKED");
  assert.ok(out.reasonCodes.includes("BROKER_ORDER_INVARIANT_VIOLATED"));
});

test("blocks any upstream place-order invariant violation", () => {
  const out = planExecutionAction({ ...base, placesOrder: true } as any);
  assert.equal(out.action, "BLOCKED");
  assert.ok(out.reasonCodes.includes("ORDER_PLACEMENT_INVARIANT_VIOLATED"));
});

test("blocks invalid snapshot version fail closed", () => {
  const out = planExecutionAction({ ...base, version: "BAD" } as any);
  assert.equal(out.action, "BLOCKED");
  assert.ok(out.reasonCodes.includes("INVALID_SNAPSHOT_VERSION"));
  assert.equal(out.failClosed, true);
  assert.equal(out.shadowOnly, true);
});
