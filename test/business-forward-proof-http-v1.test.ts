import test from "node:test";
import assert from "node:assert/strict";
import { researchRouter } from "../research-router.ts";
import { createBusinessForwardJournal, appendForwardOutcome } from "../business-forward-journal-v1.ts";

function completedJournal() {
  const made = createBusinessForwardJournal({
    decisionId: "D1",
    snapshotId: "S1",
    observedAtMs: 1_000,
    selectedCandidateKey: "A",
    eligibleCandidates: [
      { candidateKey: "A", symbol: "NIFTY", optionSide: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, premiumLtp: 100 },
      { candidateKey: "B", symbol: "NIFTY", optionSide: "CE", strike: 24150, expiryDate: "2026-09-08", dte: 1, premiumLtp: 80 },
    ],
  });
  let record = made.record!;
  for (const point of [
    { window: "T_PLUS_3M" as const, observedAtMs: 181_000, premiumByCandidateKey: { A: 110, B: 96 } },
    { window: "T_PLUS_6M" as const, observedAtMs: 361_000, premiumByCandidateKey: { A: 95, B: 104 } },
    { window: "T_PLUS_15M" as const, observedAtMs: 901_000, premiumByCandidateKey: { A: 120, B: 112 } },
  ]) {
    const next = appendForwardOutcome(record, point);
    assert.equal(next.ready, true);
    record = next.record!;
  }
  return record;
}

test("forward proof status route is authority-free", async () => {
  const response = await researchRouter.request("/business-forward-proof/status");
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.productionImpact, "NONE");
  assert.equal(body.safety.readOnly, true);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.candidateAuthority, false);
  assert.equal(body.safety.starAuthority, false);
  assert.equal(body.safety.executionAuthority, false);
  assert.equal(body.safety.createsOrders, false);
});

test("one-call proof returns selected-vs-best KPIs without authority", async () => {
  const response = await researchRouter.request("/business-forward-proof/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ journal: completedJournal() }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.kpis.bestCandidateKeyByTerminalReturn, "B");
  assert.equal(body.kpis.selectedCandidateKey, "A");
  assert.equal(body.kpis.selectionRegretPct, 20);
  assert.equal(body.safety.telegramWrites, false);
  assert.equal(body.safety.candidateAuthority, false);
  assert.equal(body.safety.executionAuthority, false);
});

test("fails closed before forward outcomes exist", async () => {
  const made = createBusinessForwardJournal({
    decisionId: "D2",
    snapshotId: "S2",
    observedAtMs: 1_000,
    selectedCandidateKey: null,
    eligibleCandidates: [
      { candidateKey: "A", symbol: "NIFTY", optionSide: "CE", strike: 24100, expiryDate: "2026-09-08", dte: 1, premiumLtp: 100 },
    ],
  });
  const response = await researchRouter.request("/business-forward-proof/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ journal: made.record }),
  });
  assert.equal(response.status, 400);
  const body = await response.json() as any;
  assert.equal(body.ok, false);
  assert.equal(body.reason, "FORWARD_OUTCOMES_REQUIRED");
});
