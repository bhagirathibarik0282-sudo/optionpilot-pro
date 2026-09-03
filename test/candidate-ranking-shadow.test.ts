import test from "node:test";
import assert from "node:assert/strict";
import { rankCandidateSet } from "../candidate-ranking-shadow.js";

function candidate(overrides: Partial<any> = {}) {
  return {
    symbol: "NIFTY",
    side: "CE",
    strike: 24000,
    expiryDate: "2026-09-03",
    dte: 0,
    moneyness: "ATM",
    premiumLtp: 120,
    capitalFit: true,
    liquidityOk: true,
    spreadOk: true,
    premiumResponseConfirmed: true,
    deltaGammaResponseConfirmed: true,
    thetaIvBurdenAcceptable: true,
    multiExpiryConflictAbsent: true,
    currentOrNearExpiryUsable: true,
    higherDteUsable: false,
    ...overrides,
  };
}

test("ranks eligible candidates deterministically without execution authority", () => {
  const result = rankCandidateSet([
    {
      candidate: candidate({ strike: 24000 }),
      evidence: { temporalConfidencePct: 90, premiumEfficiencyPct: 90, liquidityQualityPct: 85, crossDteAgreementPct: 80 },
    },
    {
      candidate: candidate({ strike: 24050 }),
      evidence: { temporalConfidencePct: 75, premiumEfficiencyPct: 70, liquidityQualityPct: 80, crossDteAgreementPct: 70 },
    },
  ]);

  assert.equal(result.ranked[0].rank, 1);
  assert.equal(result.ranked[1].rank, 2);
  assert.equal(result.bestCandidateKey, result.ranked[0].candidateKey);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.createsOrders, false);
  assert.equal(result.aiMayOverride, false);
});

test("never promotes a hard-selector blocked candidate", () => {
  const result = rankCandidateSet([
    {
      candidate: candidate({ liquidityOk: false }),
      evidence: { temporalConfidencePct: 100, premiumEfficiencyPct: 100, liquidityQualityPct: 100, crossDteAgreementPct: 100 },
    },
  ]);

  assert.equal(result.ranked[0].eligible, false);
  assert.equal(result.ranked[0].rank, null);
  assert.equal(result.bestCandidateKey, null);
  assert.ok(result.ranked[0].reasons.includes("HARD_SELECTOR_BLOCK"));
});

test("fails closed when ranking evidence coverage is too low", () => {
  const result = rankCandidateSet([
    {
      candidate: candidate(),
      evidence: { temporalConfidencePct: 90 },
    },
  ]);

  assert.equal(result.ranked[0].eligible, false);
  assert.equal(result.bestCandidateKey, null);
  assert.ok(result.ranked[0].reasons.includes("RANKING_EVIDENCE_BELOW_50_PERCENT_WEIGHT"));
});
