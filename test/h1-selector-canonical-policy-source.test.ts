import test from "node:test";
import assert from "node:assert/strict";
import { readH1SelectorCanonicalPolicySource } from "../h1-selector-canonical-policy-source.js";

const policy = {
  contracts: [{ instrumentToken: 101, moneyness: "ATM", orderQuantity: 50 }],
  directionPolicy: { maxObservationGapMs: 10000, minAbsoluteSpotMovePct: 0.04454867692571917, maxDirectionAgeMs: 30000 },
  greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
  premiumPolicy: { maxObservationGapMs: 10000, minPremiumMovePct: 0.1, minAbsoluteDeltaChange: 0.01, minCurrentGamma: 0.0001 },
  burdenPolicy: { maxObservationAgeMs: 30000, maxAbsThetaPctOfPremium: 10, minIv: 1, maxIv: 100, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
  capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100000, maxRelativeSpreadPct: 1.5, minBidDepthCoverageMultiple: 2, minAskDepthCoverageMultiple: 2, allowFallbackDte5To7: false },
};

function validationProof(overrides: Record<string, unknown> = {}) {
  return {
    prospectiveEvaluation: {
      version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_EVALUATION_V1",
      readyForOwnerPromotionReview: true,
      protocolId: "H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1",
      directionPass: true,
      greekPass: true,
      blockers: [],
      productionPromotionEligible: false,
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    },
    directionThresholdPct: policy.directionPolicy.minAbsoluteSpotMovePct,
    greekPolicySnapshot: policy.greekPolicy,
    threePolicyValidation: {
      version: "H1_SELECTOR_THREE_POLICY_VALIDATION_V1",
      readyForCanonicalPolicySource: true,
      validatedPolicies: {
        premiumPolicy: policy.premiumPolicy,
        burdenPolicy: policy.burdenPolicy,
        capitalLiquidityDtePolicy: policy.capitalLiquidityDtePolicy,
      },
      blockers: [],
      source: "EXPLICIT_VALIDATED_POLICY_ONLY",
      productionImpact: "NONE",
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      createsOrders: false,
      failClosed: true,
    },
    ...overrides,
  } as any;
}

test("fails closed when canonical exact policy json is absent", () => {
  const out = readH1SelectorCanonicalPolicySource({});
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("KITE_H1_EXACT_POLICY_JSON_REQUIRED"));
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("keeps a syntactically valid exact policy non-authoritative until validation proof exists", () => {
  const out = readH1SelectorCanonicalPolicySource({ KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy) });
  assert.equal(out.ready, false);
  assert.equal(out.source, "NONE");
  assert.equal(out.exactPolicy, null);
  assert.ok(out.blockers.includes("DIRECTION_POLICY_VALIDATION_REQUIRED"));
  assert.ok(out.blockers.includes("GREEK_POLICY_VALIDATION_REQUIRED"));
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("accepts only a proof-matched exact policy after both existing validation paths pass", () => {
  const out = readH1SelectorCanonicalPolicySource(
    { KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy) },
    validationProof(),
  );
  assert.equal(out.ready, true);
  assert.equal(out.source, "KITE_H1_EXACT_POLICY_JSON_VALIDATED");
  assert.deepEqual(out.exactPolicy, policy);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.selectorPolicy.ready, true);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("fails closed when validated direction threshold does not match the exact policy", () => {
  const out = readH1SelectorCanonicalPolicySource(
    { KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy) },
    validationProof({ directionThresholdPct: policy.directionPolicy.minAbsoluteSpotMovePct + 0.001 }),
  );
  assert.equal(out.ready, false);
  assert.equal(out.exactPolicy, null);
  assert.ok(out.blockers.includes("DIRECTION_VALIDATED_THRESHOLD_MISMATCH"));
});

test("fails closed when validated three-policy snapshot does not match the exact policy", () => {
  const proof = validationProof();
  proof.threePolicyValidation.validatedPolicies.premiumPolicy = {
    ...policy.premiumPolicy,
    minPremiumMovePct: policy.premiumPolicy.minPremiumMovePct + 0.1,
  };
  const out = readH1SelectorCanonicalPolicySource(
    { KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy) },
    proof,
  );
  assert.equal(out.ready, false);
  assert.equal(out.exactPolicy, null);
  assert.ok(out.blockers.includes("PREMIUM_POLICY_VALIDATED_SNAPSHOT_MISMATCH"));
});
