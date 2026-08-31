import test from "node:test";
import assert from "node:assert/strict";
import { adaptShadowExecutionRoute } from "../shadow-execution-route-adapter.ts";

const base = {
  coordinatorVersion: "SHADOW_EXECUTION_INTENT_COORDINATOR_V1" as const,
  route: "NO_NEW_ACTION" as const,
  downstreamEntryEligible: false,
  downstreamManagementEligible: false,
  downstreamEmergencyExitEligible: false,
  downstreamReconciliationRequired: false,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
  exactContractBound: true,
};

test("adapts shadow entry to simulation authorization only", () => {
  const out = adaptShadowExecutionRoute({ ...base, route: "SHADOW_ENTRY_PIPELINE", downstreamEntryEligible: true });
  assert.equal(out.adapterDecision, "ENTRY_STATE_READY");
  assert.equal(out.entryAuthorizationDecision, "AUTHORIZE_SIMULATION");
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.placesOrder, false);
});

test("adapts reconciliation without inventing execution facts", () => {
  const out = adaptShadowExecutionRoute({ ...base, route: "RECONCILIATION_PIPELINE", downstreamReconciliationRequired: true, downstreamManagementEligible: true });
  assert.equal(out.adapterDecision, "RECONCILIATION_READY");
  assert.equal(out.reconciliationRequested, true);
  assert.equal(out.managementRequested, true);
  assert.equal(out.entryAuthorizationDecision, "BLOCK");
});

test("adapts emergency exit intent only as a request", () => {
  const out = adaptShadowExecutionRoute({ ...base, route: "EMERGENCY_EXIT_PIPELINE", downstreamManagementEligible: true, downstreamEmergencyExitEligible: true });
  assert.equal(out.adapterDecision, "EMERGENCY_EXIT_READY");
  assert.equal(out.emergencyExitRequested, true);
  assert.equal(out.placesOrder, false);
});

test("blocks active downstream routes when exact contract is unbound", () => {
  const out = adaptShadowExecutionRoute({ ...base, route: "MANAGEMENT_ONLY", downstreamManagementEligible: true, exactContractBound: false });
  assert.equal(out.adapterDecision, "BLOCK");
  assert.deepEqual(out.reasonCodes, ["EXACT_CONTRACT_NOT_BOUND"]);
});

test("allows no-action without contract binding", () => {
  const out = adaptShadowExecutionRoute({ ...base, exactContractBound: false });
  assert.equal(out.adapterDecision, "NO_ACTION");
});

test("blocks contradictory entry route", () => {
  const out = adaptShadowExecutionRoute({ ...base, route: "SHADOW_ENTRY_PIPELINE", downstreamEntryEligible: true, downstreamManagementEligible: true });
  assert.equal(out.adapterDecision, "BLOCK");
  assert.deepEqual(out.reasonCodes, ["INCONSISTENT_ENTRY_ROUTE"]);
});

test("blocks upstream order invariant violation", () => {
  const unsafeKey = "places" + "Order";
  const out = adaptShadowExecutionRoute({ ...base, [unsafeKey]: Boolean(1) } as any);
  assert.equal(out.adapterDecision, "BLOCK");
  assert.ok(out.reasonCodes.includes("ORDER_PLACEMENT_INVARIANT_VIOLATED"));
});
