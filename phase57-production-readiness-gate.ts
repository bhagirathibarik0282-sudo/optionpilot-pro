import { buildPhase56Report, type Phase56Input } from "./phase56-shadow-evidence-consolidation.js";

export const PHASE57_VERSION = "PHASE57_PRODUCTION_READINESS_DECISION_GATE_V1" as const;

export interface Phase57Input {
  phase56: Phase56Input;
  finalDevilAuditPassed: boolean;
  productionBehaviorChanged: boolean;
  unresolvedCriticalRiskCount: number;
}

export interface Phase57Report {
  version: typeof PHASE57_VERSION;
  architectureRole: "PRODUCTION_READINESS_DECISION_GATE_ONLY";
  productionImpact: "NONE";
  status: "NOT_READY" | "READY_FOR_MANUAL_REVIEW";
  blockers: string[];
  manualReviewRequired: true;
  automaticPromotionAllowed: false;
  automaticDeploymentAllowed: false;
  productionReady: false;
}

export function buildPhase57Report(input: Phase57Input): Phase57Report {
  const phase56 = buildPhase56Report(input.phase56);
  const blockers = [...phase56.blockers];

  if (phase56.status !== "READY_FOR_PRODUCTION_READINESS_GATE") blockers.push("PHASE56_NOT_GATE_READY");
  if (!input.finalDevilAuditPassed) blockers.push("FINAL_DEVIL_AUDIT_NOT_PASSED");
  if (input.productionBehaviorChanged) blockers.push("PRODUCTION_BEHAVIOR_CHANGED_DURING_SHADOW_VALIDATION");
  if (!Number.isInteger(input.unresolvedCriticalRiskCount) || input.unresolvedCriticalRiskCount < 0) {
    blockers.push("INVALID_CRITICAL_RISK_COUNT");
  } else if (input.unresolvedCriticalRiskCount > 0) {
    blockers.push("UNRESOLVED_CRITICAL_RISKS_PRESENT");
  }

  return {
    version: PHASE57_VERSION,
    architectureRole: "PRODUCTION_READINESS_DECISION_GATE_ONLY",
    productionImpact: "NONE",
    status: blockers.length ? "NOT_READY" : "READY_FOR_MANUAL_REVIEW",
    blockers: [...new Set(blockers)],
    manualReviewRequired: true,
    automaticPromotionAllowed: false,
    automaticDeploymentAllowed: false,
    productionReady: false,
  };
}

export const PHASE57_SAFETY = Object.freeze({
  decisionOnly: true,
  automaticPromotionAllowed: false,
  automaticDeploymentAllowed: false,
  productionReady: false,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
});
