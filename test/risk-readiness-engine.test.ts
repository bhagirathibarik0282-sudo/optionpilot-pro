import test from "node:test";
import assert from "node:assert/strict";
import { assessRiskReadiness } from "../risk-readiness-engine.js";

const base = {
  strategyStatus: "READY_FOR_RESEARCH" as const,
  entry: 100,
  stop: 80,
  quantity: 10,
  capital: 50000,
  maxAllowedPlannedStopLossPct: 2,
};

test("fails closed when strategy is not research-ready", () => {
  const result = assessRiskReadiness({ ...base, strategyStatus: "NOT_READY" });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "STRATEGY_NOT_READY");
});

test("invalid or inverted entry-stop identity is rejected", () => {
  assert.equal(assessRiskReadiness({ ...base, entry: null }).reason, "ENTRY_INVALID");
  assert.equal(assessRiskReadiness({ ...base, stop: 100 }).reason, "STOP_NOT_BELOW_ENTRY_FOR_LONG_PREMIUM");
});

test("invalid quantity capital and caller risk limit fail closed", () => {
  assert.equal(assessRiskReadiness({ ...base, quantity: 1.5 }).reason, "QUANTITY_INVALID");
  assert.equal(assessRiskReadiness({ ...base, capital: 0 }).reason, "CAPITAL_INVALID");
  assert.equal(assessRiskReadiness({ ...base, maxAllowedPlannedStopLossPct: 0 }).reason, "RISK_LIMIT_INVALID");
});

test("calculates deterministic planned stop loss against caller-supplied limit", () => {
  const result = assessRiskReadiness(base);
  assert.equal(result.status, "READY_FOR_RESEARCH");
  assert.equal(result.riskPerUnit, 20);
  assert.equal(result.plannedStopLossAmount, 200);
  assert.equal(result.plannedStopLossPct, 0.4);
});

test("blocks when planned stop loss exceeds caller-supplied limit", () => {
  const result = assessRiskReadiness({ ...base, quantity: 100, maxAllowedPlannedStopLossPct: 2 });
  assert.equal(result.status, "NOT_READY");
  assert.equal(result.reason, "CALLER_RISK_LIMIT_EXCEEDED");
  assert.equal(result.plannedStopLossPct, 4);
});

test("foundation never calls planned stop risk a guaranteed maximum loss or gains live authority", () => {
  const result = assessRiskReadiness(base);
  assert.equal("maxLossAmount" in result, false);
  assert.equal("maxLossPct" in result, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.ruleVersion, "RISK_READINESS_ENGINE_V1");
});
