export interface H1ThreePolicyAcceptanceCriteria {
  minimumUntouchedTradingDates: number;
  minimumEvidenceObservations: number;
  minimumPassRate: number;
}

export interface H1ThreePolicyValidationProtocolInput {
  protocolId: string;
  ownerApprovalRef: string;
  frozenAt: string;
  untouchedEvidenceStartsAt: string;
  premiumDeltaGamma: H1ThreePolicyAcceptanceCriteria;
  thetaIvMultiExpiry: H1ThreePolicyAcceptanceCriteria;
  capitalLiquidityDte: H1ThreePolicyAcceptanceCriteria;
}

export interface H1ThreePolicyValidationProtocolResult {
  version: "H1_THREE_POLICY_VALIDATION_PROTOCOL_V1";
  readyForUntouchedEvidenceCollection: boolean;
  protocol: H1ThreePolicyValidationProtocolInput | null;
  blockers: string[];
  protocolFrozen: true;
  acceptanceThresholdsFrozen: boolean;
  productionPromotionEligible: false;
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateCriteria(
  label: string,
  criteria: H1ThreePolicyAcceptanceCriteria | null | undefined,
  blockers: string[],
): void {
  if (!criteria) {
    blockers.push(`${label}_CRITERIA_REQUIRED`);
    return;
  }
  if (!Number.isInteger(criteria.minimumUntouchedTradingDates) || criteria.minimumUntouchedTradingDates < 1) {
    blockers.push(`${label}_MINIMUM_TRADING_DATES_REQUIRED`);
  }
  if (!Number.isInteger(criteria.minimumEvidenceObservations) || criteria.minimumEvidenceObservations < 1) {
    blockers.push(`${label}_MINIMUM_EVIDENCE_OBSERVATIONS_REQUIRED`);
  }
  if (!probability(criteria.minimumPassRate)) {
    blockers.push(`${label}_MINIMUM_PASS_RATE_REQUIRED`);
  }
}

/**
 * Pre-registers only the validation criteria for the three production policies.
 * It does not choose the criteria, inspect evidence, tune thresholds, promote a
 * policy, attach the selector runtime, publish a Business Card, send Telegram,
 * or create orders.
 */
export function validateH1ThreePolicyValidationProtocol(
  input: H1ThreePolicyValidationProtocolInput,
): H1ThreePolicyValidationProtocolResult {
  const blockers: string[] = [];
  const frozenAt = timestamp(input?.frozenAt);
  const evidenceStartsAt = timestamp(input?.untouchedEvidenceStartsAt);

  if (!nonEmpty(input?.protocolId)) blockers.push("THREE_POLICY_PROTOCOL_ID_REQUIRED");
  if (!nonEmpty(input?.ownerApprovalRef)) blockers.push("THREE_POLICY_OWNER_APPROVAL_REFERENCE_REQUIRED");
  if (frozenAt == null) blockers.push("THREE_POLICY_VALID_FROZEN_AT_REQUIRED");
  if (evidenceStartsAt == null) blockers.push("THREE_POLICY_VALID_UNTOUCHED_EVIDENCE_START_REQUIRED");
  if (frozenAt != null && evidenceStartsAt != null && frozenAt >= evidenceStartsAt) {
    blockers.push("THREE_POLICY_PROTOCOL_MUST_PRECEDE_UNTOUCHED_EVIDENCE");
  }

  validateCriteria("PREMIUM_DELTA_GAMMA", input?.premiumDeltaGamma, blockers);
  validateCriteria("THETA_IV_MULTI_EXPIRY", input?.thetaIvMultiExpiry, blockers);
  validateCriteria("CAPITAL_LIQUIDITY_DTE", input?.capitalLiquidityDte, blockers);

  const unique = [...new Set(blockers)];
  const ready = unique.length === 0;

  return {
    version: "H1_THREE_POLICY_VALIDATION_PROTOCOL_V1",
    readyForUntouchedEvidenceCollection: ready,
    protocol: ready ? structuredClone(input) : null,
    blockers: unique,
    protocolFrozen: true,
    acceptanceThresholdsFrozen: ready,
    productionPromotionEligible: false,
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}
