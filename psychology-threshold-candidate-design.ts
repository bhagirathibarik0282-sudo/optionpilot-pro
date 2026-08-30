import { preparePsychologyThresholdResearch } from "./psychology-threshold-research-preparation.ts";
import type { StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import type { ShadowValidationMetricKey } from "./psychology-shadow-validation.ts";

export type PsychologyThresholdCandidateDesignStatus =
  | "THRESHOLD_RESEARCH_BLOCKED"
  | "READY_FOR_UNCERTAINTY_ESTIMATION";

export interface PsychologyThresholdCandidateDesignCard {
  metric: ShadowValidationMetricKey;
  calibrationValue: number;
  preferredDirection: "LOWER" | "HIGHER";
  comparisonOperator: "LESS_THAN_OR_EQUAL" | "GREATER_THAN_OR_EQUAL";
  metricFamily: "BINOMIAL_RATE" | "COUNT_PER_TRADE";
  uncertaintyMethod: "WILSON_95" | "TRADING_DATE_CLUSTER_BOOTSTRAP_95";
  uncertaintyLower: null;
  uncertaintyUpper: null;
  candidateThreshold: null;
  candidateSelected: false;
  candidateFrozen: false;
}

export interface PsychologyThresholdCandidateDesignResult {
  version: "PSYCHOLOGY_THRESHOLD_CANDIDATE_DESIGN_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyThresholdCandidateDesignStatus;
  cards: PsychologyThresholdCandidateDesignCard[];
  allTenFrozenMetricsPresent: boolean;
  uncertaintyRequiredBeforeCandidateSelection: true;
  thresholdSelectionRuleFrozen: false;
  oosReadForCandidateDesign: false;
  oosUsedForCandidateSelection: false;
  acceptanceThresholdsProposed: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

/**
 * Defines the safe candidate-threshold research shape without inventing numeric thresholds.
 * Direction comes only from the frozen metric registry. Numeric candidate selection remains
 * blocked until preregistered uncertainty estimates and an explicit selection rule exist.
 */
export function designPsychologyThresholdCandidates(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyThresholdCandidateDesignResult {
  const prepared = preparePsychologyThresholdResearch(rows);
  const blockers = [...prepared.blockers];

  if (prepared.status !== "READY_FOR_THRESHOLD_RESEARCH") {
    blockers.push("THRESHOLD_RESEARCH_NOT_READY");
    return {
      version: "PSYCHOLOGY_THRESHOLD_CANDIDATE_DESIGN_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      status: "THRESHOLD_RESEARCH_BLOCKED",
      cards: [],
      allTenFrozenMetricsPresent: false,
      uncertaintyRequiredBeforeCandidateSelection: true,
      thresholdSelectionRuleFrozen: false,
      oosReadForCandidateDesign: false,
      oosUsedForCandidateSelection: false,
      acceptanceThresholdsProposed: false,
      acceptanceThresholdsFrozen: false,
      promotionEligible: false,
      blockers,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const cards = prepared.metricCards.map((card) => ({
    metric: card.metric,
    calibrationValue: card.value,
    preferredDirection: card.preferredDirection,
    comparisonOperator: card.preferredDirection === "LOWER" ? "LESS_THAN_OR_EQUAL" : "GREATER_THAN_OR_EQUAL",
    metricFamily: card.metricFamily,
    uncertaintyMethod: card.preregisteredUncertaintyMethod,
    uncertaintyLower: null,
    uncertaintyUpper: null,
    candidateThreshold: null,
    candidateSelected: false,
    candidateFrozen: false,
  } satisfies PsychologyThresholdCandidateDesignCard));

  const allTenFrozenMetricsPresent = prepared.allTenFrozenMetricsPresent && cards.length === 10;
  if (!allTenFrozenMetricsPresent) blockers.push("NOT_ALL_10_FROZEN_METRICS_PRESENT");

  const ready = blockers.length === 0;
  return {
    version: "PSYCHOLOGY_THRESHOLD_CANDIDATE_DESIGN_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: ready ? "READY_FOR_UNCERTAINTY_ESTIMATION" : "THRESHOLD_RESEARCH_BLOCKED",
    cards: ready ? cards : [],
    allTenFrozenMetricsPresent: ready && allTenFrozenMetricsPresent,
    uncertaintyRequiredBeforeCandidateSelection: true,
    thresholdSelectionRuleFrozen: false,
    oosReadForCandidateDesign: false,
    oosUsedForCandidateSelection: false,
    acceptanceThresholdsProposed: false,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
