export const PHASE52_VALIDATION_VERSION = "PHASE52_LIVE_SHADOW_VALIDATION_V1" as const;

export type Phase52ScenarioId =
  | "NORMAL_LIVE_SESSION"
  | "PROCESS_RESTART"
  | "STALE_QUOTE"
  | "MISSING_QUOTE"
  | "TOKEN_IDENTITY_MISMATCH"
  | "EXPIRY_ROLL"
  | "DB_WRITE_FAILURE"
  | "UNKNOWN_MAX_PAIN"
  | "DUPLICATE_OBSERVATION"
  | "SHADOW_FLAG_OFF";

export interface Phase52ScenarioDefinition {
  id: Phase52ScenarioId;
  mandatory: true;
  expected: readonly string[];
}

export const PHASE52_FAILURE_MATRIX: readonly Phase52ScenarioDefinition[] = Object.freeze([
  { id: "NORMAL_LIVE_SESSION", mandatory: true, expected: ["append-only KNOWN_THEN evidence is observable", "production behavior unchanged"] },
  { id: "PROCESS_RESTART", mandatory: true, expected: ["restart does not rewrite prior evidence", "post-restart evidence remains distinguishable"] },
  { id: "STALE_QUOTE", mandatory: true, expected: ["stale evidence is not promoted as usable", "failure remains observable"] },
  { id: "MISSING_QUOTE", mandatory: true, expected: ["missing evidence remains UNKNOWN/BLOCKED", "no neutral-value substitution"] },
  { id: "TOKEN_IDENTITY_MISMATCH", mandatory: true, expected: ["identity mismatch is quarantined", "no production promotion"] },
  { id: "EXPIRY_ROLL", mandatory: true, expected: ["contract identity follows exact expiry", "old/new expiry observations are not conflated"] },
  { id: "DB_WRITE_FAILURE", mandatory: true, expected: ["persistence failure cannot masquerade as success", "core trading path is not broken by shadow failure"] },
  { id: "UNKNOWN_MAX_PAIN", mandatory: true, expected: ["UNKNOWN remains UNKNOWN", "row is excluded from Max Pain impact denominator"] },
  { id: "DUPLICATE_OBSERVATION", mandatory: true, expected: ["stable observation id is idempotent", "duplicate does not create false extra evidence"] },
  { id: "SHADOW_FLAG_OFF", mandatory: true, expected: ["no Phase50 score row is persisted", "readiness remains observational and production unchanged"] },
]);

export interface Phase52ScenarioResult {
  id: Phase52ScenarioId;
  passed: boolean;
  evidenceRefs: string[];
  notes?: string[];
}

export interface Phase52SessionEvidence {
  sessionId: string;
  tradeDate: string;
  evidenceRefs: string[];
}

export interface Phase52ValidationInput {
  sessions: Phase52SessionEvidence[];
  scenarios: Phase52ScenarioResult[];
  productionBehaviorChanged: boolean;
  automaticPromotionOccurred: boolean;
}

export interface Phase52ValidationReport {
  version: typeof PHASE52_VALIDATION_VERSION;
  architectureRole: "SHADOW_VALIDATION_PROTOCOL_ONLY";
  productionImpact: "NONE";
  status: "NOT_READY" | "ELIGIBLE_FOR_FINAL_DEVIL_AUDIT";
  distinctSessionCount: number;
  multiSessionCoverage: boolean;
  mandatoryScenarioCount: number;
  passedMandatoryScenarioCount: number;
  missingScenarios: Phase52ScenarioId[];
  failedScenarios: Phase52ScenarioId[];
  evidenceMissingScenarios: Phase52ScenarioId[];
  blockers: string[];
  automaticProductionPromotionAllowed: false;
  productionReady: false;
}

export function evaluatePhase52Validation(input: Phase52ValidationInput): Phase52ValidationReport {
  const sessions = input.sessions.filter((s) => s.sessionId && s.tradeDate && s.evidenceRefs.length > 0);
  const distinctSessionCount = new Set(sessions.map((s) => s.sessionId)).size;
  const multiSessionCoverage = distinctSessionCount >= 2;
  const byId = new Map(input.scenarios.map((s) => [s.id, s] as const));
  const missingScenarios: Phase52ScenarioId[] = [];
  const failedScenarios: Phase52ScenarioId[] = [];
  const evidenceMissingScenarios: Phase52ScenarioId[] = [];
  let passedMandatoryScenarioCount = 0;

  for (const def of PHASE52_FAILURE_MATRIX) {
    const result = byId.get(def.id);
    if (!result) { missingScenarios.push(def.id); continue; }
    if (!result.evidenceRefs.length) evidenceMissingScenarios.push(def.id);
    if (!result.passed) failedScenarios.push(def.id);
    if (result.passed && result.evidenceRefs.length) passedMandatoryScenarioCount++;
  }

  const blockers: string[] = [];
  if (!multiSessionCoverage) blockers.push("MULTI_SESSION_LIVE_EVIDENCE_NOT_PROVEN");
  if (missingScenarios.length) blockers.push("MANDATORY_SCENARIOS_MISSING");
  if (failedScenarios.length) blockers.push("MANDATORY_SCENARIOS_FAILED");
  if (evidenceMissingScenarios.length) blockers.push("SCENARIO_EVIDENCE_REFERENCES_MISSING");
  if (input.productionBehaviorChanged) blockers.push("SHADOW_VALIDATION_CHANGED_PRODUCTION_BEHAVIOR");
  if (input.automaticPromotionOccurred) blockers.push("AUTOMATIC_PROMOTION_FORBIDDEN");

  return {
    version: PHASE52_VALIDATION_VERSION,
    architectureRole: "SHADOW_VALIDATION_PROTOCOL_ONLY",
    productionImpact: "NONE",
    status: blockers.length ? "NOT_READY" : "ELIGIBLE_FOR_FINAL_DEVIL_AUDIT",
    distinctSessionCount,
    multiSessionCoverage,
    mandatoryScenarioCount: PHASE52_FAILURE_MATRIX.length,
    passedMandatoryScenarioCount,
    missingScenarios,
    failedScenarios,
    evidenceMissingScenarios,
    blockers,
    automaticProductionPromotionAllowed: false,
    productionReady: false,
  };
}

export const PHASE52_SAFETY = Object.freeze({
  changesProductionBehavior: false,
  automaticPromotionAllowed: false,
  productionReady: false,
  inventsEmpiricalThresholds: false,
  requiresKnownThenEvidence: true,
  requiresMultiSessionEvidence: true,
  requiresFailureInjectionEvidence: true,
});
