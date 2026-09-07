import { resolveH1SelectorProductionPolicy } from "./h1-selector-production-policy.js";

export const H1_SELECTOR_SHADOW_PROFILE_V1 = Object.freeze({
  version: "H1_SELECTOR_SHADOW_PROFILE_V1" as const,
  semantics: "SHADOW_CALIBRATION_ONLY" as const,
  directionPolicy: Object.freeze({
    maxObservationGapMs: 180_000,
    minAbsoluteSpotMovePct: 0,
    maxDirectionAgeMs: 180_000,
  }),
  greekPolicy: Object.freeze({
    annualRiskFreeRate: 0.05,
    annualDividendYield: 0,
    maxAgeMs: 5_000,
    maxUnderlyingSkewMs: 2_000,
  }),
  premiumPolicy: Object.freeze({
    maxObservationGapMs: 180_000,
    minPremiumMovePct: 2,
    minAbsoluteDeltaChange: 0.03,
    minCurrentGamma: 0.001,
  }),
  burdenPolicy: Object.freeze({
    maxObservationAgeMs: 60_000,
    maxAbsThetaPctOfPremium: 3,
    minIv: 8,
    maxIv: 30,
    requiredPeerCount: 2,
    maxConflictingPeerCount: 0,
  }),
  capitalLiquidityDtePolicy: Object.freeze({
    maxCapitalPerTrade: 50_000,
    maxRelativeSpreadPct: 1.5,
    minBidDepthCoverageMultiple: 2,
    minAskDepthCoverageMultiple: 2,
    allowFallbackDte5To7: false,
  }),
  productionImpact: "NONE" as const,
  affectsTelegram: false as const,
  affectsVerdict: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
});

export function getH1SelectorShadowProductionPolicy() {
  const selector = resolveH1SelectorProductionPolicy({
    premiumPolicy: H1_SELECTOR_SHADOW_PROFILE_V1.premiumPolicy,
    burdenPolicy: H1_SELECTOR_SHADOW_PROFILE_V1.burdenPolicy,
    capitalLiquidityDtePolicy: H1_SELECTOR_SHADOW_PROFILE_V1.capitalLiquidityDtePolicy,
  });
  if (!selector.ready) throw new Error(`H1_SELECTOR_SHADOW_PROFILE_INVALID:${selector.blockers.join("|")}`);
  return {
    ...H1_SELECTOR_SHADOW_PROFILE_V1,
    selectorPolicy: selector,
  };
}
