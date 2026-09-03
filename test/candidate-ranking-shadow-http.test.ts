import test from "node:test";
import assert from "node:assert/strict";
import { candidateRankingShadowRuntimeStatus, evaluateCandidateRankingShadowHttp } from "../candidate-ranking-shadow-http.js";

function validCandidate() {
  return {
    candidate: {
      symbol: "NIFTY" as const,
      side: "CE" as const,
      strike: 24000,
      expiryDate: "2026-09-03",
      dte: 0,
      moneyness: "ATM" as const,
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
    },
    evidence: {
      temporalConfidencePct: 80,
      premiumEfficiencyPct: 75,
      liquidityQualityPct: 90,
      crossDteAgreementPct: 70,
    },
  };
}

test("read-only adapter rejects missing candidate array", () => {
  const result = evaluateCandidateRankingShadowHttp({});
  assert.equal(result.ok, false);
  assert.equal(result.reason, "CANDIDATE_ARRAY_REQUIRED");
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.safety.createsOrders, false);
});

test("read-only adapter evaluates valid candidate without execution authority", () => {
  const result = evaluateCandidateRankingShadowHttp({ candidates: [validCandidate()] });
  assert.equal(result.ok, true);
  assert.equal(result.result?.ranked[0]?.eligible, true);
  assert.equal(result.result?.ranked[0]?.rank, 1);
  assert.equal(result.safety.executionAuthority, false);
  assert.equal(result.safety.databaseWrites, false);
  assert.equal(result.safety.telegramWrites, false);
});

test("hard selector block remains blocked through HTTP adapter", () => {
  const blocked = validCandidate();
  blocked.candidate.liquidityOk = false;
  const result = evaluateCandidateRankingShadowHttp({ candidates: [blocked] });
  assert.equal(result.ok, true);
  assert.equal(result.result?.ranked[0]?.eligible, false);
  assert.ok(result.result?.ranked[0]?.reasons.includes("HARD_SELECTOR_BLOCK"));
});

test("runtime status exposes caller-supplied source binding and no authority", () => {
  const status = candidateRankingShadowRuntimeStatus();
  assert.equal(status.ready, true);
  assert.equal(status.sourceBinding, "CALLER_SUPPLIED_CANDIDATE_POOL");
  assert.equal(status.safety.readOnly, true);
  assert.equal(status.safety.createsOrders, false);
});
