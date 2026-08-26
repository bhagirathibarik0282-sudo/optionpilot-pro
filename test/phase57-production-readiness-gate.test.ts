import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase57Report } from "../phase57-production-readiness-gate.js";
import { PHASE52_FAILURE_MATRIX } from "../phase52-live-shadow-validation.js";

const sessions = [
  { sessionId: "S1", tradeDate: "2026-08-25", evidenceRefs: ["e1"] },
  { sessionId: "S2", tradeDate: "2026-08-26", evidenceRefs: ["e2"] },
];
const scenarios = PHASE52_FAILURE_MATRIX.map((x) => ({ id: x.id, passed: true, evidenceRefs: [`p52:${x.id}`] }));
const phase54Evidence = PHASE52_FAILURE_MATRIX.map((x) => ({
  scenarioId: x.id,
  executionMode:
    x.id === "NORMAL_LIVE_SESSION" || x.id === "PROCESS_RESTART" ? "LIVE_SHADOW_SAFE" as const :
    x.id === "STALE_QUOTE" || x.id === "MISSING_QUOTE" || x.id === "TOKEN_IDENTITY_MISMATCH" || x.id === "DB_WRITE_FAILURE" ? "ISOLATED_SHADOW_INJECTION" as const :
    x.id === "SHADOW_FLAG_OFF" ? "PRE_OR_POST_SESSION_CONTROL" as const : "REPLAY_OR_FIXTURE" as const,
  executedAt: "2026-08-26T10:00:00.000Z",
  operator: "operator",
  passed: true,
  evidenceRefs: [`p54:${x.id}`],
  productionBehaviorChanged: false,
  liveProductionMutationOccurred: false,
}));

const completePhase56 = {
  validation: { sessions, scenarios, productionBehaviorChanged: false, automaticPromotionOccurred: false },
  phase54Evidence,
};

test("Phase 57 fails closed when prior evidence is incomplete", () => {
  const report = buildPhase57Report({
    phase56: { validation: { sessions: [], scenarios: [], productionBehaviorChanged: false, automaticPromotionOccurred: false }, phase54Evidence: [] },
    finalDevilAuditPassed: true,
    productionBehaviorChanged: false,
    unresolvedCriticalRiskCount: 0,
  });
  assert.equal(report.status, "NOT_READY");
  assert.equal(report.productionReady, false);
  assert.equal(report.automaticDeploymentAllowed, false);
});

test("Phase 57 blocks on failed audit, production change, or critical risk", () => {
  const report = buildPhase57Report({
    phase56: completePhase56,
    finalDevilAuditPassed: false,
    productionBehaviorChanged: true,
    unresolvedCriticalRiskCount: 1,
  });
  assert.equal(report.status, "NOT_READY");
  assert.ok(report.blockers.includes("FINAL_DEVIL_AUDIT_NOT_PASSED"));
  assert.ok(report.blockers.includes("PRODUCTION_BEHAVIOR_CHANGED_DURING_SHADOW_VALIDATION"));
  assert.ok(report.blockers.includes("UNRESOLVED_CRITICAL_RISKS_PRESENT"));
});

test("Phase 57 can only become ready for manual review", () => {
  const report = buildPhase57Report({
    phase56: completePhase56,
    finalDevilAuditPassed: true,
    productionBehaviorChanged: false,
    unresolvedCriticalRiskCount: 0,
  });
  assert.equal(report.status, "READY_FOR_MANUAL_REVIEW");
  assert.equal(report.manualReviewRequired, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.automaticPromotionAllowed, false);
  assert.equal(report.automaticDeploymentAllowed, false);
});
