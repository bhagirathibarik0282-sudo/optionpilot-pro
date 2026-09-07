import type { LivePremiumDeltaGammaPolicy } from "./h1-live-premium-delta-gamma-evaluator.js";
import type { ThetaIvMultiExpiryPolicy } from "./h1-live-theta-iv-multi-expiry-evaluator.js";
import type { LiveCapitalLiquidityDtePolicy } from "./h1-live-capital-liquidity-dte-gates.js";

export interface H1SelectorProductionPolicyInput {
  premiumPolicy?: LivePremiumDeltaGammaPolicy | null;
  burdenPolicy?: ThetaIvMultiExpiryPolicy | null;
  capitalLiquidityDtePolicy?: LiveCapitalLiquidityDtePolicy | null;
}

export interface H1SelectorProductionPolicyResult {
  version: "H1_SELECTOR_PRODUCTION_POLICY_V1";
  ready: boolean;
  premiumPolicy: LivePremiumDeltaGammaPolicy | null;
  burdenPolicy: ThetaIvMultiExpiryPolicy | null;
  capitalLiquidityDtePolicy: LiveCapitalLiquidityDtePolicy | null;
  blockers: string[];
  source: "EXPLICIT_VALIDATED_POLICY_ONLY";
  productionImpact: "NONE";
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  failClosed: true;
}

function validPremium(p: LivePremiumDeltaGammaPolicy | null | undefined): p is LivePremiumDeltaGammaPolicy {
  return !!p &&
    Number.isFinite(p.maxObservationGapMs) && p.maxObservationGapMs > 0 &&
    Number.isFinite(p.minPremiumMovePct) && p.minPremiumMovePct >= 0 &&
    Number.isFinite(p.minAbsoluteDeltaChange) && p.minAbsoluteDeltaChange >= 0 &&
    Number.isFinite(p.minCurrentGamma) && p.minCurrentGamma >= 0;
}

function validBurden(p: ThetaIvMultiExpiryPolicy | null | undefined): p is ThetaIvMultiExpiryPolicy {
  return !!p &&
    Number.isFinite(p.maxObservationAgeMs) && p.maxObservationAgeMs > 0 &&
    Number.isFinite(p.maxAbsThetaPctOfPremium) && p.maxAbsThetaPctOfPremium >= 0 &&
    Number.isFinite(p.minIv) && p.minIv >= 0 &&
    Number.isFinite(p.maxIv) && p.maxIv >= p.minIv &&
    Number.isInteger(p.requiredPeerCount) && p.requiredPeerCount >= 1 &&
    Number.isInteger(p.maxConflictingPeerCount) && p.maxConflictingPeerCount >= 0;
}

function validCapital(p: LiveCapitalLiquidityDtePolicy | null | undefined): p is LiveCapitalLiquidityDtePolicy {
  return !!p &&
    Number.isFinite(p.maxCapitalPerTrade) && p.maxCapitalPerTrade > 0 &&
    Number.isFinite(p.maxRelativeSpreadPct) && p.maxRelativeSpreadPct > 0 &&
    Number.isFinite(p.minBidDepthCoverageMultiple) && p.minBidDepthCoverageMultiple > 0 &&
    Number.isFinite(p.minAskDepthCoverageMultiple) && p.minAskDepthCoverageMultiple > 0 &&
    typeof p.allowFallbackDte5To7 === "boolean";
}

export function resolveH1SelectorProductionPolicy(input: H1SelectorProductionPolicyInput = {}): H1SelectorProductionPolicyResult {
  const blockers: string[] = [];
  if (!validPremium(input.premiumPolicy)) blockers.push("PREMIUM_POLICY_UNVERIFIED");
  if (!validBurden(input.burdenPolicy)) blockers.push("THETA_IV_MULTI_EXPIRY_POLICY_UNVERIFIED");
  if (!validCapital(input.capitalLiquidityDtePolicy)) blockers.push("CAPITAL_LIQUIDITY_DTE_POLICY_UNVERIFIED");

  const ready = blockers.length === 0;
  return {
    version: "H1_SELECTOR_PRODUCTION_POLICY_V1",
    ready,
    premiumPolicy: ready ? input.premiumPolicy! : null,
    burdenPolicy: ready ? input.burdenPolicy! : null,
    capitalLiquidityDtePolicy: ready ? input.capitalLiquidityDtePolicy! : null,
    blockers,
    source: "EXPLICIT_VALIDATED_POLICY_ONLY",
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}
