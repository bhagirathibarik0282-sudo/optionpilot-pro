import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASE54_PLAYBOOK,
  PHASE54_SAFETY,
  buildPhase54PreparationReport,
  getPhase54Scenario,
  validatePhase54Evidence,
} from "../phase54-failure-injection-playbook.js";
import { PHASE52_FAILURE_MATRIX } from "../phase52-live-shadow-validation.js";

test("Phase 54 covers every Phase 52 mandatory scenario exactly once", () => {
  assert.equal(PHASE54_PLAYBOOK.length, PHASE52_FAILURE_MATRIX.length);
  assert.deepEqual(new Set(PHASE54_PLAYBOOK.map(x => x.id)), new Set(PHASE52_FAILURE_MATRIX.map(x => x.id)));
  assert.equal(buildPhase54PreparationReport().allPhase52ScenariosCovered, true);
});

test("dangerous failure injections never require live production mutation", () => {
  for (const id of ["STALE_QUOTE","MISSING_QUOTE","TOKEN_IDENTITY_MISMATCH","DB_WRITE_FAILURE"] as const) {
    const def = getPhase54Scenario(id)!;
    assert.equal(def.liveProductionMutationForbidden, true);
    assert.notEqual(def.executionMode, "LIVE_SHADOW_SAFE");
  }
});

test("DB failure playbook explicitly protects production DATABASE_URL", () => {
  const def = getPhase54Scenario("DB_WRITE_FAILURE")!;
  assert.ok(def.prerequisites.some(x => /production DATABASE_URL untouched/i.test(x)));
  assert.ok(def.abortConditions.some(x => /production database/i.test(x)));
});

test("token mismatch playbook forbids changing live credentials/token map", () => {
  const def = getPhase54Scenario("TOKEN_IDENTITY_MISMATCH")!;
  assert.ok(def.abortConditions.some(x => /live Kite\/Dhan credentials|production token map/i.test(x)));
});

test("valid evidence requires refs, operator, correct mode, PASS and production isolation", () => {
  const result = validatePhase54Evidence({
    scenarioId: "PROCESS_RESTART",
    executionMode: "LIVE_SHADOW_SAFE",
    executedAt: "2026-08-27T04:30:00.000Z",
    operator: "OWNER",
    passed: true,
    evidenceRefs: ["session:1", "deployment:abc"],
    productionBehaviorChanged: false,
    liveProductionMutationOccurred: false,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
});

test("bad evidence fails closed", () => {
  const result = validatePhase54Evidence({
    scenarioId: "DB_WRITE_FAILURE",
    executionMode: "LIVE_SHADOW_SAFE",
    executedAt: "bad",
    operator: "",
    passed: false,
    evidenceRefs: [],
    productionBehaviorChanged: true,
    liveProductionMutationOccurred: true,
  });
  assert.equal(result.valid, false);
  for (const blocker of [
    "INVALID_EXECUTION_TIME","OPERATOR_NOT_RECORDED","EVIDENCE_REFERENCES_MISSING",
    "EXECUTION_MODE_MISMATCH","PRODUCTION_BEHAVIOR_CHANGED","LIVE_PRODUCTION_MUTATION_FORBIDDEN","SCENARIO_NOT_PASSED"
  ]) assert.ok(result.blockers.includes(blocker));
});

test("Phase 54 preparation has no production authority", () => {
  assert.deepEqual(PHASE54_SAFETY, {
    preparationOnly:true,
    automaticFailureInjectionAllowed:false,
    modifiesLiveBrokerCredentials:false,
    disablesProductionDatabaseForTesting:false,
    mutatesProductionMarketData:false,
    affectsProductionScore:false,
    affectsVerdict:false,
    affectsTelegramTradeDecision:false,
    affectsExecution:false,
    productionReady:false,
  });
});
