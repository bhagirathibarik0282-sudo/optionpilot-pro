import assert from "node:assert/strict";
import test from "node:test";
import { authorizeBrokerExecution } from "../broker-execution-authorization.ts";

const readyShadowInput = {
  mode: "SHADOW" as const,
  orderBuildDecision: "BUILD" as const,
  executionRiskDecision: "ALLOW" as const,
  killSwitchDecision: "ALLOW" as const,
  idempotencyDecision: "ALLOW" as const,
  exactContractBound: true,
  evidencePersistenceConfirmed: true,
  brokerSessionReady: true,
};

test("authorizes simulation only when every prerequisite passes", () => {
  const result = authorizeBrokerExecution(readyShadowInput);
  assert.equal(result.decision, "AUTHORIZE_SIMULATION");
  assert.equal(result.shadowOnly, true);
  assert.equal(result.placesOrder, false);
  assert.deepEqual(result.reasonCodes, ["SHADOW_EXECUTION_AUTHORIZED"]);
});

test("blocks LIVE mode even when all prerequisites pass", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, mode: "LIVE" });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.placesOrder, false);
  assert.ok(result.reasonCodes.includes("LIVE_EXECUTION_NOT_ENABLED_IN_V1"));
});

test("fails closed when risk gate is not passed", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, executionRiskDecision: "BLOCK" });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("EXECUTION_RISK_GATE_NOT_PASSED"));
});

test("fails closed when kill switch is not clear", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, killSwitchDecision: "BLOCK" });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("KILL_SWITCH_NOT_CLEAR"));
});

test("fails closed on duplicate/idempotency rejection", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, idempotencyDecision: "BLOCK" });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("IDEMPOTENCY_GATE_NOT_PASSED"));
});

test("fails closed without exact contract binding", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, exactContractBound: false });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("EXACT_CONTRACT_NOT_BOUND"));
});

test("fails closed without durable evidence confirmation", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, evidencePersistenceConfirmed: false });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("EVIDENCE_PERSISTENCE_NOT_CONFIRMED"));
});

test("fails closed without broker session readiness", () => {
  const result = authorizeBrokerExecution({ ...readyShadowInput, brokerSessionReady: false });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("BROKER_SESSION_NOT_READY"));
});

test("collects multiple blockers and never places an order", () => {
  const result = authorizeBrokerExecution({
    ...readyShadowInput,
    orderBuildDecision: "BLOCK",
    executionRiskDecision: "BLOCK",
    exactContractBound: false,
    evidencePersistenceConfirmed: false,
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.placesOrder, false);
  assert.ok(result.reasonCodes.length >= 4);
});
