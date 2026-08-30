import test from "node:test";
import assert from "node:assert/strict";
import { reconcileBrokerOrder } from "../broker-order-reconciliation.ts";

const base = {
  brokerConnected: true,
  expectedQty: 100,
  filledQty: 0,
  pendingQty: 100,
  brokerStatus: "OPEN" as const,
  hasDuplicateResidualIntent: false,
  orderStateFresh: true,
};

test("working order blocks new entry", () => {
  const r = reconcileBrokerOrder(base);
  assert.equal(r.decision, "RECONCILE");
  assert.equal(r.allowNewEntry, false);
});

test("partial fill protects filled quantity", () => {
  const r = reconcileBrokerOrder({ ...base, brokerStatus: "PARTIAL", filledQty: 40, pendingQty: 0 });
  assert.equal(r.decision, "RECONCILE");
  assert.equal(r.residualQty, 60);
  assert.equal(r.protectFilledQty, 40);
  assert.equal(r.allowResidualIntent, true);
});

test("duplicate residual intent halts", () => {
  const r = reconcileBrokerOrder({ ...base, brokerStatus: "PARTIAL", filledQty: 40, pendingQty: 0, hasDuplicateResidualIntent: true });
  assert.equal(r.decision, "HALT");
});

test("disconnect halts", () => {
  const r = reconcileBrokerOrder({ ...base, brokerConnected: false });
  assert.equal(r.decision, "HALT");
});

test("unknown order state halts", () => {
  const r = reconcileBrokerOrder({ ...base, brokerStatus: "UNKNOWN" });
  assert.equal(r.decision, "HALT");
});

test("stale broker state halts", () => {
  const r = reconcileBrokerOrder({ ...base, orderStateFresh: false });
  assert.equal(r.decision, "HALT");
});

test("complete order must exactly match expected quantity", () => {
  const good = reconcileBrokerOrder({ ...base, brokerStatus: "COMPLETE", filledQty: 100, pendingQty: 0 });
  assert.equal(good.decision, "OK");
  const bad = reconcileBrokerOrder({ ...base, brokerStatus: "COMPLETE", filledQty: 90, pendingQty: 0 });
  assert.equal(bad.decision, "HALT");
});

test("quantity mismatch halts", () => {
  const r = reconcileBrokerOrder({ ...base, filledQty: 80, pendingQty: 30 });
  assert.equal(r.decision, "HALT");
});

test("cancelled with partial fill requires reconciliation", () => {
  const r = reconcileBrokerOrder({ ...base, brokerStatus: "CANCELLED", filledQty: 25, pendingQty: 0 });
  assert.equal(r.decision, "RECONCILE");
  assert.equal(r.protectFilledQty, 25);
  assert.equal(r.allowNewEntry, false);
});
