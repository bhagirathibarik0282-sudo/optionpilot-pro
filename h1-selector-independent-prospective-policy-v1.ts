import {
  validateH1SelectorProspectiveValidationProtocol,
  type H1SelectorProspectiveValidationProtocolInput,
} from "./h1-selector-prospective-validation-protocol.js";

/**
 * Frozen before the untouched evidence window. These limits are prospective
 * design constraints, not a fit to the previously observed P75/OOS or Greek
 * timing results. Direction agreement is not represented as trade win rate.
 */
export const H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1 = Object.freeze({
  protocolId: "H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1",
  ownerApprovalRef: "USER_APPROVED_INDEPENDENT_PROTOCOL_PATH_2026-09-21",
  frozenAt: "2026-09-21T06:52:00.000Z",
  untouchedEvidenceStartsAt: "2026-09-22T03:45:00.000Z",
  direction: Object.freeze({
    rubricVersion: "H1_DIRECTION_SELECTION_RUBRIC_V1",
    candidateLabel: "P75",
    minimumUntouchedTradingDates: 10,
    minimumOosRetentionRate: 0.2,
    minimumOosStrictMajorityIntervalRate: 0.6,
    minimumOosMeanSideBalancedAgreementShare: 0.6,
    maximumCalibrationToOosStrictMajorityDrop: 0.1,
  }),
  greeks: Object.freeze({
    minimumUntouchedContractObservations: 1_000,
    maximumObservationAgeMs: 5_000,
    maximumUnderlyingSkewMs: 2_000,
    minimumTimingPassRate: 0.99,
    minimumUnderlyingSkewPassRate: 0.99,
    maximumAbsoluteDeltaError: 0.02,
    maximumAbsoluteGammaError: 0.0005,
    maximumAbsoluteIvError: 1,
    minimumDeltaModelPassRate: 0.95,
    minimumGammaModelPassRate: 0.95,
    minimumIvModelPassRate: 0.95,
  }),
  evidenceRules: Object.freeze({
    directionSource: "UNTOUCHED_POST_FREEZE_TRADING_DATES_ONLY",
    greekReference: "INDEPENDENT_REFERENCE_IMPLEMENTATION_REQUIRED",
    sameContractIdentityRequired: true,
    chronologicalNoLeakageRequired: true,
    completeReplayContinuityRequired: true,
    markerCountAloneForbidden: true,
    timingEvidenceAloneInsufficient: true,
  }),
  interpretation: Object.freeze({
    directionAgreementIsTradeWinRate: false,
    passingCreatesProductionAuthority: false,
    passingCreatesCandidate: false,
    passingPublishesEntryStopTarget: false,
  }),
  productionImpact: "NONE",
  affectsSelector: false,
  affectsBusinessCard: false,
  affectsTelegram: false,
  affectsExecution: false,
  createsOrders: false,
  failClosed: true,
} as const);

export function validateH1SelectorIndependentProspectivePolicyV1() {
  return validateH1SelectorProspectiveValidationProtocol(
    H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1 as H1SelectorProspectiveValidationProtocolInput,
  );
}
