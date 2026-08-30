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
  premiumLtp: 150,
  capitalFit: true,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
};

test("selects a valid NIFTY near-DTE candidate", () => {
  const r = selectExecutionCandidate(base);
  assert.equal(r.decision, "SELECT");
  assert.equal(r.dteBucket, "NEAR_2_4");
});

test("classifies 0-1 DTE as expiry priority bucket", () => {
  const r = selectExecutionCandidate({ ...base, dte: 1 });
  assert.equal(r.decision, "SELECT");
  assert.equal(r.dteBucket, "EXPIRY_0_1");
});

test("5-7 DTE requires explicit fallback approval", () => {
  const r = selectExecutionCandidate({ ...base, dte: 6 });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("FALLBACK_DTE_NOT_APPROVED"));
});

test("5-7 DTE may pass only with fallback approval", () => {
  const r = selectExecutionCandidate({ ...base, dte: 6, fallbackDteApproved: true });
  assert.equal(r.decision, "SELECT");
  assert.equal(r.dteBucket, "FALLBACK_5_7");
});

test("NIFTY above 7 DTE is not a scalp candidate", () => {
  const r = selectExecutionCandidate({ ...base, dte: 8, fallbackDteApproved: true });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("DTE_BUCKET_NOT_ALLOWED"));
});

test("BANKNIFTY accepts higher DTE 10-35 bucket", () => {
  const r = selectExecutionCandidate({
    ...base,
    symbol: "BANKNIFTY",
    dte: 18,
    currentOrNearExpiryUsable: false,
    higherDteUsable: true,
  });
  assert.equal(r.decision, "SELECT");
  assert.equal(r.dteBucket, "BANKNIFTY_HIGHER_10_35");
});

test("BANKNIFTY below 10 DTE is blocked", () => {
  const r = selectExecutionCandidate({
    ...base,
    symbol: "BANKNIFTY",
    dte: 9,
    currentOrNearExpiryUsable: false,
    higherDteUsable: true,
  });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("DTE_BUCKET_NOT_ALLOWED"));
});

test("BANKNIFTY above 35 DTE is blocked", () => {
  const r = selectExecutionCandidate({
    ...base,
    symbol: "BANKNIFTY",
    dte: 36,
    currentOrNearExpiryUsable: false,
    higherDteUsable: true,
  });
  assert.equal(r.decision, "BLOCK");
});

test("blocks unsupported moneyness", () => {
  const r = selectExecutionCandidate({ ...base, moneyness: "OTM2" as any });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("UNSUPPORTED_MONEYNESS"));
});

test("blocks invalid or zero premium", () => {
  const zero = selectExecutionCandidate({ ...base, premiumLtp: 0 });
  const nan = selectExecutionCandidate({ ...base, premiumLtp: Number.NaN });
  assert.equal(zero.decision, "BLOCK");
  assert.equal(nan.decision, "BLOCK");
  assert.ok(zero.reasonCodes.includes("INVALID_PREMIUM_LTP"));
});

test("blocks premium that does not fit capital budget", () => {
  const r = selectExecutionCandidate({ ...base, capitalFit: false });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("PREMIUM_NOT_CAPITAL_FIT"));
});

test("does not reject a higher premium merely for being expensive when capital-fit and quality gates pass", () => {
  const r = selectExecutionCandidate({ ...base, premiumLtp: 999, capitalFit: true });
  assert.equal(r.decision, "SELECT");
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

test("invalid contract identity fails closed", () => {
  const r = selectExecutionCandidate({ ...base, strike: Number.NaN });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.failClosed, true);
});
