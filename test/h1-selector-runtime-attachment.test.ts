import test from "node:test";
import assert from "node:assert/strict";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import { resolveH1SelectorProductionPolicy } from "../h1-selector-production-policy.js";
import { attachH1SelectorRuntime } from "../h1-selector-runtime-attachment.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 10, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY" },
]);

test("fails closed when canonical production policy is not ready", () => {
  const out = attachH1SelectorRuntime({
    registry,
    policy: resolveH1SelectorProductionPolicy(),
    coordinatorConfig: {
      orderQuantityFor: () => 50,
      greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
      publisherFor: () => { throw new Error("must not be called"); },
    },
  });
  assert.equal(out.ready, false);
  assert.equal(out.coordinator, null);
  assert.ok(out.blockers.includes("PREMIUM_POLICY_UNVERIFIED"));
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("attaches existing exact coordinator only with a complete validated bundle", () => {
  const policy = resolveH1SelectorProductionPolicy({
    premiumPolicy: { maxObservationGapMs: 10000, minPremiumMovePct: 0.1, minAbsoluteDeltaChange: 0.01, minCurrentGamma: 0.0001 },
    burdenPolicy: { maxObservationAgeMs: 30000, maxAbsThetaPctOfPremium: 10, minIv: 1, maxIv: 100, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
    capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100000, maxRelativeSpreadPct: 1.5, minBidDepthCoverageMultiple: 2, minAskDepthCoverageMultiple: 2, allowFallbackDte5To7: false },
  });
  const out = attachH1SelectorRuntime({
    registry,
    policy,
    coordinatorConfig: {
      orderQuantityFor: () => 50,
      greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
      publisherFor: () => ({
        moneyness: "ATM",
        multiExpiryPeers: [],
        premiumPolicy: policy.premiumPolicy!,
        burdenPolicy: policy.burdenPolicy!,
        capitalLiquidityDtePolicy: policy.capitalLiquidityDtePolicy!,
      }),
    },
  });
  assert.equal(out.ready, true);
  assert.ok(out.coordinator);
  assert.deepEqual(out.blockers, []);
});
