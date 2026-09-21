export type H1DirectionThresholdLabel = "P50" | "P75" | "P90" | "P95";

export interface H1DirectionProspectiveAcceptanceCriteria {
  rubricVersion: "H1_DIRECTION_SELECTION_RUBRIC_V1";
  candidateLabel: H1DirectionThresholdLabel;
  minimumUntouchedTradingDates: number;
  minimumOosRetentionRate: number;
  minimumOosStrictMajorityIntervalRate: number;
  minimumOosMeanSideBalancedAgreementShare: number;
  maximumCalibrationToOosStrictMajorityDrop: number;
}

export interface H1GreekProspectiveAcceptanceCriteria {
  minimumUntouchedContractObservations: number;
  maximumObservationAgeMs: number;
  maximumUnderlyingSkewMs: number;
  minimumTimingPassRate: number;
  minimumUnderlyingSkewPassRate: number;
  maximumAbsoluteDeltaError: number;
  maximumAbsoluteGammaError: number;
  maximumAbsoluteIvError: number;
  minimumDeltaModelPassRate: number;
  minimumGammaModelPassRate: number;
  minimumIvModelPassRate: number;
}

export interface H1SelectorProspectiveValidationProtocolInput {
  protocolId: string;
  ownerApprovalRef: string;
  frozenAt: string;
  untouchedEvidenceStartsAt: string;
  direction: H1DirectionProspectiveAcceptanceCriteria;
  greeks: H1GreekProspectiveAcceptanceCriteria;
}

export interface H1SelectorProspectiveValidationProtocolResult {
  version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_PROTOCOL_V1";
  readyForUntouchedEvidenceCollection: boolean;
  blockers: string[];
  protocol: H1SelectorProspectiveValidationProtocolInput | null;
  selectionRubricFrozen: true;
  usesExistingEvidenceForAcceptanceTuning: false;
  productionPromotionEligible: false;
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function probability(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Validates only whether an owner-approved protocol was frozen before its
 * untouched evidence window. It never evaluates evidence, chooses a threshold,
 * promotes a policy, or grants runtime authority.
 */
export function validateH1SelectorProspectiveValidationProtocol(
  input: H1SelectorProspectiveValidationProtocolInput,
): H1SelectorProspectiveValidationProtocolResult {
  const blockers: string[] = [];
  const direction = input?.direction;
  const greeks = input?.greeks;
  const frozenAt = timestamp(input?.frozenAt);
  const evidenceStartsAt = timestamp(input?.untouchedEvidenceStartsAt);

  if (!nonEmpty(input?.protocolId)) blockers.push("PROTOCOL_ID_REQUIRED");
  if (!nonEmpty(input?.ownerApprovalRef)) blockers.push("OWNER_APPROVAL_REFERENCE_REQUIRED");
  if (frozenAt == null) blockers.push("VALID_FROZEN_AT_REQUIRED");
  if (evidenceStartsAt == null) blockers.push("VALID_UNTOUCHED_EVIDENCE_START_REQUIRED");
  if (frozenAt != null && evidenceStartsAt != null && frozenAt >= evidenceStartsAt) {
    blockers.push("PROTOCOL_MUST_PRECEDE_UNTOUCHED_EVIDENCE");
  }

  if (direction?.rubricVersion !== "H1_DIRECTION_SELECTION_RUBRIC_V1") {
    blockers.push("FROZEN_DIRECTION_RUBRIC_REQUIRED");
  }
  if (!["P50", "P75", "P90", "P95"].includes(direction?.candidateLabel)) {
    blockers.push("EXPLICIT_DIRECTION_CANDIDATE_LABEL_REQUIRED");
  }
  if (!Number.isInteger(direction?.minimumUntouchedTradingDates) || direction.minimumUntouchedTradingDates < 1) {
    blockers.push("DIRECTION_MINIMUM_UNTOUCHED_TRADING_DATES_REQUIRED");
  }
  if (!probability(direction?.minimumOosRetentionRate)) blockers.push("DIRECTION_OOS_RETENTION_CRITERION_REQUIRED");
  if (!probability(direction?.minimumOosStrictMajorityIntervalRate)) blockers.push("DIRECTION_OOS_MAJORITY_CRITERION_REQUIRED");
  if (!probability(direction?.minimumOosMeanSideBalancedAgreementShare)) blockers.push("DIRECTION_OOS_BALANCE_CRITERION_REQUIRED");
  if (!probability(direction?.maximumCalibrationToOosStrictMajorityDrop)) blockers.push("DIRECTION_OOS_DEGRADATION_CRITERION_REQUIRED");

  if (!Number.isInteger(greeks?.minimumUntouchedContractObservations) || greeks.minimumUntouchedContractObservations < 1) {
    blockers.push("GREEK_MINIMUM_UNTOUCHED_OBSERVATIONS_REQUIRED");
  }
  if (!positive(greeks?.maximumObservationAgeMs)) blockers.push("GREEK_MAXIMUM_OBSERVATION_AGE_REQUIRED");
  if (!positive(greeks?.maximumUnderlyingSkewMs)) blockers.push("GREEK_MAXIMUM_UNDERLYING_SKEW_REQUIRED");
  if (!probability(greeks?.minimumTimingPassRate)) blockers.push("GREEK_TIMING_PASS_RATE_CRITERION_REQUIRED");
  if (!probability(greeks?.minimumUnderlyingSkewPassRate)) blockers.push("GREEK_SKEW_PASS_RATE_CRITERION_REQUIRED");
  if (!positive(greeks?.maximumAbsoluteDeltaError)) blockers.push("DELTA_MODEL_ERROR_CRITERION_REQUIRED");
  if (!positive(greeks?.maximumAbsoluteGammaError)) blockers.push("GAMMA_MODEL_ERROR_CRITERION_REQUIRED");
  if (!positive(greeks?.maximumAbsoluteIvError)) blockers.push("IV_MODEL_ERROR_CRITERION_REQUIRED");
  if (!probability(greeks?.minimumDeltaModelPassRate)) blockers.push("DELTA_MODEL_PASS_RATE_CRITERION_REQUIRED");
  if (!probability(greeks?.minimumGammaModelPassRate)) blockers.push("GAMMA_MODEL_PASS_RATE_CRITERION_REQUIRED");
  if (!probability(greeks?.minimumIvModelPassRate)) blockers.push("IV_MODEL_PASS_RATE_CRITERION_REQUIRED");

  const uniqueBlockers = [...new Set(blockers)];
  return {
    version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_PROTOCOL_V1",
    readyForUntouchedEvidenceCollection: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    protocol: uniqueBlockers.length === 0 ? structuredClone(input) : null,
    selectionRubricFrozen: true,
    usesExistingEvidenceForAcceptanceTuning: false,
    productionPromotionEligible: false,
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
