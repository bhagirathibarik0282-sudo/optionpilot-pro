import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExecutionIdempotencyGate } from "../execution-idempotency-gate.ts";

const base = {
  tradeDate: "2026-08-31",
  sessionKey: "NSE_REGULAR",
  signalFingerprint: "SIG123",
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 25000,
  expiryDate: "2026-09-01",
  existingState: "NONE" as const,
  freshSignalConfirmed: true,
  explicitRetryAllowed: false,
};

test("allows first fresh execution intent", () => {
  const r = evaluateExecutionIdempotencyGate(base);
  assert.equal(r.decision, "ALLOW");
  assert.ok(r.idempotencyKey);
});

test("blocks duplicate pending intent", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, existingState: "PENDING" });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("DUPLICATE_PENDING_INTENT"));
});

test("blocks duplicate accepted intent", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, existingState: "ACCEPTED" });
  assert.equal(r.decision, "BLOCK");
});

test("blocks duplicate filled intent", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, existingState: "FILLED" });
  assert.ok(r.reasonCodes.includes("DUPLICATE_FILLED_INTENT"));
});

test("cancelled retry requires both fresh signal and explicit permission", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, existingState: "CANCELLED", freshSignalConfirmed: false, explicitRetryAllowed: false });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("RETRY_REQUIRES_FRESH_SIGNAL"));
  assert.ok(r.reasonCodes.includes("RETRY_NOT_EXPLICITLY_ALLOWED"));
});

test("rejected intent can retry only with fresh signal and explicit permission", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, existingState: "REJECTED", explicitRetryAllowed: true });
  assert.equal(r.decision, "ALLOW");
});

test("blocks NONE state without fresh signal", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, freshSignalConfirmed: false });
  assert.equal(r.decision, "BLOCK");
});

test("invalid identity fails closed", () => {
  const r = evaluateExecutionIdempotencyGate({ ...base, signalFingerprint: "" });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.failClosed, true);
});
