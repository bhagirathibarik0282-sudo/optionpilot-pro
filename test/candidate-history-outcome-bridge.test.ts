import test from "node:test";
import assert from "node:assert/strict";
import { candidateHistoryFromOutcome, candidateHistoryIdFromOutcome } from "../candidate-history-outcome-bridge.js";
import type { OutcomeRecord } from "../outcome-engine.js";

function outcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    outcomeId: "oc-1",
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
    status: "PENDING",
    evaluatedAt: null,
    outcomeDetail: null,
    tmVersion: "TM_V1",
    planId: "plan-123",
    horizon: "60m",
    observationResolution: "3MIN_LTP_SAMPLED",
    rawRiskDistance: null,
    clampedRiskDistance: null,
    clampApplied: null,
    deltaSource: null,
    marketRegime: null,
    expiryType: null,
    signalType: null,
    maePremium: null,
    mfePremium: null,
    maeR: null,
    mfeR: null,
    ...overrides,
  };
}

test("parallel horizons share one candidate id through planId", () => {
  assert.equal(candidateHistoryIdFromOutcome(outcome({ horizon: "30m" })), "tm-plan:plan-123");
  assert.equal(candidateHistoryIdFromOutcome(outcome({ horizon: "EOD", outcomeId: "oc-2" })), "tm-plan:plan-123");
});

test("maps deterministic signal without fabricating unavailable market fields", () => {
  const row = candidateHistoryFromOutcome(outcome());
  assert.equal(row.status, "OBSERVED");
  assert.equal(row.grade, "UNAVAILABLE");
  assert.equal(row.expiry, null);
  assert.equal(row.iv, null);
  assert.equal(row.oi, null);
  assert.equal(row.ltp, 100);
  assert.equal(row.selectionVersion, "CANDIDATE_OUTCOME_BRIDGE_V1|TM_V1");
});

test("incomplete trade identity stays unavailable instead of guessed", () => {
  const row = candidateHistoryFromOutcome(outcome({ side: null, strike: null, entry: null }));
  assert.equal(row.status, "UNAVAILABLE");
  assert.equal(row.side, null);
  assert.equal(row.strike, null);
  assert.equal(row.ltp, null);
  assert.equal(row.reasonCode, "OUTCOME_SIGNAL_IDENTITY_INCOMPLETE");
});

test("falls back to outcome id only when plan id is absent", () => {
  assert.equal(candidateHistoryIdFromOutcome(outcome({ planId: null, outcomeId: "oc-fallback" })), "outcome:oc-fallback");
});
