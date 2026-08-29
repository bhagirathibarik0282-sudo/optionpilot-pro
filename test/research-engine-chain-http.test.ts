import test from "node:test";
import assert from "node:assert/strict";
import { evaluateResearchEngineChainHttp, researchEngineChainRuntimeStatus } from "../research-engine-chain-http.js";

const valid = {
  probability: {
    status: "READY",
    sampleCount: 20,
    resolvedSamples: 20,
    wins: 12,
    losses: 8,
    censored: 0,
    winRatePct: 60,
    semantics: "TARGET_BEFORE_STOP_OBSERVED_ONLY",
    ruleVersion: "PROBABILITY_ENGINE_V1",
    reason: "MIN_RESOLVED_SAMPLE_REQUIREMENT_MET",
  },
  marketRegime: {
    regime: "TRENDING_UP",
    ready: true,
    reason: "VALIDATED_UP_TREND",
    semantics: "VALIDATED_EVIDENCE_ONLY",
    ruleVersion: "MARKET_REGIME_ENGINE_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  },
  contractIdentityReady: true,
  dataQualityReady: true,
  evidenceFresh: true,
  signalIdentityReady: true,
  risk: {
    entry: 100,
    stop: 80,
    quantity: 10,
    capital: 50000,
    maxAllowedPlannedStopLossPct: 2,
  },
};

test("runtime status exposes shadow-only no-authority contract", () => {
  const status = researchEngineChainRuntimeStatus();
  assert.equal(status.mounted, true);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsTelegram, false);
  assert.equal(status.affectsExecution, false);
});

test("valid explicit payload evaluates the shadow chain", () => {
  const response = evaluateResearchEngineChainHttp(valid);
  assert.equal(response.ok, true);
  assert.equal(response.productionImpact, "NONE");
  assert.equal(response.result?.decision.status, "READY_FOR_RESEARCH_REVIEW");
});

test("missing input fails closed instead of inventing defaults", () => {
  const response = evaluateResearchEngineChainHttp({ ...valid, evidenceFresh: undefined });
  assert.equal(response.ok, false);
  assert.equal(response.reason, "INVALID_RESEARCH_ENGINE_CHAIN_INPUT");
});

test("missing risk object fails closed", () => {
  const response = evaluateResearchEngineChainHttp({ ...valid, risk: null });
  assert.equal(response.ok, false);
  assert.equal(response.reason, "INVALID_RESEARCH_ENGINE_CHAIN_INPUT");
});

test("forged READY probability with inconsistent counts is rejected", () => {
  const response = evaluateResearchEngineChainHttp({
    ...valid,
    probability: { ...valid.probability, sampleCount: 1, resolvedSamples: 20 },
  });
  assert.equal(response.ok, false);
  assert.equal(response.reason, "INVALID_RESEARCH_ENGINE_CHAIN_INPUT");
});

test("forged READY probability with inconsistent win rate is rejected", () => {
  const response = evaluateResearchEngineChainHttp({
    ...valid,
    probability: { ...valid.probability, winRatePct: 99 },
  });
  assert.equal(response.ok, false);
});

test("unknown regime vocabulary and authority drift are rejected", () => {
  const badRegime = evaluateResearchEngineChainHttp({
    ...valid,
    marketRegime: { ...valid.marketRegime, regime: "TREND", affectsVerdict: true },
  });
  assert.equal(badRegime.ok, false);
});

test("regime ready flag must be consistent with regime state", () => {
  const response = evaluateResearchEngineChainHttp({
    ...valid,
    marketRegime: { ...valid.marketRegime, ready: false },
  });
  assert.equal(response.ok, false);
});

test("malformed risk numeric fields are rejected before chain evaluation", () => {
  const response = evaluateResearchEngineChainHttp({
    ...valid,
    risk: { ...valid.risk, capital: "50000" },
  });
  assert.equal(response.ok, false);
});
