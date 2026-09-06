import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessForwardJournal, appendForwardOutcome } from "../business-forward-journal-v1.ts";

const anchor = {
  decisionId: "D1",
  snapshotId: "S1",
  observedAtMs: 1_000,
  selectedCandidateKey: "NIFTY:CE:24100",
  eligibleCandidates: [
    { candidateKey: "NIFTY:CE:24050", symbol: "NIFTY" as const, optionSide: "CE" as const, strike: 24050, expiryDate: "2026-09-08", dte: 1, premiumLtp: 120 },
    { candidateKey: "NIFTY:CE:24100", symbol: "NIFTY" as const, optionSide: "CE" as const, strike: 24100, expiryDate: "2026-09-08", dte: 1, premiumLtp: 95 },
  ],
};

test("freezes T0 candidate universe and never grants authority", () => {
  const made = createBusinessForwardJournal(anchor);
  assert.equal(made.ready, true);
  assert.equal(made.record!.affectsCandidateAuthority, false);
  assert.equal(made.record!.affectsTelegram, false);
  assert.equal(made.record!.affectsExecution, false);
  assert.equal(made.record!.createsOrders, false);
  assert.ok(Object.isFrozen(made.record!.anchor));
});

test("accepts only later outcomes for candidates frozen at T0", () => {
  const made = createBusinessForwardJournal(anchor);
  const next = appendForwardOutcome(made.record!, {
    window: "T_PLUS_3M",
    observedAtMs: 181_000,
    premiumByCandidateKey: { "NIFTY:CE:24050": 128, "NIFTY:CE:24100": 110 },
  });
  assert.equal(next.ready, true);
  assert.equal(next.record!.outcomes.length, 1);

  const bad = appendForwardOutcome(next.record!, {
    window: "T_PLUS_6M",
    observedAtMs: 361_000,
    premiumByCandidateKey: { "NIFTY:CE:24200": 90 },
  });
  assert.equal(bad.ready, false);
  assert.ok(bad.blockers.includes("OUTCOME_CANDIDATE_NOT_IN_T0_SET"));
});

test("blocks duplicate time windows to prevent outcome rewriting", () => {
  const made = createBusinessForwardJournal(anchor);
  const first = appendForwardOutcome(made.record!, {
    window: "T_PLUS_3M",
    observedAtMs: 181_000,
    premiumByCandidateKey: { "NIFTY:CE:24100": 105 },
  });
  const duplicate = appendForwardOutcome(first.record!, {
    window: "T_PLUS_3M",
    observedAtMs: 190_000,
    premiumByCandidateKey: { "NIFTY:CE:24100": 200 },
  });
  assert.equal(duplicate.ready, false);
  assert.ok(duplicate.blockers.includes("DUPLICATE_FORWARD_WINDOW"));
});
