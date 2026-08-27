import test from "node:test";
import assert from "node:assert/strict";
import { PHASE52_FAILURE_MATRIX, PHASE52_SAFETY, evaluatePhase52Validation, type Phase52ScenarioResult } from "../phase52-live-shadow-validation.js";

function passingScenarios(): Phase52ScenarioResult[] {
  return PHASE52_FAILURE_MATRIX.map((s) => ({ id: s.id, passed: true, evidenceRefs: [`evidence:${s.id}`] }));
}

test("Phase 52 requires every mandatory failure scenario with evidence", () => {
  const scenarios = passingScenarios();
  scenarios.find((s) => s.id === "STALE_QUOTE")!.evidenceRefs = [];
  scenarios.find((s) => s.id === "DB_WRITE_FAILURE")!.passed = false;
  const report = evaluatePhase52Validation({
    sessions: [
      { sessionId: "2026-08-25-A", tradeDate: "2026-08-25", evidenceRefs: ["session:a"] },
      { sessionId: "2026-08-26-A", tradeDate: "2026-08-26", evidenceRefs: ["session:b"] },
    ],
    scenarios,
    productionBehaviorChanged: false,
    automaticPromotionOccurred: false,
  });
  assert.equal(report.status, "NOT_READY");
  assert.deepEqual(report.evidenceMissingScenarios, ["STALE_QUOTE"]);
  assert.deepEqual(report.failedScenarios, ["DB_WRITE_FAILURE"]);
  assert.ok(report.blockers.includes("SCENARIO_EVIDENCE_REFERENCES_MISSING"));
  assert.ok(report.blockers.includes("MANDATORY_SCENARIOS_FAILED"));
});

test("Phase 52 interprets multi-session literally without inventing a statistical threshold", () => {
  const one = evaluatePhase52Validation({
    sessions: [{ sessionId: "s1", tradeDate: "2026-08-26", evidenceRefs: ["e1"] }],
    scenarios: passingScenarios(), productionBehaviorChanged: false, automaticPromotionOccurred: false,
  });
  assert.equal(one.multiSessionCoverage, false);
  assert.equal(one.status, "NOT_READY");

  const two = evaluatePhase52Validation({
    sessions: [
      { sessionId: "s1", tradeDate: "2026-08-25", evidenceRefs: ["e1"] },
      { sessionId: "s2", tradeDate: "2026-08-26", evidenceRefs: ["e2"] },
    ],
    scenarios: passingScenarios(), productionBehaviorChanged: false, automaticPromotionOccurred: false,
  });
  assert.equal(two.multiSessionCoverage, true);
  assert.equal(two.status, "ELIGIBLE_FOR_FINAL_DEVIL_AUDIT");
  assert.equal(two.productionReady, false, "Phase 52 may never declare production ready");
});

test("Phase 52 fails closed on any production behavior change or automatic promotion", () => {
  const base = {
    sessions: [
      { sessionId: "s1", tradeDate: "2026-08-25", evidenceRefs: ["e1"] },
      { sessionId: "s2", tradeDate: "2026-08-26", evidenceRefs: ["e2"] },
    ],
    scenarios: passingScenarios(),
  };
  const changed = evaluatePhase52Validation({ ...base, productionBehaviorChanged: true, automaticPromotionOccurred: false });
  assert.ok(changed.blockers.includes("SHADOW_VALIDATION_CHANGED_PRODUCTION_BEHAVIOR"));
  const promoted = evaluatePhase52Validation({ ...base, productionBehaviorChanged: false, automaticPromotionOccurred: true });
  assert.ok(promoted.blockers.includes("AUTOMATIC_PROMOTION_FORBIDDEN"));
});

test("Phase 52 matrix covers required failure families and safety stays research-only", () => {
  const ids = new Set(PHASE52_FAILURE_MATRIX.map((x) => x.id));
  for (const id of ["PROCESS_RESTART","STALE_QUOTE","MISSING_QUOTE","TOKEN_IDENTITY_MISMATCH","EXPIRY_ROLL","DB_WRITE_FAILURE","UNKNOWN_MAX_PAIN","DUPLICATE_OBSERVATION","SHADOW_FLAG_OFF"]) assert.ok(ids.has(id as any));
  assert.equal(PHASE52_SAFETY.changesProductionBehavior, false);
  assert.equal(PHASE52_SAFETY.automaticPromotionAllowed, false);
  assert.equal(PHASE52_SAFETY.productionReady, false);
  assert.equal(PHASE52_SAFETY.inventsEmpiricalThresholds, false);
});
