import test from "node:test";
import assert from "node:assert/strict";
import { resolveH1SelectorProductionPolicy } from "../h1-selector-production-policy.js";

test("fails closed when production selector policy is not explicitly supplied", () => {
  const out = resolveH1SelectorProductionPolicy();
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, [
    "PREMIUM_POLICY_UNVERIFIED",
    "THETA_IV_MULTI_EXPIRY_POLICY_UNVERIFIED",
    "CAPITAL_LIQUIDITY_DTE_POLICY_UNVERIFIED",
  ]);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("accepts only a complete validated explicit policy bundle", () => {
  const out = resolveH1SelectorProductionPolicy({
    premiumPolicy: { maxObservationGapMs: 10_000, minPremiumMovePct: 0.1, minAbsoluteDeltaChange: 0.01, minCurrentGamma: 0.0001 },
    burdenPolicy: { maxObservationAgeMs: 30_000, maxAbsThetaPctOfPremium: 10, minIv: 1, maxIv: 100, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
    capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100_000, maxRelativeSpreadPct: 1.5, minBidDepthCoverageMultiple: 2, minAskDepthCoverageMultiple: 2, allowFallbackDte5To7: false },
  });
  assert.equal(out.ready, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.source, "EXPLICIT_VALIDATED_POLICY_ONLY");
});
