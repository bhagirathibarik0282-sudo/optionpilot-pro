import test from "node:test";
import assert from "node:assert/strict";
import { getH1SelectorShadowProductionPolicy, H1_SELECTOR_SHADOW_PROFILE_V1 } from "../h1-selector-shadow-profile.js";

test("freezes conservative shadow-only selector profile", () => {
  const out = getH1SelectorShadowProductionPolicy();
  assert.equal(out.selectorPolicy.ready, true);
  assert.equal(out.premiumPolicy.minPremiumMovePct, 2);
  assert.equal(out.premiumPolicy.minAbsoluteDeltaChange, 0.03);
  assert.equal(out.premiumPolicy.minCurrentGamma, 0.001);
  assert.equal(out.burdenPolicy.maxAbsThetaPctOfPremium, 3);
  assert.equal(out.burdenPolicy.minIv, 8);
  assert.equal(out.burdenPolicy.maxIv, 30);
  assert.equal(out.burdenPolicy.requiredPeerCount, 2);
  assert.equal(out.burdenPolicy.maxConflictingPeerCount, 0);
  assert.equal(out.capitalLiquidityDtePolicy.maxCapitalPerTrade, 50000);
  assert.equal(out.capitalLiquidityDtePolicy.maxRelativeSpreadPct, 1.5);
  assert.equal(out.capitalLiquidityDtePolicy.minBidDepthCoverageMultiple, 2);
  assert.equal(out.capitalLiquidityDtePolicy.minAskDepthCoverageMultiple, 2);
  assert.equal(out.capitalLiquidityDtePolicy.allowFallbackDte5To7, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.failClosed, true);
  assert.equal(Object.isFrozen(H1_SELECTOR_SHADOW_PROFILE_V1), true);
});
