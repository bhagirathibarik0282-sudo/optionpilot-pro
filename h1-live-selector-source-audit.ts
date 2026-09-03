export type H1LiveSelectorSourceKind =
  | "LIVE_DETERMINISTIC_EXACT"
  | "RESEARCH_SHADOW_ONLY"
  | "ABSENT";

export interface H1LiveSelectorSourceAuditResult {
  version: "H1_LIVE_SELECTOR_SOURCE_AUDIT_V1";
  sourceKind: H1LiveSelectorSourceKind;
  h1CandidateMarkingAllowed: boolean;
  blockers: string[];
  evidence: string[];
  failClosed: true;
  semantics: "SOURCE_CLASSIFICATION_ONLY_NO_SELECTOR_INFERENCE";
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

/**
 * Current source audit for H1 candidate persistence.
 *
 * Verified repository state:
 * - execution-candidate-selector is invoked by candidate-ranking-shadow;
 * - that ranking path is explicitly research-shadow only;
 * - research-engine-chain HTTP accepts caller-supplied research payloads and is
 *   explicitly RESEARCH_SHADOW_CHAIN_ONLY;
 * - the H1 runtime bridge call in the live recorder hook does not yet receive
 *   an exact live selector-decision source.
 *
 * Therefore research/shadow results MUST NOT be promoted into live H1
 * is_candidate flags. This constant audit intentionally fails closed until an
 * exact deterministic live producer is wired and independently verified.
 */
export function auditH1LiveSelectorSource(): H1LiveSelectorSourceAuditResult {
  return {
    version: "H1_LIVE_SELECTOR_SOURCE_AUDIT_V1",
    sourceKind: "RESEARCH_SHADOW_ONLY",
    h1CandidateMarkingAllowed: false,
    blockers: ["NO_VERIFIED_LIVE_DETERMINISTIC_SELECTOR_SOURCE"],
    evidence: [
      "CANDIDATE_RANKING_SHADOW_USES_EXECUTION_SELECTOR",
      "CANDIDATE_RANKING_SHADOW_HAS_NO_EXECUTION_AUTHORITY",
      "RESEARCH_ENGINE_CHAIN_IS_CALLER_SUPPLIED_SHADOW_ONLY",
      "H1_RUNTIME_HOOK_HAS_NO_EXACT_SELECTOR_DECISION_ARGUMENT",
    ],
    failClosed: true,
    semantics: "SOURCE_CLASSIFICATION_ONLY_NO_SELECTOR_INFERENCE",
    productionImpact: "NONE",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
