import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.js";

test("hard-selector pass still fails closed when ranking evidence weight is below 50 percent", async () => {
  const candidate = {
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
      temporalConfidencePct: 100
    }
  };

  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: [candidate] }),
  });
  assert.equal(response.status, 200);

  const body = await response.json() as {
    ok: boolean;
    productionImpact: string;
    result: {
      bestCandidateKey: string | null;
      ranked: Array<{
        candidateKey: string | null;
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
  const row = body.result.ranked[0];
  assert.ok(row);
  assert.equal(row.eligible, false);
  assert.equal(row.score, 0);
  assert.equal(row.rank, null);
  assert.ok(row.reasons.includes("HARD_SELECTOR_PASS"));
  assert.ok(row.reasons.includes("RANKING_EVIDENCE_BELOW_50_PERCENT_WEIGHT"));
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("exactly 50 percent ranking evidence is eligible when hard selector passes", async () => {
  const candidate = {
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
      temporalConfidencePct: 80,
      liquidityQualityPct: 80
    }
  };

  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: [candidate] }),
  });
  assert.equal(response.status, 200);

  const body = await response.json() as {
    ok: boolean;
    productionImpact: string;
    result: {
      bestCandidateKey: string | null;
      ranked: Array<{
        candidateKey: string | null;
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
  assert.equal(body.result.ranked.length, 1);
  const row = body.result.ranked[0];
  assert.ok(row);
  assert.equal(row.eligible, true);
  assert.equal(row.score, 80);
  assert.equal(row.rank, 1);
  assert.equal(body.result.bestCandidateKey, row.candidateKey);
  assert.ok(row.reasons.includes("HARD_SELECTOR_PASS"));
  assert.ok(!row.reasons.includes("RANKING_EVIDENCE_BELOW_50_PERCENT_WEIGHT"));
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});
