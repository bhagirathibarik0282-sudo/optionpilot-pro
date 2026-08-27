import { PHASE52_FAILURE_MATRIX, type Phase52ScenarioId } from "./phase52-live-shadow-validation.js";

export const PHASE54_PLAYBOOK_VERSION = "PHASE54_FAILURE_INJECTION_PLAYBOOK_V1" as const;

export type Phase54ExecutionMode =
  | "LIVE_SHADOW_SAFE"
  | "ISOLATED_SHADOW_INJECTION"
  | "REPLAY_OR_FIXTURE"
  | "PRE_OR_POST_SESSION_CONTROL";

export interface Phase54ScenarioPlaybook {
  id: Phase52ScenarioId;
  executionMode: Phase54ExecutionMode;
  liveProductionMutationForbidden: boolean;
  prerequisites: readonly string[];
  steps: readonly string[];
  passCriteria: readonly string[];
  abortConditions: readonly string[];
  evidenceRequired: readonly string[];
}

export const PHASE54_PLAYBOOK: readonly Phase54ScenarioPlaybook[] = Object.freeze([
  {
    id: "NORMAL_LIVE_SESSION",
    executionMode: "LIVE_SHADOW_SAFE",
    liveProductionMutationForbidden: true,
    prerequisites: ["Phase 53 preflight PASS", "explicit shadow activation approval", "production baseline recorded"],
    steps: ["observe one live shadow session", "capture readiness snapshots", "record KNOWN_THEN row growth", "compare production outputs to baseline"],
    passCriteria: ["append-only evidence grows", "production score/verdict/Telegram/execution unchanged"],
    abortConditions: ["production behavior changes", "unexplained DB errors", "identity/freshness safety regression"],
    evidenceRequired: ["session id", "trade date", "deployment id", "readiness snapshots", "row counts", "production-isolation proof"],
  },
  {
    id: "PROCESS_RESTART",
    executionMode: "LIVE_SHADOW_SAFE",
    liveProductionMutationForbidden: true,
    prerequisites: ["shadow collection observing", "pre-restart observation ids recorded"],
    steps: ["record last pre-restart observation", "perform one controlled service restart", "record first post-restart observation", "verify previous evidence remains queryable"],
    passCriteria: ["prior evidence preserved", "post-restart evidence distinguishable", "no duplicate inflation"],
    abortConditions: ["production output changes unexpectedly", "restart causes data loss", "recovery requires evidence deletion"],
    evidenceRequired: ["pre/post deployment ids", "pre/post observation ids", "timestamps", "row counts"],
  },
  {
    id: "STALE_QUOTE",
    executionMode: "ISOLATED_SHADOW_INJECTION",
    liveProductionMutationForbidden: true,
    prerequisites: ["test/replay harness available", "known fresh fixture baseline"],
    steps: ["clone fixture", "age source timestamp beyond configured freshness policy", "evaluate source truth", "record blocked result"],
    passCriteria: ["stale evidence is not USABLE", "reason remains observable"],
    abortConditions: ["requires changing live broker quote", "stale row reaches production decision path"],
    evidenceRequired: ["fixture id", "original/injected timestamps", "freshness result", "reason codes"],
  },
  {
    id: "MISSING_QUOTE",
    executionMode: "ISOLATED_SHADOW_INJECTION",
    liveProductionMutationForbidden: true,
    prerequisites: ["test/replay harness available"],
    steps: ["remove one required quote from fixture", "evaluate chain/source truth", "record metric availability"],
    passCriteria: ["dependent evidence becomes UNKNOWN/BLOCKED", "no zero substitution"],
    abortConditions: ["requires suppressing a live broker response", "missing value is coerced to neutral/zero"],
    evidenceRequired: ["fixture id", "missing contract identity", "truth state", "derived null/blocked proof"],
  },
  {
    id: "TOKEN_IDENTITY_MISMATCH",
    executionMode: "ISOLATED_SHADOW_INJECTION",
    liveProductionMutationForbidden: true,
    prerequisites: ["synthetic instrument-master fixture available"],
    steps: ["alter expected token or trading symbol in fixture", "run identity audit", "record quarantine result"],
    passCriteria: ["identity state becomes MISMATCH/BLOCKED", "no promotion"],
    abortConditions: ["requires changing live Kite/Dhan credentials or production token map", "mismatched evidence reaches live verdict"],
    evidenceRequired: ["expected identity", "injected identity", "reason codes", "usability state"],
  },
  {
    id: "EXPIRY_ROLL",
    executionMode: "REPLAY_OR_FIXTURE",
    liveProductionMutationForbidden: true,
    prerequisites: ["two exact-expiry observations or replay fixtures"],
    steps: ["load old-expiry observation", "load new-expiry observation", "run compatibility/reconstruction guards", "verify no cross-expiry bridge"],
    passCriteria: ["old/new expiry remain distinct", "previous-state delta does not cross incompatible expiry"],
    abortConditions: ["test requires forcing live expiry selection", "cross-expiry state is silently reused"],
    evidenceRequired: ["old/new expiry", "contract ids", "compatibility result", "reconstruction reason"],
  },
  {
    id: "DB_WRITE_FAILURE",
    executionMode: "ISOLATED_SHADOW_INJECTION",
    liveProductionMutationForbidden: true,
    prerequisites: ["stubbed/isolated DB failure path", "production DATABASE_URL untouched"],
    steps: ["force shadow persistence call to fail in isolated harness", "observe returned persistence status", "verify core decision path remains callable"],
    passCriteria: ["write failure cannot masquerade as success", "core trading path is unaffected"],
    abortConditions: ["requires disabling production database", "failure blocks production trading path"],
    evidenceRequired: ["fault id", "persistence result", "error log reference", "production-isolation proof"],
  },
  {
    id: "UNKNOWN_MAX_PAIN",
    executionMode: "REPLAY_OR_FIXTURE",
    liveProductionMutationForbidden: true,
    prerequisites: ["KNOWN_THEN fixture with missing/invalid Max Pain contribution"],
    steps: ["evaluate score observation", "run counterfactual replay", "inspect denominator"],
    passCriteria: ["Max Pain contribution remains null/UNKNOWN", "row excluded from impact denominator"],
    abortConditions: ["UNKNOWN converted to zero", "counterfactual impact rate includes unknown row"],
    evidenceRequired: ["observation id", "stored contribution", "replay exclusion proof"],
  },
  {
    id: "DUPLICATE_OBSERVATION",
    executionMode: "REPLAY_OR_FIXTURE",
    liveProductionMutationForbidden: true,
    prerequisites: ["stable known observation fixture"],
    steps: ["submit identical observation identity twice to isolated persistence test", "inspect stable id and row-count semantics"],
    passCriteria: ["same observation id", "duplicate does not inflate evidence"],
    abortConditions: ["test writes uncontrolled duplicate live rows", "duplicate receives a different identity"],
    evidenceRequired: ["first/second observation ids", "row-count proof", "idempotency result"],
  },
  {
    id: "SHADOW_FLAG_OFF",
    executionMode: "PRE_OR_POST_SESSION_CONTROL",
    liveProductionMutationForbidden: true,
    prerequisites: ["PHASE50_SCORE_SHADOW=false"],
    steps: ["verify preflight/readiness while OFF", "send normal diagnostic flow", "confirm no Phase50 score row is added"],
    passCriteria: ["collection state DISABLED", "no new Phase50 persistence", "production unchanged"],
    abortConditions: ["flag changes without explicit operator action", "OFF state still persists score rows"],
    evidenceRequired: ["flag state", "before/after row count", "readiness response", "deployment id"],
  },
]);

export interface Phase54EvidenceRecord {
  scenarioId: Phase52ScenarioId;
  executionMode: Phase54ExecutionMode;
  executedAt: string;
  operator: string;
  passed: boolean;
  evidenceRefs: string[];
  productionBehaviorChanged: boolean;
  liveProductionMutationOccurred: boolean;
  notes?: string[];
}

export interface Phase54EvidenceValidation {
  valid: boolean;
  blockers: string[];
}

export function getPhase54Scenario(id: Phase52ScenarioId): Phase54ScenarioPlaybook | null {
  return PHASE54_PLAYBOOK.find((x) => x.id === id) ?? null;
}

export function validatePhase54Evidence(record: Phase54EvidenceRecord): Phase54EvidenceValidation {
  const blockers: string[] = [];
  const def = getPhase54Scenario(record.scenarioId);
  if (!def) blockers.push("SCENARIO_NOT_IN_PLAYBOOK");
  if (!Number.isFinite(Date.parse(record.executedAt))) blockers.push("INVALID_EXECUTION_TIME");
  if (!record.operator?.trim()) blockers.push("OPERATOR_NOT_RECORDED");
  if (!record.evidenceRefs?.length) blockers.push("EVIDENCE_REFERENCES_MISSING");
  if (def && record.executionMode !== def.executionMode) blockers.push("EXECUTION_MODE_MISMATCH");
  if (record.productionBehaviorChanged) blockers.push("PRODUCTION_BEHAVIOR_CHANGED");
  if (record.liveProductionMutationOccurred) blockers.push("LIVE_PRODUCTION_MUTATION_FORBIDDEN");
  if (!record.passed) blockers.push("SCENARIO_NOT_PASSED");
  return { valid: blockers.length === 0, blockers };
}

export function buildPhase54PreparationReport() {
  return {
    version: PHASE54_PLAYBOOK_VERSION,
    architectureRole: "FAILURE_INJECTION_PREPARATION_ONLY" as const,
    productionImpact: "NONE" as const,
    scenarioCount: PHASE54_PLAYBOOK.length,
    phase52ScenarioCount: PHASE52_FAILURE_MATRIX.length,
    allPhase52ScenariosCovered: PHASE52_FAILURE_MATRIX.every((x) => Boolean(getPhase54Scenario(x.id))),
    liveSafeScenarios: PHASE54_PLAYBOOK.filter((x) => x.executionMode === "LIVE_SHADOW_SAFE").map((x) => x.id),
    isolatedScenarios: PHASE54_PLAYBOOK.filter((x) => x.executionMode === "ISOLATED_SHADOW_INJECTION").map((x) => x.id),
    replayScenarios: PHASE54_PLAYBOOK.filter((x) => x.executionMode === "REPLAY_OR_FIXTURE").map((x) => x.id),
    controlScenarios: PHASE54_PLAYBOOK.filter((x) => x.executionMode === "PRE_OR_POST_SESSION_CONTROL").map((x) => x.id),
    automaticExecutionAllowed: false as const,
    productionReady: false as const,
    nextAction: "EXECUTE_ONLY_WITH_RECORDED_EVIDENCE_AND_APPROPRIATE_ISOLATION" as const,
  };
}

export const PHASE54_SAFETY = Object.freeze({
  preparationOnly: true,
  automaticFailureInjectionAllowed: false,
  modifiesLiveBrokerCredentials: false,
  disablesProductionDatabaseForTesting: false,
  mutatesProductionMarketData: false,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
  productionReady: false,
});
