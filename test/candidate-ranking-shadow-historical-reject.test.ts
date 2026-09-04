import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.js";

function makeCandidate() {
  return {
    candidate: {
      symbol: "NIFTY",
      side: "CE",
      strike: 24000,
      expiryDate: "2026-09-08",
      dte: 4,
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
      higherDteUsable: false
    },
    evidence: {
      temporalConfidencePct: 100,
      premiumEfficiencyPct: 100,
      liquidityQualityPct: 100,
      crossDteAgreementPct: 100,
      historicalQuality: {
        grade: "REJECT"
      }
    }
  };
}

test("historical REJECT remains ineligible despite perfect live evidence through router", async () => {
  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: [makeCandidate()] }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: boolean;
    productionImpact: string;
    result: {
      bestCandidateKey: string | null;
      ranked: Array<{
        eligible: boolean;
        score: number;
        rank: number | null;
        reasons: string[];
      }>;
    };
    safety: {
      readOnly: boolean;
      databaseWrites: boolean;
      telegramWrites: boolean;
      executionAuthority: boolean;
      createsOrders: boolean;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.result.bestCandidateKey, null);
  assert.equal(body.result.ranked.length, 1);
  assert.equal(body.result.ranked[0]?.eligible, false);
  assert.equal(body.result.ranked[0]?.score, 0);
  assert.equal(body.result.ranked[0]?.rank, null);
  assert.ok(body.result.ranked[0]?.reasons.includes("HISTORICAL_QUALITY_REJECT"));
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});
