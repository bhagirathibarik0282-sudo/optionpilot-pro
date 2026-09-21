import {
  validateH1SelectorProspectiveValidationProtocol,
  type H1SelectorProspectiveValidationProtocolInput,
} from "./h1-selector-prospective-validation-protocol.js";

export interface H1DirectionProspectiveEvidence {
  candidateLabel: "P50" | "P75" | "P90" | "P95";
  untouchedTradingDates: number;
  oosRetentionRate: number;
  oosStrictMajorityIntervalRate: number;
  oosMeanSideBalancedAgreementShare: number;
  calibrationToOosStrictMajorityDrop: number;
}

export interface H1GreekProspectiveEvidence {
  untouchedContractObservations: number;
  timingPassRate: number;
  underlyingSkewPassRate: number;
  maximumAbsoluteDeltaErrorObserved: number;
  maximumAbsoluteGammaErrorObserved: number;
  maximumAbsoluteIvErrorObserved: number;
  deltaModelPassRate: number;
  gammaModelPassRate: number;
  ivModelPassRate: number;
}

export interface H1SelectorProspectiveValidationEvidence {
  evidenceWindowStartsAt: string;
  evidenceWindowEndsAt: string;
  direction: H1DirectionProspectiveEvidence;
  greeks: H1GreekProspectiveEvidence;
}

export interface H1SelectorProspectiveValidationEvaluation {
  version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_EVALUATION_V1";
  readyForOwnerPromotionReview: boolean;
  protocolId: string | null;
  directionPass: boolean;
  greekPass: boolean;
  blockers: string[];
  productionPromotionEligible: false;
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Evaluates only untouched evidence against an already pre-registered protocol.
 * It cannot select thresholds, tune criteria, promote a policy, attach the
 * selector runtime, publish a Business Card, send Telegram, or create orders.
 */
export function evaluateH1SelectorProspectiveValidation(
  protocolInput: H1SelectorProspectiveValidationProtocolInput,
  evidence: H1SelectorProspectiveValidationEvidence,
): H1SelectorProspectiveValidationEvaluation {
  const protocolValidation = validateH1SelectorProspectiveValidationProtocol(protocolInput);
  const blockers: string[] = [];

  if (!protocolValidation.readyForUntouchedEvidenceCollection || !protocolValidation.protocol) {
    blockers.push("VALID_PRE_REGISTERED_PROTOCOL_REQUIRED", ...protocolValidation.blockers);
    return {
      version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_EVALUATION_V1",
      readyForOwnerPromotionReview: false,
      protocolId: null,
      directionPass: false,
      greekPass: false,
      blockers: [...new Set(blockers)],
      productionPromotionEligible: false,
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    };
  }

  const protocol = protocolValidation.protocol;
  const evidenceStart = timestamp(evidence?.evidenceWindowStartsAt);
  const evidenceEnd = timestamp(evidence?.evidenceWindowEndsAt);
  const allowedStart = timestamp(protocol.untouchedEvidenceStartsAt);

  if (evidenceStart == null) blockers.push("VALID_EVIDENCE_WINDOW_START_REQUIRED");
  if (evidenceEnd == null) blockers.push("VALID_EVIDENCE_WINDOW_END_REQUIRED");
  if (evidenceStart != null && evidenceEnd != null && evidenceEnd < evidenceStart) {
    blockers.push("EVIDENCE_WINDOW_ORDER_INVALID");
  }
  if (evidenceStart != null && allowedStart != null && evidenceStart < allowedStart) {
    blockers.push("PRE_REGISTRATION_EVIDENCE_FORBIDDEN");
  }

  const direction = evidence?.direction;
  if (direction?.candidateLabel !== protocol.direction.candidateLabel) {
    blockers.push("DIRECTION_CANDIDATE_LABEL_MISMATCH");
  }
  if (!Number.isInteger(direction?.untouchedTradingDates) || direction.untouchedTradingDates < protocol.direction.minimumUntouchedTradingDates) {
    blockers.push("DIRECTION_UNTOUCHED_TRADING_DATES_INSUFFICIENT");
  }
  if (!probability(direction?.oosRetentionRate) || direction.oosRetentionRate < protocol.direction.minimumOosRetentionRate) {
    blockers.push("DIRECTION_OOS_RETENTION_BELOW_CRITERION");
  }
  if (!probability(direction?.oosStrictMajorityIntervalRate) || direction.oosStrictMajorityIntervalRate < protocol.direction.minimumOosStrictMajorityIntervalRate) {
    blockers.push("DIRECTION_OOS_STRICT_MAJORITY_BELOW_CRITERION");
  }
  if (!probability(direction?.oosMeanSideBalancedAgreementShare) || direction.oosMeanSideBalancedAgreementShare < protocol.direction.minimumOosMeanSideBalancedAgreementShare) {
    blockers.push("DIRECTION_OOS_BALANCE_BELOW_CRITERION");
  }
  if (!probability(direction?.calibrationToOosStrictMajorityDrop) || direction.calibrationToOosStrictMajorityDrop > protocol.direction.maximumCalibrationToOosStrictMajorityDrop) {
    blockers.push("DIRECTION_OOS_DEGRADATION_ABOVE_CRITERION");
  }

  const greeks = evidence?.greeks;
  if (!Number.isInteger(greeks?.untouchedContractObservations) || greeks.untouchedContractObservations < protocol.greeks.minimumUntouchedContractObservations) {
    blockers.push("GREEK_UNTOUCHED_OBSERVATIONS_INSUFFICIENT");
  }
  if (!probability(greeks?.timingPassRate) || greeks.timingPassRate < protocol.greeks.minimumTimingPassRate) {
    blockers.push("GREEK_TIMING_PASS_RATE_BELOW_CRITERION");
  }
  if (!probability(greeks?.underlyingSkewPassRate) || greeks.underlyingSkewPassRate < protocol.greeks.minimumUnderlyingSkewPassRate) {
    blockers.push("GREEK_SKEW_PASS_RATE_BELOW_CRITERION");
  }
  if (!nonNegative(greeks?.maximumAbsoluteDeltaErrorObserved) || greeks.maximumAbsoluteDeltaErrorObserved > protocol.greeks.maximumAbsoluteDeltaError) {
    blockers.push("DELTA_MODEL_ERROR_ABOVE_CRITERION");
  }
  if (!nonNegative(greeks?.maximumAbsoluteGammaErrorObserved) || greeks.maximumAbsoluteGammaErrorObserved > protocol.greeks.maximumAbsoluteGammaError) {
    blockers.push("GAMMA_MODEL_ERROR_ABOVE_CRITERION");
  }
  if (!nonNegative(greeks?.maximumAbsoluteIvErrorObserved) || greeks.maximumAbsoluteIvErrorObserved > protocol.greeks.maximumAbsoluteIvError) {
    blockers.push("IV_MODEL_ERROR_ABOVE_CRITERION");
  }
  if (!probability(greeks?.deltaModelPassRate) || greeks.deltaModelPassRate < protocol.greeks.minimumDeltaModelPassRate) {
    blockers.push("DELTA_MODEL_PASS_RATE_BELOW_CRITERION");
  }
  if (!probability(greeks?.gammaModelPassRate) || greeks.gammaModelPassRate < protocol.greeks.minimumGammaModelPassRate) {
    blockers.push("GAMMA_MODEL_PASS_RATE_BELOW_CRITERION");
  }
  if (!probability(greeks?.ivModelPassRate) || greeks.ivModelPassRate < protocol.greeks.minimumIvModelPassRate) {
    blockers.push("IV_MODEL_PASS_RATE_BELOW_CRITERION");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const directionPass = !uniqueBlockers.some((b) => b.startsWith("DIRECTION_"));
  const greekPass = !uniqueBlockers.some((b) =>
    b.startsWith("GREEK_") || b.startsWith("DELTA_") || b.startsWith("GAMMA_") || b.startsWith("IV_"),
  );

  return {
    version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_EVALUATION_V1",
    readyForOwnerPromotionReview: uniqueBlockers.length === 0,
    protocolId: protocol.protocolId,
    directionPass,
    greekPass,
    blockers: uniqueBlockers,
    productionPromotionEligible: false,
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
