import test from "node:test";
import assert from "node:assert/strict";
import { runResearchEngineChain } from "../research-engine-chain.js";

const probabilityReady = {
  status: "READY" as const,
  sampleCount: 20,
  resolvedSamples: 20,
  wins: 12,
  losses: 8,
  censored: 0,
  winRatePct: 60,
  semantics: "TARGET_BEFORE_STOP_OBSERVED_ONLY" as const,
  ruleVersion: "PROBABILITY_ENGINE_V1" as const,
  reason: "MIN_RESOLVED_SAMPLE_REQUIREMENT_MET",
};

const regimeReady = {
  regime: "TRENDING_UP" as const,
  ready: true,
  reason: "VALIDATED_UP_TREND",
  semantics: "VALIDATED_EVIDENCE_ONLY" as const,
  ruleVersion: "MARKET_REGIME_ENGINE_V1" as const,
  affectsVerdict: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
};

const base = {
  probability: probabilityReady,
  marketRegime: regimeReady,
  contractIdentityReady: true,
  dataQualityReady: true,
  evidenceFresh: true,
  signalIdentityReady: true,
  risk: {
    entry: 100,
    stop: 80,
    quantity: 10,
    capital: 50000,
    maxAllowedLossPct: 2,
  },
};

test("propagates all-ready research prerequisites through the full chain", () => {
  const result = runResearchEngineChain(base);
  assert.equal(result.strategy.status, "READY_FOR_RESEARCH");
  assert.equal(result.risk.status, "READY_FOR_RESEARCH");
  assert.equal(result.decision.status, "READY_FOR_RESEARCH_REVIEW");
});

test("historical support unavailable fails closed through downstream gates", () => {
  const result = runResearchEngineChain({
    ...base,
    probability: { ...probabilityReady, status: "DATA_UNAVAILABLE", winRatePct: null, reason: "INSUFFICIENT_RESOLVED_HISTORY" },
  });
  assert.equal(result.strategy.status, "NOT_READY");
  assert.equal(result.risk.status, "NOT_READY");
  assert.equal(result.decision.status, "NOT_READY");
});

test("stale evidence blocks the final decision gate even when upstream readiness is present", () => {
  const result = runResearchEngineChain({ ...base, evidenceFresh: false });
  assert.equal(result.strategy.status, "READY_FOR_RESEARCH");
  assert.equal(result.risk.status, "READY_FOR_RESEARCH");
  assert.equal(result.decision.status, "NOT_READY");
  assert.equal(result.decision.reason, "EVIDENCE_NOT_FRESH");
});

test("shadow chain never gains live authority", () => {
  const result = runResearchEngineChain(base);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.semantics, "RESEARCH_SHADOW_CHAIN_ONLY");
});
