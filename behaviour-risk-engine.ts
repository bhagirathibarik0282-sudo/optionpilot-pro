// Research-only objective behaviour-risk classifier for an exact selected option candidate.
// It does not infer emotions or personality. Upstream deterministic evidence supplies booleans/null.

export type BehaviourRisk =
  | "DO_NOT_CHASE"
  | "EARLY_EXIT_RISK"
  | "STOP_EXTENSION_RISK"
  | "REVENGE_FLIP_RISK"
  | "MISSED_MOVE_FOMO"
  | "AVERAGING_LOSER_RISK"
  | "EARLY_PROFIT_BOOKING_RISK"
  | "THESIS_WEAKENING"
  | "NO_FLIP_YET"
  | "DATA_UNAVAILABLE";

export interface BehaviourRiskEvidence {
  dataFresh: boolean | null;
  contractValid: boolean | null;
  lateEntryExtended: boolean | null;
  earlyExitCondition: boolean | null;
  stopExtensionCondition: boolean | null;
  revengeFlipCondition: boolean | null;
  missedMoveFomoCondition: boolean | null;
  averagingLoserCondition: boolean | null;
  earlyProfitBookingCondition: boolean | null;
  thesisWeakening: boolean | null;
  noFlipYet: boolean | null;
}

export interface BehaviourRiskResult {
  version: "BEHAVIOUR_RISK_ENGINE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  risks: BehaviourRisk[];
  reasons: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  infersMentalState: false;
}

const requiredKeys: Array<keyof BehaviourRiskEvidence> = [
  "dataFresh",
  "contractValid",
  "lateEntryExtended",
  "earlyExitCondition",
  "stopExtensionCondition",
  "revengeFlipCondition",
  "missedMoveFomoCondition",
  "averagingLoserCondition",
  "earlyProfitBookingCondition",
  "thesisWeakening",
  "noFlipYet",
];

function result(risks: BehaviourRisk[], reasons: string[]): BehaviourRiskResult {
  return {
    version: "BEHAVIOUR_RISK_ENGINE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    risks,
    reasons,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    infersMentalState: false,
  };
}

export function classifyBehaviourRisk(evidence: BehaviourRiskEvidence): BehaviourRiskResult {
  const missing = requiredKeys.filter((key) => evidence[key] == null);
  if (missing.length > 0) {
    return result(["DATA_UNAVAILABLE"], missing.map((key) => `MISSING_${String(key).toUpperCase()}`));
  }

  if (!evidence.dataFresh) return result(["DATA_UNAVAILABLE"], ["DATA_NOT_FRESH"]);
  if (!evidence.contractValid) return result(["DATA_UNAVAILABLE"], ["CONTRACT_NOT_VALID"]);

  const risks: BehaviourRisk[] = [];
  const reasons: string[] = [];

  if (evidence.lateEntryExtended) {
    risks.push("DO_NOT_CHASE");
    reasons.push("ENTRY_EXTENSION_CONDITION_CONFIRMED");
  }
  if (evidence.earlyExitCondition) {
    risks.push("EARLY_EXIT_RISK");
    reasons.push("EARLY_EXIT_CONDITION_CONFIRMED");
  }
  if (evidence.stopExtensionCondition) {
    risks.push("STOP_EXTENSION_RISK");
    reasons.push("STOP_EXTENSION_CONDITION_CONFIRMED");
  }
  if (evidence.revengeFlipCondition) {
    risks.push("REVENGE_FLIP_RISK");
    reasons.push("REVENGE_FLIP_CONDITION_CONFIRMED");
  }
  if (evidence.missedMoveFomoCondition) {
    risks.push("MISSED_MOVE_FOMO");
    reasons.push("MISSED_MOVE_LATE_ENTRY_CONDITION_CONFIRMED");
  }
  if (evidence.averagingLoserCondition) {
    risks.push("AVERAGING_LOSER_RISK");
    reasons.push("AVERAGING_LOSER_CONDITION_CONFIRMED");
  }
  if (evidence.earlyProfitBookingCondition) {
    risks.push("EARLY_PROFIT_BOOKING_RISK");
    reasons.push("EARLY_PROFIT_BOOKING_CONDITION_CONFIRMED");
  }
  if (evidence.thesisWeakening) {
    risks.push("THESIS_WEAKENING");
    reasons.push("THESIS_WEAKENING_CONFIRMED");
  }
  if (evidence.noFlipYet) {
    risks.push("NO_FLIP_YET");
    reasons.push("FRESH_OPPOSITE_SETUP_NOT_CONFIRMED");
  }

  if (risks.length === 0) reasons.push("NO_OBJECTIVE_BEHAVIOUR_RISK_CONFIRMED");
  return result(risks, reasons);
}
