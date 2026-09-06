import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessForwardJournal, appendForwardOutcome } from "../business-forward-journal-v1.ts";
import { computeBusinessForwardKpis } from "../business-forward-kpi-v1.ts";

function completedJournal() {
  const made = createBusinessForwardJournal({
    decisionId: "D1",
    snapshotId: "S1",
    observedAtMs: 1_000,
    selectedCandidateKey: "A",
    eligibleCandidates: [
      { candidateKey: "A", symbol: "NIFTY", optionSide: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, premiumLtp: 100 },
      { candidateKey: "B", symbol: "NIFTY", optionSide: "CE", strike: 24150, expiryDate: "2026-09-08", dte: 1, premiumLtp: 80 },
      { candidateKey: "C", symbol: "NIFTY", optionSide: "CE", strike: 24200, expiryDate: "2026-09-08", dte: 1, premiumLtp: 60 },
    ],
  });
  assert.equal(made.ready, true);

  let record = made.record!;
  for (const point of [
    { window: "T_PLUS_3M" as const, observedAtMs: 181_000, premiumByCandidateKey: { A: 110, B: 96, C: 54 } },
    { window: "T_PLUS_6M" as const, observedAtMs: 361_000, premiumByCandidateKey: { A: 95, B: 104, C: 66 } },
    { window: "T_PLUS_15M" as const, observedAtMs: 901_000, premiumByCandidateKey: { A: 120, B: 112, C: 72 } },
  ]) {
    const next = appendForwardOutcome(record, point);
    assert.equal(next.ready, true);
    record = next.record!;
  }
  return record;
}

test("computes MFE MAE and selected-vs-best regret without gaining authority", () => {
  const out = computeBusinessForwardKpis(completedJournal());
  assert.equal(out.ready, true);
  assert.equal(out.sampleCandidateCount, 3);
  assert.equal(out.terminalWindow, "T_PLUS_15M");
  assert.equal(out.bestCandidateKeyByTerminalReturn, "B");
  assert.equal(out.selectedCandidateKey, "A");
  assert.equal(out.selectedRank, 2);
  assert.equal(out.selectedRankPercentile, 50);
  assert.equal(out.selectionRegretPct, 20);

  const a = out.candidateKpis.find((x) => x.candidateKey === "A")!;
  assert.equal(a.mfePct, 20);
  assert.equal(a.maePct, -5);

  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsStars, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("does not fabricate selected quality when no upstream selected candidate exists", () => {
  const made = createBusinessForwardJournal({
    decisionId: "D2",
    snapshotId: "S2",
    observedAtMs: 1_000,
    selectedCandidateKey: null,
    eligibleCandidates: [
      { candidateKey: "A", symbol: "NIFTY", optionSide: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, premiumLtp: 100 },
    ],
  });
  const next = appendForwardOutcome(made.record!, {
    window: "T_PLUS_3M",
    observedAtMs: 181_000,
    premiumByCandidateKey: { A: 110 },
  });
  const out = computeBusinessForwardKpis(next.record!);
  assert.equal(out.ready, true);
  assert.equal(out.bestCandidateKeyByTerminalReturn, "A");
  assert.equal(out.selectedCandidateKey, null);
  assert.equal(out.selectedRank, null);
  assert.equal(out.selectedRankPercentile, null);
  assert.equal(out.selectionRegretPct, null);
});

test("fails closed before any forward outcome exists", () => {
  const made = createBusinessForwardJournal({
    decisionId: "D3",
    snapshotId: "S3",
    observedAtMs: 1_000,
    selectedCandidateKey: null,
    eligibleCandidates: [
      { candidateKey: "A", symbol: "NIFTY", optionSide: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, premiumLtp: 100 },
    ],
  });
  const out = computeBusinessForwardKpis(made.record!);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("FORWARD_OUTCOMES_REQUIRED"));
});
