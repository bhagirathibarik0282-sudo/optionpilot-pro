import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase56Report } from "../phase56-shadow-evidence-consolidation.js";
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

test("Phase 56 fails closed when evidence is incomplete", () => {
  const report = buildPhase56Report({
    validation: { sessions: [], scenarios: [], productionBehaviorChanged: false, automaticPromotionOccurred: false },
    phase54Evidence: [],
  });
  assert.equal(report.status, "NOT_READY");
  assert.equal(report.productionReady, false);
  assert.equal(report.automaticPromotionAllowed, false);
  assert.ok(report.blockers.length > 0);
});

test("Phase 56 becomes gate-ready only with complete valid evidence", () => {
  const report = buildPhase56Report({
    validation: { sessions, scenarios, productionBehaviorChanged: false, automaticPromotionOccurred: false },
    phase54Evidence,
  });
  assert.equal(report.status, "READY_FOR_PRODUCTION_READINESS_GATE");
  assert.equal(report.validPhase54ScenarioCount, PHASE52_FAILURE_MATRIX.length);
  assert.deepEqual(report.missingOrInvalidScenarios, []);
  assert.equal(report.productionReady, false);
});
