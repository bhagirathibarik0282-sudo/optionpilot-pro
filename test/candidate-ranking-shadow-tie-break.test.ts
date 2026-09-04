import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.js";

function makeCandidate(strike: number) {
  return {
    candidate: {
      symbol: "NIFTY",
      side: "CE",
      strike,
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
      premiumEfficiencyPct: 80,
      liquidityQualityPct: 80,
      crossDteAgreementPct: 80
    }
  };
}

async function evaluate(candidates: unknown[]) {
  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates }),
  });
  assert.equal(response.status, 200);
  return await response.json() as {
    ok: boolean;
    productionImpact: string;
    result: {
      bestCandidateKey: string | null;
      ranked: Array<{ candidateKey: string; eligible: boolean; score: number; rank: number | null }>;
    };
    safety: {
      readOnly: boolean;
      databaseWrites: boolean;
      telegramWrites: boolean;
      executionAuthority: boolean;
      createsOrders: boolean;
    };
  };
}

test("equal-score eligible candidates use deterministic candidateKey tie-break independent of input order", async () => {
  const a = makeCandidate(24000);
  const b = makeCandidate(24050);

  const forward = await evaluate([a, b]);
  const reverse = await evaluate([b, a]);

  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  assert.equal(forward.productionImpact, "NONE");
  assert.equal(reverse.productionImpact, "NONE");

  const forwardRows = forward.result.ranked.filter((row) => row.eligible);
  const reverseRows = reverse.result.ranked.filter((row) => row.eligible);
  assert.equal(forwardRows.length, 2);
  assert.equal(reverseRows.length, 2);
  assert.equal(forwardRows[0]?.score, forwardRows[1]?.score);
  assert.equal(reverseRows[0]?.score, reverseRows[1]?.score);

  const keys = forwardRows.map((row) => row.candidateKey).sort((x, y) => x.localeCompare(y));
  assert.equal(forward.result.bestCandidateKey, keys[0]);
  assert.equal(reverse.result.bestCandidateKey, keys[0]);

  const forwardRanks = new Map(forwardRows.map((row) => [row.candidateKey, row.rank]));
  const reverseRanks = new Map(reverseRows.map((row) => [row.candidateKey, row.rank]));
  assert.deepEqual([...forwardRanks.entries()].sort(), [...reverseRanks.entries()].sort());
  assert.equal(forwardRanks.get(keys[0]), 1);
  assert.equal(forwardRanks.get(keys[1]), 2);

  for (const body of [forward, reverse]) {
    assert.equal(body.safety.readOnly, true);
    assert.equal(body.safety.databaseWrites, false);
    assert.equal(body.safety.telegramWrites, false);
    assert.equal(body.safety.executionAuthority, false);
    assert.equal(body.safety.createsOrders, false);
  }
});
