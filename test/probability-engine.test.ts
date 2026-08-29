import test from "node:test";
import assert from "node:assert/strict";
import type { OutcomeRecord } from "../outcome-engine.js";
import { computeHistoricalProbability } from "../probability-engine.js";

function outcome(status: OutcomeRecord["status"], overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    outcomeId: `oc-${status}-${Math.random()}`,
    recordedAt: "2026-08-28T09:30:00.000Z",
    recordedAtMs: Date.parse("2026-08-28T09:30:00.000Z"),
    tradingDate: "2026-08-28",
    symbol: "NIFTY",
    verdict: "BUY CE",
    score: 8,
    maxScore: 10,
    confidence: "HIGH",
    side: "CE",
    strike: 25000,
    entry: 100,
    sl: 80,
    t1: 120,
    t2: 140,
    t3: 200,
    signalContributions: null,
    windowMinutes: 60,
    windowEndsAtMs: Date.parse("2026-08-28T10:30:00.000Z"),
    status,
    evaluatedAt: null,
    outcomeDetail: null,
    tmVersion: "TM_V1",
    planId: "plan-1",
    horizon: "60m",
    observationResolution: "3MIN_LTP_SAMPLED",
    rawRiskDistance: null,
    clampedRiskDistance: null,
    clampApplied: null,
    deltaSource: null,
    marketRegime: "TREND",
    expiryType: "WEEKLY",
    signalType: "BUY_CE",
    maePremium: null,
    mfePremium: null,
    maeR: null,
    mfeR: null,
    ...overrides,
  };
}

test("fails closed when horizon is unspecified so parallel plan horizons cannot be mixed", () => {
  const result = computeHistoricalProbability([
    outcome("TARGET_T1_HIT", { horizon: "30m" }),
    outcome("STOP_HIT", { horizon: "60m" }),
  ], { symbol: "NIFTY", side: "CE", minResolvedSamples: 1 });

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.reason, "HORIZON_REQUIRED");
  assert.equal(result.sampleCount, 0);
  assert.equal(result.winRatePct, null);
});

test("fails closed until caller-defined resolved sample minimum is met", () => {
  const result = computeHistoricalProbability([
    outcome("TARGET_T1_HIT"),
    outcome("STOP_HIT"),
  ], { symbol: "NIFTY", side: "CE", horizon: "60m", minResolvedSamples: 3 });

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.winRatePct, null);
  assert.equal(result.resolvedSamples, 2);
});

test("computes observed target-before-stop rate only after sample gate passes", () => {
  const result = computeHistoricalProbability([
    outcome("TARGET_T1_HIT"),
    outcome("TARGET_T2_HIT"),
    outcome("STOP_HIT"),
    outcome("NEITHER_HIT"),
    outcome("PENDING"),
  ], { symbol: "NIFTY", side: "CE", horizon: "60m", minResolvedSamples: 3 });

  assert.equal(result.status, "READY");
  assert.equal(result.wins, 2);
  assert.equal(result.losses, 1);
  assert.equal(result.censored, 2);
  assert.ok(result.winRatePct !== null && Math.abs(result.winRatePct - (200 / 3)) < 1e-12);
});

test("filters like-for-like context without fabricating missing matches", () => {
  const result = computeHistoricalProbability([
    outcome("TARGET_T1_HIT", { marketRegime: "TREND" }),
    outcome("STOP_HIT", { marketRegime: "RANGE" }),
  ], { marketRegime: "TREND", horizon: "60m", minResolvedSamples: 1 });

  assert.equal(result.sampleCount, 1);
  assert.equal(result.wins, 1);
  assert.equal(result.losses, 0);
  assert.equal(result.winRatePct, 100);
});

test("invalid sample requirement never unlocks probability", () => {
  const result = computeHistoricalProbability([
    outcome("TARGET_T1_HIT"),
  ], { horizon: "60m", minResolvedSamples: 0 });

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.winRatePct, null);
});
