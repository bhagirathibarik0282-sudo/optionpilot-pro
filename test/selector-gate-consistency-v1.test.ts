import test from "node:test";
import assert from "node:assert/strict";
import { selectExecutionCandidate, type ExecutionCandidateInput } from "../execution-candidate-selector.js";

const base: ExecutionCandidateInput = {
  symbol: "NIFTY",
  side: "CE",
  strike: 25000,
  expiryDate: "2026-09-15",
  dte: 2,
  moneyness: "ATM",
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

const gateCases: Array<[keyof ExecutionCandidateInput, string]> = [
  ["capitalFit", "PREMIUM_NOT_CAPITAL_FIT"],
  ["liquidityOk", "LIQUIDITY_GATE_FAILED"],
  ["spreadOk", "SPREAD_GATE_FAILED"],
  ["premiumResponseConfirmed", "PREMIUM_RESPONSE_NOT_CONFIRMED"],
  ["deltaGammaResponseConfirmed", "DELTA_GAMMA_RESPONSE_NOT_CONFIRMED"],
  ["thetaIvBurdenAcceptable", "THETA_IV_BURDEN_UNACCEPTABLE"],
  ["multiExpiryConflictAbsent", "MULTI_EXPIRY_CONFLICT_PRESENT"],
  ["currentOrNearExpiryUsable", "NEAR_EXPIRY_NOT_USABLE"],
];

test("every required NIFTY boolean gate maps to its exact selector reason code", () => {
  for (const [gate, reason] of gateCases) {
    const input = { ...base, [gate]: false } as ExecutionCandidateInput;
    const result = selectExecutionCandidate(input);
    assert.equal(result.decision, "BLOCK", `${String(gate)} must fail closed`);
    assert.ok(result.reasonCodes.includes(reason), `${String(gate)} must emit ${reason}`);
  }
});

test("NIFTY fallback DTE requires explicit approval and no unrelated higher-DTE gate", () => {
  const blocked = selectExecutionCandidate({ ...base, dte: 6, fallbackDteApproved: false });
  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.reasonCodes.includes("FALLBACK_DTE_NOT_APPROVED"));
  assert.ok(!blocked.reasonCodes.includes("HIGHER_DTE_NOT_USABLE"));

  const selected = selectExecutionCandidate({ ...base, dte: 6, fallbackDteApproved: true });
  assert.equal(selected.decision, "SELECT");
  assert.equal(selected.dteBucket, "FALLBACK_5_7");
});

test("BANKNIFTY requires higher-DTE usability and never near-expiry/fallback approval", () => {
  const blocked = selectExecutionCandidate({
    ...base,
    symbol: "BANKNIFTY",
    dte: 18,
    currentOrNearExpiryUsable: false,
    higherDteUsable: false,
  });
  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.reasonCodes.includes("HIGHER_DTE_NOT_USABLE"));
  assert.ok(!blocked.reasonCodes.includes("NEAR_EXPIRY_NOT_USABLE"));
  assert.ok(!blocked.reasonCodes.includes("FALLBACK_DTE_NOT_APPROVED"));

  const selected = selectExecutionCandidate({
    ...base,
    symbol: "BANKNIFTY",
    dte: 18,
    currentOrNearExpiryUsable: false,
    higherDteUsable: true,
  });
  assert.equal(selected.decision, "SELECT");
  assert.equal(selected.dteBucket, "BANKNIFTY_HIGHER_10_35");
});

test("all-green candidate emits only canonical selected reason", () => {
  const result = selectExecutionCandidate(base);
  assert.equal(result.decision, "SELECT");
  assert.deepEqual(result.reasonCodes, ["EXECUTION_CANDIDATE_SELECTED"]);
  assert.equal(result.failClosed, true);
});
