import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.js";

test("candidate ranking shadow status route is mounted and read-only", async () => {
  const response = await researchRouter.request("/candidate-ranking-shadow/status");
  assert.equal(response.status, 200);

  const body = await response.json() as {
    ok: boolean;
    mode: string;
    productionImpact: string;
    ready: boolean;
    sourceBinding: string;
    maxCandidates: number;
    safety: {
      readOnly: boolean;
      databaseWrites: boolean;
      telegramWrites: boolean;
      executionAuthority: boolean;
      createsOrders: boolean;
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.mode, "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1");
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.ready, true);
  assert.equal(body.sourceBinding, "CALLER_SUPPLIED_CANDIDATE_POOL");
  assert.equal(body.maxCandidates, 50);
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("candidate ranking shadow evaluate route fails closed on invalid input", async () => {
  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);

  const body = await response.json() as {
    ok: boolean;
    mode: string;
    productionImpact: string;
    reason: string;
    candidateCount: number;
    safety: {
      readOnly: boolean;
      databaseWrites: boolean;
      telegramWrites: boolean;
      executionAuthority: boolean;
      createsOrders: boolean;
    };
  };

  assert.equal(body.ok, false);
  assert.equal(body.mode, "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1");
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.reason, "CANDIDATE_ARRAY_REQUIRED");
  assert.equal(body.candidateCount, 0);
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("candidate ranking shadow evaluate route rejects oversized caller pool", async () => {
  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: Array.from({ length: 51 }, () => ({})) }),
  });
  assert.equal(response.status, 400);

  const body = await response.json() as {
    ok: boolean;
    productionImpact: string;
    reason: string;
    candidateCount: number;
    safety: {
      executionAuthority: boolean;
      createsOrders: boolean;
    };
  };

  assert.equal(body.ok, false);
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.reason, "CANDIDATE_COUNT_OUT_OF_RANGE_1_50");
  assert.equal(body.candidateCount, 51);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("candidate ranking shadow evaluate route ranks a valid caller candidate without authority", async () => {
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
      premiumEfficiencyPct: 75,
      liquidityQualityPct: 90,
      crossDteAgreementPct: 70
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
    candidateCount: number;
    result: { ranked: Array<{ eligible: boolean; rank: number }> };
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
  assert.equal(body.candidateCount, 1);
  assert.equal(body.result.ranked[0]?.eligible, true);
  assert.equal(body.result.ranked[0]?.rank, 1);
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("candidate ranking router keeps hard-blocked candidate below eligible candidate", async () => {
  const baseCandidate = {
    symbol: "NIFTY",
    side: "CE",
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
  };

  const eligible = {
    candidate: { ...baseCandidate, strike: 24000 },
    evidence: {
      temporalConfidencePct: 80,
      premiumEfficiencyPct: 78,
      liquidityQualityPct: 82,
      crossDteAgreementPct: 76
    }
  };

  const blocked = {
    candidate: { ...baseCandidate, strike: 24050, liquidityOk: false },
    evidence: {
      temporalConfidencePct: 100,
      premiumEfficiencyPct: 100,
      liquidityQualityPct: 100,
      crossDteAgreementPct: 100
    }
  };

  const response = await researchRouter.request("/candidate-ranking-shadow/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: [blocked, eligible] }),
  });
  assert.equal(response.status, 200);

  const body = await response.json() as {
    ok: boolean;
    productionImpact: string;
    candidateCount: number;
    result: {
      bestCandidateKey: string | null;
      ranked: Array<{
        candidateKey: string;
        eligible: boolean;
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
  assert.equal(body.candidateCount, 2);
  const eligibleRow = body.result.ranked.find((row) => row.eligible);
  const blockedRow = body.result.ranked.find((row) => !row.eligible);
  assert.equal(eligibleRow?.rank, 1);
  assert.equal(body.result.bestCandidateKey, eligibleRow?.candidateKey);
  assert.equal(blockedRow?.rank, null);
  assert.ok(blockedRow?.reasons.includes("HARD_SELECTOR_BLOCK"));
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.databaseWrites, false);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("candidate ranking router order is invariant to caller candidate order", async () => {
  const baseCandidate = {
    symbol: "NIFTY",
    side: "CE",
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
  };

  const stronger = {
    candidate: { ...baseCandidate, strike: 24000 },
    evidence: {
      temporalConfidencePct: 92,
      premiumEfficiencyPct: 90,
      liquidityQualityPct: 94,
      crossDteAgreementPct: 88
    }
  };

  const weaker = {
    candidate: { ...baseCandidate, strike: 24050 },
    evidence: {
      temporalConfidencePct: 70,
      premiumEfficiencyPct: 68,
      liquidityQualityPct: 72,
      crossDteAgreementPct: 66
    }
  };

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
        ranked: Array<{ candidateKey: string; eligible: boolean; rank: number | null }>;
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

  const forward = await evaluate([stronger, weaker]);
  const reverse = await evaluate([weaker, stronger]);

  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  assert.equal(forward.productionImpact, "NONE");
  assert.equal(reverse.productionImpact, "NONE");
  assert.equal(forward.result.bestCandidateKey, reverse.result.bestCandidateKey);

  const forwardRanks = new Map(forward.result.ranked.map((row) => [row.candidateKey, row.rank]));
  const reverseRanks = new Map(reverse.result.ranked.map((row) => [row.candidateKey, row.rank]));
  assert.deepEqual([...forwardRanks.entries()].sort(), [...reverseRanks.entries()].sort());
  assert.equal(forwardRanks.get(forward.result.bestCandidateKey ?? ""), 1);
  assert.equal(reverseRanks.get(reverse.result.bestCandidateKey ?? ""), 1);
  assert.equal(forward.safety.readOnly, true);
  assert.equal(reverse.safety.readOnly, true);
  assert.equal(forward.safety.databaseWrites, false);
  assert.equal(reverse.safety.databaseWrites, false);
  assert.equal(forward.safety.telegramWrites, false);
  assert.equal(reverse.safety.telegramWrites, false);
  assert.equal(forward.safety.executionAuthority, false);
  assert.equal(reverse.safety.executionAuthority, false);
  assert.equal(forward.safety.createsOrders, false);
  assert.equal(reverse.safety.createsOrders, false);
});
