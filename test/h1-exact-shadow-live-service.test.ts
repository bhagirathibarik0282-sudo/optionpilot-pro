import assert from "node:assert/strict";
import test from "node:test";
import { readH1ExactShadowLiveConfig } from "../h1-exact-shadow-live-service.js";

const registry = [
  { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
  { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
];

function policy(requiredPeerCount = 1, token = 111) {
  return {
    contracts: [{ instrumentToken: token, moneyness: "ATM", orderQuantity: 150 }],
    greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5000, maxUnderlyingSkewMs: 2000 },
    premiumPolicy: { maxObservationGapMs: 10000, minPremiumMovePct: 0, minAbsoluteDeltaChange: 0, minCurrentGamma: 0 },
    burdenPolicy: { maxObservationAgeMs: 30000, maxAbsThetaPctOfPremium: 1000, minIv: 0, maxIv: 500, requiredPeerCount, maxConflictingPeerCount: 0 },
    capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100000, maxRelativeSpreadPct: 20, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
  };
}

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    KITE_H1_EXACT_SHADOW_ENABLED: "true",
    KITE_RUNTIME_SHADOW_ENABLED: "false",
    KITE_API_KEY: "k",
    KITE_SHADOW_REGISTRY_JSON: JSON.stringify(registry),
    KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy()),
    ...overrides,
  };
}

test("disabled exact shadow service is inert", () => {
  const cfg = readH1ExactShadowLiveConfig({ KITE_H1_EXACT_SHADOW_ENABLED: "false" });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.policy, null);
  assert.deepEqual(cfg.registryEntries, []);
});

test("old and exact Kite shadow services cannot be enabled together", () => {
  assert.throws(() => readH1ExactShadowLiveConfig(env({ KITE_RUNTIME_SHADOW_ENABLED: "true" })), /DUPLICATE_SHADOW_RUNTIME_FORBIDDEN/);
});

test("enabled exact shadow service requires explicit registry and policy", () => {
  assert.throws(() => readH1ExactShadowLiveConfig(env({ KITE_SHADOW_REGISTRY_JSON: "" })), /REGISTRY_JSON_REQUIRED/);
  assert.throws(() => readH1ExactShadowLiveConfig(env({ KITE_H1_EXACT_POLICY_JSON: "" })), /POLICY_JSON_REQUIRED/);
});

test("valid explicit policy and registry are accepted without exposing authority", () => {
  const cfg = readH1ExactShadowLiveConfig(env());
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.apiKey, "k");
  assert.equal(cfg.registryEntries.length, 2);
  assert.equal(cfg.policy?.contracts[0].orderQuantity, 150);
});

test("multi-expiry evidence cannot be silently disabled", () => {
  assert.throws(() => readH1ExactShadowLiveConfig(env({
    KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy(0)),
  })), /BURDEN_POLICY_INVALID/);
});

test("contract policy must reference the canonical token registry", () => {
  assert.throws(() => readH1ExactShadowLiveConfig(env({
    KITE_H1_EXACT_POLICY_JSON: JSON.stringify(policy(1, 999)),
  })), /CONTRACT_NOT_IN_REGISTRY/);
});
