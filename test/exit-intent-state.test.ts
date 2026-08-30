import test from "node:test";
import assert from "node:assert/strict";
import { buildExitIdempotencyKey, evaluateExitIntentState } from "../exit-intent-state.js";

const contract = { index: "NIFTY" as const, optionType: "CE" as const, strike: 25000, expiry: "2026-09-03", instrumentToken: 12345 };

function good(overrides: Record<string, unknown> = {}) {
  return {
    tradeId: "TRADE-4O-1",
    contract,
    existingState: "NONE" as const,
    existingReason: null,
    requestedReason: "NORMAL" as const,
    authoritativeOpenQty: 50,
    confirmedExitQty: 0,
    stateFresh: true,
    identityConsistent: true,
    ...overrides,
  } as any;
}

test("builds stable exit key without timestamp or exit reason", () => {
  const a = buildExitIdempotencyKey("TRADE-4O-1", contract);
  const b = buildExitIdempotencyKey("TRADE-4O-1", { ...contract });
  assert.equal(a, b);
  assert.equal(a, "EXIT:TRADE-4O-1:NIFTY:CE:25000:2026-09-03:12345");
});

test("creates one exit intent for current authoritative open quantity", () => {
  const d = evaluateExitIntentState(good());
  assert.equal(d.decision, "CREATE_INTENT");
  assert.equal(d.nextState, "REQUESTED");
  assert.equal(d.requestedExitQty, 50);
  assert.equal(d.residualQty, 50);
  assert.equal(d.placesOrder, false);
  assert.equal(d.shadowOnly, true);
  assert.equal(d.newEntriesAllowed, false);
});

test("pending duplicate reuses existing intent and requests no second order", () => {
  const d = evaluateExitIntentState(good({ existingState: "PENDING", existingReason: "HARD_SL", requestedReason: "RUNNER_TSL" }));
  assert.equal(d.decision, "REUSE_INTENT");
  assert.equal(d.requestedExitQty, 0);
  assert.equal(d.duplicateBlocked, true);
});

test("emergency escalates the same pending intent without creating a second intent", () => {
  const d = evaluateExitIntentState(good({ existingState: "PENDING", existingReason: "RUNNER_TSL", requestedReason: "EMERGENCY" }));
  assert.equal(d.decision, "ESCALATE_EXISTING");
  assert.equal(d.effectiveReason, "EMERGENCY");
  assert.equal(d.requestedExitQty, 0);
  assert.equal(d.nextState, "PENDING");
});

test("partial exit reuses same intent and requests only authoritative residual", () => {
  const d = evaluateExitIntentState(good({ existingState: "PARTIAL", existingReason: "NORMAL", authoritativeOpenQty: 25, confirmedExitQty: 25 }));
  assert.equal(d.decision, "REUSE_INTENT");
  assert.equal(d.requestedExitQty, 25);
  assert.equal(d.residualQty, 25);
});

test("does not double subtract confirmed exit quantity from authoritative open quantity", () => {
  const d = evaluateExitIntentState(good({ existingState: "PARTIAL", existingReason: "NORMAL", authoritativeOpenQty: 25, confirmedExitQty: 25 }));
  assert.equal(d.residualQty, 25);
  assert.notEqual(d.decision, "COMPLETE");
});

test("zero authoritative open quantity closes without new exit intent", () => {
  const d = evaluateExitIntentState(good({ authoritativeOpenQty: 0, confirmedExitQty: 50, existingState: "PENDING", existingReason: "HARD_SL" }));
  assert.equal(d.decision, "COMPLETE");
  assert.equal(d.nextState, "COMPLETE");
  assert.equal(d.requestedExitQty, 0);
});

test("complete state with authoritative open quantity halts", () => {
  const d = evaluateExitIntentState(good({ existingState: "COMPLETE", existingReason: "HARD_SL", authoritativeOpenQty: 10 }));
  assert.equal(d.decision, "BLOCK");
  assert.equal(d.nextState, "HALT");
});

test("cancelled or rejected exit reconciles before any retry", () => {
  for (const state of ["CANCELLED", "REJECTED"] as const) {
    const d = evaluateExitIntentState(good({ existingState: state, existingReason: "HARD_SL" }));
    assert.equal(d.decision, "RECONCILE");
    assert.equal(d.requestedExitQty, 0);
  }
});

test("stale state and contract mismatch fail closed", () => {
  assert.equal(evaluateExitIntentState(good({ stateFresh: false })).nextState, "HALT");
  assert.equal(evaluateExitIntentState(good({ identityConsistent: false })).nextState, "HALT");
});

test("invalid quantities fail closed", () => {
  assert.equal(evaluateExitIntentState(good({ authoritativeOpenQty: -1 })).decision, "BLOCK");
  assert.equal(evaluateExitIntentState(good({ confirmedExitQty: 1.5 })).decision, "BLOCK");
});
