import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExecutionConsistencySnapshot } from "../execution-consistency-snapshot.js";

const good = {
  exactContractIdentityValid: true,
  positionTruthDecision: "MATCH" as const,
  orderReconciliationDecision: "OK" as const,
  protectionHealth: "PROTECTED" as const,
  idempotencyDecision: "ALLOW" as const,
  preTradePersistenceConfirmed: true,
  brokerSessionReady: true,
  killSwitchDecision: "RUN" as const,
  hasOpenPosition: false,
  quantumStatus: "READY" as const,
};

test("all hard dimensions clean => READY", () => {
  const r = evaluateExecutionConsistencySnapshot(good);
  assert.equal(r.state, "READY");
  assert.equal(r.newEntryAllowed, true);
  assert.equal(r.brokerOrderAllowed, false);
  assert.equal(r.placesOrder, false);
});

test("quantum unavailable alone stays READY with deterministic fallback", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, quantumStatus: "UNAVAILABLE" });
  assert.equal(r.state, "READY");
  assert.equal(r.newEntryAllowed, true);
  assert.ok(r.reasonCodes.includes("QUANTUM_OPTIONAL_DETERMINISTIC_FALLBACK"));
});

test("position mismatch => RECONCILE, never new entry", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, positionTruthDecision: "RECONCILE" });
  assert.equal(r.state, "RECONCILE");
  assert.equal(r.newEntryAllowed, false);
});

test("working/partial order => RECONCILE", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, orderReconciliationDecision: "RECONCILE" });
  assert.equal(r.state, "RECONCILE");
});

test("protection restore required => RECONCILE and management continues for open position", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, hasOpenPosition: true, protectionHealth: "RESTORE_REQUIRED" });
  assert.equal(r.state, "RECONCILE");
  assert.equal(r.managementAllowed, true);
  assert.equal(r.newEntryAllowed, false);
});

test("critical unmanaged open position => EMERGENCY", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, hasOpenPosition: true, positionTruthDecision: "CRITICAL_UNMANAGED_POSITION" });
  assert.equal(r.state, "EMERGENCY");
  assert.equal(r.emergencyExitRequired, true);
  assert.equal(r.managementAllowed, true);
});

test("kill-switch emergency with open position => EMERGENCY", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, hasOpenPosition: true, killSwitchDecision: "EMERGENCY_EXIT_INTENT" });
  assert.equal(r.state, "EMERGENCY");
  assert.equal(r.emergencyExitRequired, true);
});

test("emergency signal without confirmed open position fails closed as HALT", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, killSwitchDecision: "EMERGENCY_EXIT_INTENT" });
  assert.equal(r.state, "HALT");
  assert.equal(r.emergencyExitRequired, false);
});

test("identity failure => HALT", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, exactContractIdentityValid: false });
  assert.equal(r.state, "HALT");
  assert.equal(r.newEntryAllowed, false);
});

test("persistence not confirmed => HALT", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, preTradePersistenceConfirmed: false });
  assert.equal(r.state, "HALT");
});

test("idempotency block => HALT", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, idempotencyDecision: "BLOCK" });
  assert.equal(r.state, "HALT");
});

test("broker session unavailable => HALT", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, brokerSessionReady: false });
  assert.equal(r.state, "HALT");
});

test("kill switch halt => HALT", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, killSwitchDecision: "HALT_NEW_ENTRIES" });
  assert.equal(r.state, "HALT");
});

test("order HALT outranks recoverable reconcile", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, positionTruthDecision: "RECONCILE", orderReconciliationDecision: "HALT" });
  assert.equal(r.state, "HALT");
});

test("emergency outranks HALT and RECONCILE", () => {
  const r = evaluateExecutionConsistencySnapshot({
    ...good,
    hasOpenPosition: true,
    positionTruthDecision: "RECONCILE",
    orderReconciliationDecision: "HALT",
    protectionHealth: "EMERGENCY_EXIT_REQUIRED",
  });
  assert.equal(r.state, "EMERGENCY");
  assert.equal(r.emergencyExitRequired, true);
});

test("invalid enum fails closed", () => {
  const r = evaluateExecutionConsistencySnapshot({ ...good, positionTruthDecision: "BROKEN" as any });
  assert.equal(r.state, "HALT");
  assert.ok(r.reasonCodes.includes("INVALID_POSITION_TRUTH_DECISION"));
});
