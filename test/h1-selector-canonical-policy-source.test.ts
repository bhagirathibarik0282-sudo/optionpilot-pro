import test from "node:test";
import assert from "node:assert/strict";
import { readH1SelectorCanonicalPolicySource } from "../h1-selector-canonical-policy-source.js";

test("fails closed when canonical exact policy json is absent", () => {
  const out = readH1SelectorCanonicalPolicySource({});
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("KITE_H1_EXACT_POLICY_JSON_REQUIRED"));
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("keeps a syntactically valid exact policy non-authoritative until direction and Greek validation exist", () => {
  const policy = {
    contracts: [{ instrumentToken: 101, moneyness: "ATM", orderQuantity: 50 }],
    directionPolicy: { maxObservationGapMs: 10000, minAbsoluteSpotMovePct: 0, maxDirectionAgeMs: 30000 },
    greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
    premiumPolicy: { maxObservationGapMs: 10000, minPremiumMovePct: 0.1, minAbsoluteDeltaChange: 0.01, minCurrentGamma: 0.0001 },
    burdenPolicy: { maxObservationAgeMs: 30000, maxAbsThetaPctOfPremium: 10, minIv: 1, maxIv: 100, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
    capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100000, maxRelativeSpreadPct: 1.5, minBidDepthCoverageMultiple: 2, minAskDepthCoverageMultiple: 2, allowFallbackDte5To7: false },
  };
  const out = readH1SelectorCanonicalPolicySource({ KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy) });
  assert.equal(out.ready, false);
  assert.equal(out.source, "NONE");
  assert.equal(out.exactPolicy, null);
  assert.ok(out.blockers.includes("DIRECTION_POLICY_VALIDATION_REQUIRED"));
  assert.ok(out.blockers.includes("GREEK_POLICY_VALIDATION_REQUIRED"));
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});
