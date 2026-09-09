import test from "node:test";
import assert from "node:assert/strict";
import { bindH1SelectToShadowExecution } from "../h1-select-shadow-execution-binding.js";

const SELECT = {
  symbol: "SENSEX",
  expiry: "2026-09-10",
  strike: 75100,
  side: "CE" as const,
  decision: "SELECT" as const,
  reasonCodes: [],
};

const PASSING_EVIDENCE = {
  orderBuildDecision: "BUILD" as const,
  executionRiskDecision: "ALLOW" as const,
  killSwitchDecision: "ALLOW" as const,
  idempotencyDecision: "ALLOW" as const,
  exactContractBound: true,
  evidencePersistenceConfirmed: true,
  brokerSessionReady: true,
};

test("SELECT with complete evidence authorizes simulation only", () => {
  const result = bindH1SelectToShadowExecution({ selectorDecision: SELECT, authorizationEvidence: PASSING_EVIDENCE });
  assert.equal(result.candidateKey, "SENSEX|2026-09-10|75100|CE");
  assert.equal(result.authorization.decision, "AUTHORIZE_SIMULATION");
  assert.equal(result.authorization.placesOrder, false);
  assert.equal(result.placesOrder, false);
});

test("BLOCK never reaches authorization even with otherwise passing evidence", () => {
  const result = bindH1SelectToShadowExecution({
    selectorDecision: { ...SELECT, decision: "BLOCK", reasonCodes: ["TEST_BLOCK"] },
    authorizationEvidence: PASSING_EVIDENCE,
  });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.deepEqual(result.authorization.reasonCodes, ["SELECTOR_DECISION_NOT_SELECT"]);
  assert.equal(result.placesOrder, false);
});

test("SELECT fails closed when execution evidence is incomplete", () => {
  const result = bindH1SelectToShadowExecution({
    selectorDecision: SELECT,
    authorizationEvidence: { ...PASSING_EVIDENCE, brokerSessionReady: false },
  });
  assert.equal(result.authorization.decision, "BLOCK");
  assert.ok(result.authorization.reasonCodes.includes("BROKER_SESSION_NOT_READY"));
  assert.equal(result.placesOrder, false);
});
