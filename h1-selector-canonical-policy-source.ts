import { validateH1ExactShadowPolicy, type H1ExactShadowPolicy } from "./h1-exact-shadow-live-service.js";
import type { H1KiteGreekModelPolicy } from "./h1-kite-exact-price-greek-adapter.js";
import type { H1SelectorProspectiveValidationEvaluation } from "./h1-selector-prospective-validation-evaluator.js";
import type { H1SelectorThreePolicyValidationResult } from "./h1-selector-three-policy-validation-v1.js";
import { resolveH1SelectorProductionPolicy, type H1SelectorProductionPolicyResult } from "./h1-selector-production-policy.js";

export const H1_SELECTOR_PENDING_VALIDATION_BLOCKERS = [
  "DIRECTION_POLICY_VALIDATION_REQUIRED",
  "GREEK_POLICY_VALIDATION_REQUIRED",
] as const;

export interface H1SelectorCanonicalValidationProof {
  prospectiveEvaluation: H1SelectorProspectiveValidationEvaluation | null;
  directionThresholdPct: number | null;
  greekPolicySnapshot: H1KiteGreekModelPolicy | null;
  threePolicyValidation: H1SelectorThreePolicyValidationResult | null;
}

export interface H1SelectorCanonicalPolicySourceResult {
  version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1";
  ready: boolean;
  exactPolicy: H1ExactShadowPolicy | null;
  selectorPolicy: H1SelectorProductionPolicyResult;
  blockers: string[];
  source: "KITE_H1_EXACT_POLICY_JSON_VALIDATED" | "NONE";
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameFinite(a: unknown, b: unknown): boolean {
  return typeof a === "number" && Number.isFinite(a) &&
    typeof b === "number" && Number.isFinite(b) &&
    Math.abs(a - b) <= 1e-12;
}

function validateCanonicalProof(
  exactPolicy: H1ExactShadowPolicy,
  validation: H1SelectorCanonicalValidationProof | null | undefined,
): string[] {
  if (!validation) return [...H1_SELECTOR_PENDING_VALIDATION_BLOCKERS];

  const blockers: string[] = [];
  const prospective = validation.prospectiveEvaluation;
  if (
    !prospective ||
    prospective.version !== "H1_SELECTOR_PROSPECTIVE_VALIDATION_EVALUATION_V1" ||
    prospective.readyForOwnerPromotionReview !== true ||
    prospective.directionPass !== true ||
    prospective.greekPass !== true ||
    prospective.blockers.length !== 0
  ) {
    blockers.push("DIRECTION_POLICY_VALIDATION_REQUIRED", "GREEK_POLICY_VALIDATION_REQUIRED");
  }

  if (!sameFinite(validation.directionThresholdPct, exactPolicy.directionPolicy.minAbsoluteSpotMovePct)) {
    blockers.push("DIRECTION_VALIDATED_THRESHOLD_MISMATCH");
  }

  if (!validation.greekPolicySnapshot || !sameJson(validation.greekPolicySnapshot, exactPolicy.greekPolicy)) {
    blockers.push("GREEK_VALIDATED_POLICY_SNAPSHOT_MISMATCH");
  }

  const threePolicy = validation.threePolicyValidation;
  if (
    !threePolicy ||
    threePolicy.version !== "H1_SELECTOR_THREE_POLICY_VALIDATION_V1" ||
    threePolicy.readyForCanonicalPolicySource !== true ||
    threePolicy.source !== "EXPLICIT_VALIDATED_POLICY_ONLY" ||
    !threePolicy.validatedPolicies ||
    threePolicy.blockers.length !== 0
  ) {
    blockers.push("THREE_POLICY_VALIDATION_REQUIRED");
  } else {
    if (!sameJson(threePolicy.validatedPolicies.premiumPolicy, exactPolicy.premiumPolicy)) {
      blockers.push("PREMIUM_POLICY_VALIDATED_SNAPSHOT_MISMATCH");
    }
    if (!sameJson(threePolicy.validatedPolicies.burdenPolicy, exactPolicy.burdenPolicy)) {
      blockers.push("THETA_IV_MULTI_EXPIRY_POLICY_VALIDATED_SNAPSHOT_MISMATCH");
    }
    if (!sameJson(threePolicy.validatedPolicies.capitalLiquidityDtePolicy, exactPolicy.capitalLiquidityDtePolicy)) {
      blockers.push("CAPITAL_LIQUIDITY_DTE_POLICY_VALIDATED_SNAPSHOT_MISMATCH");
    }
  }

  return [...new Set(blockers)];
}

export function readH1SelectorCanonicalPolicySource(
  env: NodeJS.ProcessEnv = process.env,
  validation?: H1SelectorCanonicalValidationProof | null,
): H1SelectorCanonicalPolicySourceResult {
  const raw = env.KITE_H1_EXACT_POLICY_JSON?.trim();
  if (!raw) {
    const selectorPolicy = resolveH1SelectorProductionPolicy();
    return {
      version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1",
      ready: false,
      exactPolicy: null,
      selectorPolicy,
      blockers: ["KITE_H1_EXACT_POLICY_JSON_REQUIRED", ...selectorPolicy.blockers],
      source: "NONE",
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  }

  try {
    const exactPolicy = validateH1ExactShadowPolicy(JSON.parse(raw));
    const selectorPolicy = resolveH1SelectorProductionPolicy({
      premiumPolicy: exactPolicy.premiumPolicy,
      burdenPolicy: exactPolicy.burdenPolicy,
      capitalLiquidityDtePolicy: exactPolicy.capitalLiquidityDtePolicy,
    });
    const blockers = [...selectorPolicy.blockers, ...validateCanonicalProof(exactPolicy, validation)];
    const uniqueBlockers = [...new Set(blockers)];
    const ready = uniqueBlockers.length === 0;
    return {
      version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1",
      ready,
      exactPolicy: ready ? exactPolicy : null,
      selectorPolicy,
      blockers: uniqueBlockers,
      source: ready ? "KITE_H1_EXACT_POLICY_JSON_VALIDATED" : "NONE",
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  } catch (error) {
    const selectorPolicy = resolveH1SelectorProductionPolicy();
    return {
      version: "H1_SELECTOR_CANONICAL_POLICY_SOURCE_V1",
      ready: false,
      exactPolicy: null,
      selectorPolicy,
      blockers: [error instanceof Error ? error.message : "KITE_H1_EXACT_POLICY_JSON_INVALID"],
      source: "NONE",
      productionImpact: "NONE",
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      failClosed: true,
    };
  }
}
