import {
  resolveH1SelectorProductionPolicy,
  type H1SelectorProductionPolicyInput,
} from "./h1-selector-production-policy.js";

export type H1ThreePolicyEvidenceProvenance =
  | "LIVE_RUNTIME_EXACT"
  | "UNTOUCHED_OOS_VALIDATION";

export interface H1ThreePolicyEvidenceDecision<TPolicy> {
  evidenceRef: string;
  evaluatorVersion: string;
  observedAt: string;
  provenance: H1ThreePolicyEvidenceProvenance;
  decision: "PASS" | "FAIL";
  policySnapshot: TPolicy;
}

export interface H1SelectorThreePolicyValidationInput {
  validationId: string;
  ownerApprovalRef: string;
  validatedAt: string;
  source: "EXPLICIT_VALIDATED_POLICY_ONLY";
  policies: Required<H1SelectorProductionPolicyInput>;
  premiumDeltaGamma: H1ThreePolicyEvidenceDecision<Required<H1SelectorProductionPolicyInput>["premiumPolicy"]>;
  thetaIvMultiExpiry: H1ThreePolicyEvidenceDecision<Required<H1SelectorProductionPolicyInput>["burdenPolicy"]>;
  capitalLiquidityDte: H1ThreePolicyEvidenceDecision<Required<H1SelectorProductionPolicyInput>["capitalLiquidityDtePolicy"]>;
}

export interface H1SelectorThreePolicyValidationResult {
  version: "H1_SELECTOR_THREE_POLICY_VALIDATION_V1";
  readyForCanonicalPolicySource: boolean;
  validatedPolicies: Required<H1SelectorProductionPolicyInput> | null;
  blockers: string[];
  source: "EXPLICIT_VALIDATED_POLICY_ONLY" | "NONE";
  productionImpact: "NONE";
  affectsSelector: false;
  affectsBusinessCard: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validIso(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateEvidence<TPolicy>(
  label: string,
  evidence: H1ThreePolicyEvidenceDecision<TPolicy> | null | undefined,
  expectedPolicy: TPolicy,
  blockers: string[],
): void {
  if (!evidence) {
    blockers.push(`${label}_EVIDENCE_REQUIRED`);
    return;
  }
  if (!nonEmpty(evidence.evidenceRef)) blockers.push(`${label}_EVIDENCE_REF_REQUIRED`);
  if (!nonEmpty(evidence.evaluatorVersion)) blockers.push(`${label}_EVALUATOR_VERSION_REQUIRED`);
  if (!validIso(evidence.observedAt)) blockers.push(`${label}_VALID_OBSERVED_AT_REQUIRED`);
  if (evidence.provenance !== "LIVE_RUNTIME_EXACT" && evidence.provenance !== "UNTOUCHED_OOS_VALIDATION") {
    blockers.push(`${label}_VALIDATED_PROVENANCE_REQUIRED`);
  }
  if (evidence.decision !== "PASS") blockers.push(`${label}_VALIDATION_NOT_PASSED`);
  if (!sameJson(evidence.policySnapshot, expectedPolicy)) blockers.push(`${label}_POLICY_SNAPSHOT_MISMATCH`);
}

/**
 * Structural promotion gate for the three selector policies that are already
 * evaluated elsewhere. It does not invent thresholds, re-score evidence,
 * attach the selector runtime, publish a Business Card, send Telegram, or
 * create orders. A PASS must arrive as an explicit evidence-linked validation
 * decision for the exact policy snapshot.
 */
export function validateH1SelectorThreePolicyBundle(
  input: H1SelectorThreePolicyValidationInput,
): H1SelectorThreePolicyValidationResult {
  const blockers: string[] = [];

  if (!nonEmpty(input?.validationId)) blockers.push("THREE_POLICY_VALIDATION_ID_REQUIRED");
  if (!nonEmpty(input?.ownerApprovalRef)) blockers.push("THREE_POLICY_OWNER_APPROVAL_REF_REQUIRED");
  if (!validIso(input?.validatedAt)) blockers.push("THREE_POLICY_VALIDATED_AT_REQUIRED");
  if (input?.source !== "EXPLICIT_VALIDATED_POLICY_ONLY") blockers.push("EXPLICIT_VALIDATED_POLICY_SOURCE_REQUIRED");

  const resolved = resolveH1SelectorProductionPolicy(input?.policies ?? {});
  blockers.push(...resolved.blockers);

  if (resolved.ready) {
    validateEvidence("PREMIUM_DELTA_GAMMA", input.premiumDeltaGamma, resolved.premiumPolicy!, blockers);
    validateEvidence("THETA_IV_MULTI_EXPIRY", input.thetaIvMultiExpiry, resolved.burdenPolicy!, blockers);
    validateEvidence("CAPITAL_LIQUIDITY_DTE", input.capitalLiquidityDte, resolved.capitalLiquidityDtePolicy!, blockers);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const ready = uniqueBlockers.length === 0;

  return {
    version: "H1_SELECTOR_THREE_POLICY_VALIDATION_V1",
    readyForCanonicalPolicySource: ready,
    validatedPolicies: ready
      ? {
          premiumPolicy: resolved.premiumPolicy!,
          burdenPolicy: resolved.burdenPolicy!,
          capitalLiquidityDtePolicy: resolved.capitalLiquidityDtePolicy!,
        }
      : null,
    blockers: uniqueBlockers,
    source: ready ? "EXPLICIT_VALIDATED_POLICY_ONLY" : "NONE",
    productionImpact: "NONE",
    affectsSelector: false,
    affectsBusinessCard: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
  };
}
