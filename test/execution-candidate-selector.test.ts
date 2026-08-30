import test from "node:test";
import assert from "node:assert/strict";
import { selectExecutionCandidate } from "../execution-candidate-selector.ts";

const base = {
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 25000,
  expiryDate: "2026-09-01",
  dte: 2,
  moneyness: "ATM" as const,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
};

test("selects a valid NIFTY scalp candidate", () => {
  const r = selectExecutionCandidate(base);
  assert.equal(r.decision, "SELECT");
  assert.ok(r.candidateKey);
});

test("blocks unsupported moneyness", () => {
  const r = selectExecutionCandidate({ ...base, moneyness: "ATM" as any as "ATM" });
  (r as any);
  const bad = selectExecutionCandidate({ ...base, moneyness: "OTM2" as any });
  assert.equal(bad.decision, "BLOCK");
  assert.ok(bad.reasonCodes.includes("UNSUPPORTED_MONEYNESS"));
});

test("blocks poor liquidity", () => {
  const r = selectExecutionCandidate({ ...base, liquidityOk: false });
  assert.equal(r.decision, "BLOCK");
});

test("blocks bad spread", () => {
  const r = selectExecutionCandidate({ ...base, spreadOk: false });
  assert.ok(r.reasonCodes.includes("SPREAD_GATE_FAILED"));
});

test("blocks absent premium response", () => {
  const r = selectExecutionCandidate({ ...base, premiumResponseConfirmed: false });
  assert.equal(r.decision, "BLOCK");
});

test("blocks delta gamma mismatch", () => {
  const r = selectExecutionCandidate({ ...base, deltaGammaResponseConfirmed: false });
  assert.ok(r.reasonCodes.includes("DELTA_GAMMA_RESPONSE_NOT_CONFIRMED"));
});

test("blocks unacceptable theta IV burden", () => {
  const r = selectExecutionCandidate({ ...base, thetaIvBurdenAcceptable: false });
  assert.equal(r.decision, "BLOCK");
});

test("blocks multi-expiry conflict", () => {
  const r = selectExecutionCandidate({ ...base, multiExpiryConflictAbsent: false });
  assert.ok(r.reasonCodes.includes("MULTI_EXPIRY_CONFLICT_PRESENT"));
});

test("NIFTY requires usable near expiry", () => {
  const r = selectExecutionCandidate({ ...base, currentOrNearExpiryUsable: false });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("NEAR_EXPIRY_NOT_USABLE"));
});

test("BANKNIFTY requires higher DTE usability", () => {
  const r = selectExecutionCandidate({
    ...base,
    symbol: "BANKNIFTY",
    dte: 18,
    currentOrNearExpiryUsable: false,
    higherDteUsable: true,
  });
  assert.equal(r.decision, "SELECT");
});

test("invalid contract identity fails closed", () => {
  const r = selectExecutionCandidate({ ...base, strike: Number.NaN });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.failClosed, true);
});
