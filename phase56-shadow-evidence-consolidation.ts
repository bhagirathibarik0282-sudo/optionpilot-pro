import { evaluatePhase52Validation, type Phase52ValidationInput } from "./phase52-live-shadow-validation.js";
import { PHASE52_FAILURE_MATRIX } from "./phase52-live-shadow-validation.js";
import { validatePhase54Evidence, type Phase54EvidenceRecord } from "./phase54-failure-injection-playbook.js";

export const PHASE56_VERSION = "PHASE56_SHADOW_EVIDENCE_CONSOLIDATION_V1" as const;

export interface Phase56Input {
  validation: Phase52ValidationInput;
  phase54Evidence: Phase54EvidenceRecord[];
}

export interface Phase56Report {
  version: typeof PHASE56_VERSION;
  architectureRole: "SHADOW_EVIDENCE_CONSOLIDATION_ONLY";
  productionImpact: "NONE";
  status: "NOT_READY" | "READY_FOR_PRODUCTION_READINESS_GATE";
  validPhase54ScenarioCount: number;
  requiredScenarioCount: number;
  missingOrInvalidScenarios: string[];
  blockers: string[];
  productionReady: false;
  automaticPromotionAllowed: false;
}

export function buildPhase56Report(input: Phase56Input): Phase56Report {
  const phase52 = evaluatePhase52Validation(input.validation);
  const validScenarioIds = new Set(
    input.phase54Evidence
      .filter((record) => validatePhase54Evidence(record).valid)
      .map((record) => record.scenarioId),
  );
  const missingOrInvalidScenarios = PHASE52_FAILURE_MATRIX
    .map((x) => x.id)
    .filter((id) => !validScenarioIds.has(id));

  const blockers = [...phase52.blockers];
  if (missingOrInvalidScenarios.length) blockers.push("PHASE54_EVIDENCE_INCOMPLETE_OR_INVALID");

  return {
    version: PHASE56_VERSION,
    architectureRole: "SHADOW_EVIDENCE_CONSOLIDATION_ONLY",
    productionImpact: "NONE",
    status: blockers.length ? "NOT_READY" : "READY_FOR_PRODUCTION_READINESS_GATE",
    validPhase54ScenarioCount: validScenarioIds.size,
    requiredScenarioCount: PHASE52_FAILURE_MATRIX.length,
    missingOrInvalidScenarios,
    blockers,
    productionReady: false,
    automaticPromotionAllowed: false,
  };
}

export const PHASE56_SAFETY = Object.freeze({
  readOnlyConsolidation: true,
  automaticActivationAllowed: false,
  automaticPromotionAllowed: false,
  productionReady: false,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
});
