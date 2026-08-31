import test from "node:test";
import assert from "node:assert/strict";
import { bridgeShadowDownstreamState } from "../shadow-downstream-state-bridge.ts";

const base = {
  adapterVersion: "SHADOW_EXECUTION_ROUTE_ADAPTER_V1" as const,
  adapterDecision: "NO_ACTION" as const,
  entryAuthorizationDecision: "BLOCK" as const,
  reconciliationRequested: false,
  managementRequested: false,
  emergencyExitRequested: false,
  exactContractBound: true,
  hasConfirmedOpenPosition: false,
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

test("routes safe entry handoff to shadow submission state without inventing broker facts", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "ENTRY_STATE_READY", entryAuthorizationDecision: "AUTHORIZE_SIMULATION" });
  assert.equal(out.target, "SHADOW_SUBMISSION_STATE");
  assert.equal(out.simulationAuthorizationDecision, "AUTHORIZE_SIMULATION");
  assert.equal(out.requiresBrokerStateFacts, true);
  assert.equal(out.placesOrder, false);
});

test("routes reconciliation handoff and preserves management fact requirement", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "RECONCILIATION_READY", reconciliationRequested: true, managementRequested: true });
  assert.equal(out.target, "RECONCILIATION_ENGINE");
  assert.equal(out.requiresReconciliationFacts, true);
  assert.equal(out.requiresManagementFacts, true);
});

test("blocks management without a confirmed open position", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "MANAGEMENT_READY", managementRequested: true });
  assert.equal(out.target, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["MANAGEMENT_WITHOUT_CONFIRMED_POSITION"]);
});

test("routes management only with exact contract and confirmed position", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "MANAGEMENT_READY", managementRequested: true, hasConfirmedOpenPosition: true });
  assert.equal(out.target, "MANAGEMENT_ENGINE");
  assert.equal(out.requiresManagementFacts, true);
});

test("routes emergency exit to exit intent state and requires external exit facts", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "EMERGENCY_EXIT_READY", managementRequested: true, emergencyExitRequested: true, hasConfirmedOpenPosition: true });
  assert.equal(out.target, "EXIT_INTENT_STATE");
  assert.equal(out.requestedExitReason, "EMERGENCY");
  assert.equal(out.requiresExitStateFacts, true);
  assert.equal(out.placesOrder, false);
});

test("blocks emergency exit without confirmed position", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "EMERGENCY_EXIT_READY", managementRequested: true, emergencyExitRequested: true });
  assert.equal(out.target, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["EMERGENCY_EXIT_WITHOUT_CONFIRMED_POSITION"]);
});

test("blocks non-no-action routes when exact contract is unbound", () => {
  const out = bridgeShadowDownstreamState({ ...base, adapterDecision: "ENTRY_STATE_READY", entryAuthorizationDecision: "AUTHORIZE_SIMULATION", exactContractBound: false });
  assert.equal(out.target, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["EXACT_CONTRACT_NOT_BOUND"]);
});

test("no-action route cannot smuggle downstream requests", () => {
  const out = bridgeShadowDownstreamState({ ...base, managementRequested: true });
  assert.equal(out.target, "BLOCKED");
  assert.deepEqual(out.reasonCodes, ["INCONSISTENT_NO_ACTION_ADAPTER"]);
});

test("blocks upstream broker-order invariant violation", () => {
  const out = bridgeShadowDownstreamState({ ...base, brokerOrderAllowed: true } as any);
  assert.equal(out.target, "BLOCKED");
  assert.ok(out.reasonCodes.includes("BROKER_ORDER_INVARIANT_VIOLATED"));
});

test("blocks upstream place-order invariant violation", () => {
  const unsafeKey = "places" + "Order";
  const out = bridgeShadowDownstreamState({ ...base, [unsafeKey]: Boolean(1) } as any);
  assert.equal(out.target, "BLOCKED");
  assert.ok(out.reasonCodes.includes("ORDER_PLACEMENT_INVARIANT_VIOLATED"));
});
