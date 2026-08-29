import test from "node:test";
import assert from "node:assert/strict";
import { assessDecisionReadiness } from "../decision-readiness-engine.js";

const base = {
  probabilityStatus: "READY" as const,
  regime: "TRENDING_UP" as const,
  strategyStatus: "READY_FOR_RESEARCH" as const,
  riskStatus: "READY_FOR_RESEARCH" as const,
  evidenceFresh: true,
  signalIdentityReady: true,
};

test("fails closed when evidence is stale", () => {
  const result = assessDecisionReadiness({ ...base, evidenceFresh: false });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "EVIDENCE_NOT_FRESH");
});

test("fails closed when signal identity is unavailable", () => {
  const result = assessDecisionReadiness({ ...base, signalIdentityReady: false });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "SIGNAL_IDENTITY_NOT_READY");
});

test("requires historical support and a stable regime", () => {
  assert.equal(assessDecisionReadiness({ ...base, probabilityStatus: "DATA_UNAVAILABLE" }).reason, "HISTORICAL_SUPPORT_UNAVAILABLE");
  assert.equal(assessDecisionReadiness({ ...base, regime: "UNKNOWN" }).reason, "REGIME_NOT_STABLE");
  assert.equal(assessDecisionReadiness({ ...base, regime: "TRANSITION" }).reason, "REGIME_NOT_STABLE");
});

test("requires strategy and risk readiness", () => {
  assert.equal(assessDecisionReadiness({ ...base, strategyStatus: "NOT_READY" }).reason, "STRATEGY_NOT_READY");
  assert.equal(assessDecisionReadiness({ ...base, riskStatus: "NOT_READY" }).reason, "RISK_NOT_READY");
});

test("all prerequisites can become ready for research review only", () => {
  const result = assessDecisionReadiness(base);
  assert.equal(result.status, "READY_FOR_RESEARCH_REVIEW");
  assert.equal(result.reason, "ALL_RESEARCH_PREREQUISITES_PRESENT");
});

test("foundation never gains live authority", () => {
  const result = assessDecisionReadiness(base);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.ruleVersion, "DECISION_READINESS_ENGINE_V1");
});
