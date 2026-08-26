import test from "node:test";
import assert from "node:assert/strict";
import { buildPhase53PreflightReport, PHASE53_SAFETY } from "../phase53-shadow-preflight.js";
import { buildPhase51ShadowReadinessReport } from "../phase51-shadow-readiness.js";

const disabledReadiness = buildPhase51ShadowReadinessReport([], false);

test("healthy preflight stays prepared but does not activate shadow", () => {
  const report = buildPhase53PreflightReport({
    databaseConfigured: true,
    databaseReachable: true,
    scoreObservationTableExists: true,
    error: null,
  }, disabledReadiness, false);
  assert.equal(report.status, "PREPARED_NOT_ACTIVATED");
  assert.equal(report.shadowFlagEnabled, false);
  assert.equal(report.automaticActivationAllowed, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.requiredActivationAction, "MANUAL_ENV_CHANGE_AND_REDEPLOY");
});

test("missing score table is visible but not a hard pre-activation blocker because schema is lazy-created", () => {
  const report = buildPhase53PreflightReport({
    databaseConfigured: true,
    databaseReachable: true,
    scoreObservationTableExists: false,
    error: null,
  }, disabledReadiness, false);
  assert.equal(report.status, "PREPARED_NOT_ACTIVATED");
  assert.ok(report.blockers.includes("SCORE_OBSERVATION_TABLE_NOT_YET_PRESENT"));
});

test("missing or unreachable database blocks activation readiness", () => {
  const missing = buildPhase53PreflightReport({
    databaseConfigured: false, databaseReachable: false, scoreObservationTableExists: false, error: "DATABASE_URL_NOT_CONFIGURED",
  }, disabledReadiness, false);
  assert.equal(missing.status, "BLOCKED");
  assert.ok(missing.blockers.includes("DATABASE_URL_NOT_CONFIGURED"));

  const down = buildPhase53PreflightReport({
    databaseConfigured: true, databaseReachable: false, scoreObservationTableExists: false, error: "DATABASE_PROBE_FAILED",
  }, disabledReadiness, false);
  assert.equal(down.status, "BLOCKED");
  assert.ok(down.blockers.includes("DATABASE_NOT_REACHABLE"));
});

test("already enabled flag never masquerades as preflight approval", () => {
  const report = buildPhase53PreflightReport({
    databaseConfigured: true, databaseReachable: true, scoreObservationTableExists: true, error: null,
  }, buildPhase51ShadowReadinessReport([], true), true);
  assert.equal(report.status, "ALREADY_ENABLED_REQUIRES_OPERATOR_REVIEW");
  assert.equal(report.automaticActivationAllowed, false);
  assert.equal(report.productionReady, false);
});

test("rollback preserves known-then evidence rather than deleting it", () => {
  const report = buildPhase53PreflightReport({
    databaseConfigured: true, databaseReachable: true, scoreObservationTableExists: true, error: null,
  }, disabledReadiness, false);
  assert.ok(report.rollbackChecklist.some((x) => /do not delete/i.test(x)));
  assert.equal(PHASE53_SAFETY.deletesKnownThenEvidenceOnRollback, false);
});

test("Phase 53 safety cannot change trading behavior or self-activate", () => {
  assert.deepEqual(PHASE53_SAFETY, {
    mutatesShadowFlag: false,
    automaticActivationAllowed: false,
    productionReady: false,
    writesTradingState: false,
    affectsProductionScore: false,
    affectsVerdict: false,
    affectsTelegramTradeDecision: false,
    affectsExecution: false,
    addsBrokerRequest: false,
    deletesKnownThenEvidenceOnRollback: false,
  });
});
