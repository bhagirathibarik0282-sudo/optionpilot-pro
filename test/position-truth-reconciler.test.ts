import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePositionTruth } from "../position-truth-reconciler.js";

const contract = { index: "NIFTY" as const, optionType: "CE" as const, strike: 25000, expiry: "2026-09-03", instrumentToken: "12345" };
const good = {
  executionMode: "SHADOW" as const,
  contract,
  identityConsistent: true,
  stateFresh: true,
  authoritativeFilledQty: 50,
  authoritativeExitedQty: 0,
  ledgerRemainingQty: 50,
  evidenceRemainingQty: 50,
};

test("matches exact open-position truth", () => {
  const r = reconcilePositionTruth(good);
  assert.equal(r.decision, "MATCH");
  assert.equal(r.authoritativeOpenQty, 50);
  assert.equal(r.protectQty, 50);
  assert.equal(r.newEntriesAllowed, false);
  assert.equal(r.blindExitAllowed, false);
  assert.equal(r.brokerOrderAllowed, false);
});

test("matches exact flat truth and allows new-entry eligibility only locally", () => {
  const r = reconcilePositionTruth({ ...good, authoritativeFilledQty: 50, authoritativeExitedQty: 50, ledgerRemainingQty: 0, evidenceRemainingQty: 0 });
  assert.equal(r.decision, "MATCH");
  assert.equal(r.authoritativeOpenQty, 0);
  assert.equal(r.newEntriesAllowed, true);
});

test("ledger or evidence mismatch requires reconciliation", () => {
  const r = reconcilePositionTruth({ ...good, evidenceRemainingQty: 40 });
  assert.equal(r.decision, "RECONCILE");
  assert.equal(r.authoritativeOpenQty, 50);
  assert.equal(r.newEntriesAllowed, false);
});

test("authoritative open position missing internally is critical unmanaged position", () => {
  const r = reconcilePositionTruth({ ...good, ledgerRemainingQty: 0, evidenceRemainingQty: 0 });
  assert.equal(r.decision, "CRITICAL_UNMANAGED_POSITION");
  assert.equal(r.protectQty, 50);
  assert.equal(r.newEntriesAllowed, false);
});

test("authoritative zero with internal quantity reconciles and never blind exits", () => {
  const r = reconcilePositionTruth({ ...good, authoritativeExitedQty: 50, ledgerRemainingQty: 50, evidenceRemainingQty: 50 });
  assert.equal(r.decision, "RECONCILE");
  assert.equal(r.authoritativeOpenQty, 0);
  assert.equal(r.blindExitAllowed, false);
});

test("identity mismatch halts fail-closed", () => {
  const r = reconcilePositionTruth({ ...good, identityConsistent: false });
  assert.equal(r.decision, "HALT");
  assert.equal(r.authoritativeOpenQty, null);
  assert.equal(r.newEntriesAllowed, false);
});

test("stale authoritative state halts fail-closed", () => {
  const r = reconcilePositionTruth({ ...good, stateFresh: false });
  assert.equal(r.decision, "HALT");
});

test("exited quantity cannot exceed filled quantity", () => {
  const r = reconcilePositionTruth({ ...good, authoritativeExitedQty: 51 });
  assert.equal(r.decision, "HALT");
  assert.ok(r.reasonCodes.includes("EXITED_QTY_EXCEEDS_FILLED_QTY"));
});

test("invalid negative or fractional quantities halt", () => {
  assert.equal(reconcilePositionTruth({ ...good, ledgerRemainingQty: -1 }).decision, "HALT");
  assert.equal(reconcilePositionTruth({ ...good, authoritativeFilledQty: 50.5 }).decision, "HALT");
});

test("invalid contract identity halts", () => {
  const badContract = { ...contract, strike: 0 };
  const r = reconcilePositionTruth({ ...good, contract: badContract });
  assert.equal(r.decision, "HALT");
});
