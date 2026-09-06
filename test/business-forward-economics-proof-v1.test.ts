import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessForwardJournal } from "../business-forward-journal-v1.ts";
import { attachExactEconomicsToForwardJournal } from "../business-forward-economics-proof-v1.ts";

function journal() {
  const made = createBusinessForwardJournal({
    decisionId: "D1",
    snapshotId: "S1",
    observedAtMs: Date.parse("2026-09-07T09:31:00.000+05:30"),
    selectedCandidateKey: null,
    eligibleCandidates: [{
      candidateKey: "NIFTY:CE:24100:2026-09-08:DTE1:ATM",
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 24100,
      expiryDate: "2026-09-08",
      dte: 1,
      premiumLtp: 110,
    }],
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function economics(observedAt = "2026-09-07T09:31:00.000+05:30") {
  return {
    version: "BUSINESS_EXACT_ECONOMICS_V1" as const,
    ready: true,
    candidateKey: "NIFTY:CE:24100:2026-09-08:DTE1",
    observedAt,
    premiumMovePct: 10,
    thetaBurdenPctOfPremium: 2.2,
    relativeSpreadPct: 1.8,
    bidDepthCoverageMultiple: 6,
    askDepthCoverageMultiple: 2,
    depthImbalance: 0.5,
    microprice: 110.5,
    midprice: 110,
    micropricePressure: 0.5,
    blockers: [],
    semantics: "RESEARCH_SHADOW_ONLY" as const,
    affectsVerdict: false as const,
    affectsStars: false as const,
    affectsCandidateAuthority: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
    createsOrders: false as const,
    failClosed: true as const,
  };
}

test("attaches exact same-contract economics to T0 candidate without authority", () => {
  const out = attachExactEconomicsToForwardJournal(journal(), [economics()]);
  assert.equal(out.ready, true);
  const row = out.economicsByCandidateKey["NIFTY:CE:24100:2026-09-08:DTE1:ATM"];
  assert.equal(row.contractKey, "NIFTY:CE:24100:2026-09-08:DTE1");
  assert.equal(row.premiumMovePct, 10);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsStars, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("rejects future economics to prevent T0 lookahead", () => {
  const out = attachExactEconomicsToForwardJournal(journal(), [economics("2026-09-07T09:31:01.000+05:30")]);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("ECONOMICS_AFTER_T0:NIFTY:CE:24100:2026-09-08:DTE1:ATM"));
});

test("fails closed when exact economics does not match frozen T0 candidates", () => {
  const row = economics();
  row.candidateKey = "NIFTY:CE:24200:2026-09-08:DTE1";
  const out = attachExactEconomicsToForwardJournal(journal(), [row]);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("NO_T0_CANDIDATE_ECONOMICS_MATCH"));
});
