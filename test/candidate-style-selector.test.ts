import test from "node:test";
import assert from "node:assert/strict";
import { selectCandidateStyle, type CandidateStyleSelectionInput } from "../candidate-style-selector.js";

const contract = {
  symbol: "NIFTY",
  side: "CE" as const,
  strike: 25000,
  expiryDate: "2026-09-03",
  dte: 4,
};

const shared = {
  truthFresh: true,
  contractValid: true,
  liquidityOk: true,
  directionalParticipationConfirmed: true,
  premiumDirectionConfirmed: true,
  positioningConfirmed: true,
  breakFailureConfirmed: true,
};

const scalp = {
  currentOrNearExpiryUsable: true,
  fastPremiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  shortHorizonProbabilityReady: true,
  scalpRiskReady: true,
  higherDteConflictAbsent: true,
};

const swing = {
  higherDteContractUsable: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryAligned: true,
  higherTimeframeRegimeStable: true,
  longerHorizonProbabilityReady: true,
  swingRiskReady: true,
  nearExpiryNoiseNotDrivingThesis: true,
};

function makeInput(overrides: Partial<CandidateStyleSelectionInput> = {}): CandidateStyleSelectionInput {
  return { style: "SCALP", contract, shared, scalp, swing, ...overrides };
}

test("SCALP becomes READY only when scalp-specific gates and confirmations are ready", () => {
  const result = selectCandidateStyle(makeInput({ style: "SCALP" }));
  assert.equal(result.status, "READY");
  assert.deepEqual(result.contract, contract);
  assert.match(result.candidateKey ?? "", /^SCALP:NIFTY:CE:/);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
});

test("SWING becomes READY independently from scalp rules for strict DTE 7-13", () => {
  const result = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 7 } }));
  assert.equal(result.status, "READY");
  assert.match(result.candidateKey ?? "", /^SWING:NIFTY:CE:/);
  assert.equal(result.tradeHorizon, "SWING_7_13");
});

test("the same DTE contract cannot be READY in both SCALP and SWING", () => {
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP" }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING" }));
  assert.equal(scalpResult.status, "READY");
  assert.equal(swingResult.status, "BLOCKED");
  assert.ok(swingResult.reasons.includes("TRADE_STYLE_DTE_MISMATCH"));
});

test("stale truth blocks both styles before any trade-looking candidate is emitted", () => {
  const badShared = { ...shared, truthFresh: false };
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP", shared: badShared }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 7 }, shared: badShared }));
  assert.equal(scalpResult.status, "BLOCKED");
  assert.equal(swingResult.status, "BLOCKED");
  assert.equal(scalpResult.candidateKey, null);
  assert.equal(swingResult.candidateKey, null);
});

test("missing required style evidence is DATA_UNAVAILABLE, never guessed", () => {
  const result = selectCandidateStyle(makeInput({ style: "SCALP", scalp: { ...scalp, deltaGammaResponseConfirmed: null } }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.reasons.includes("MISSING_DELTA_GAMMA_RESPONSE"));
});

test("missing shared positioning evidence is DATA_UNAVAILABLE", () => {
  const result = selectCandidateStyle(makeInput({ shared: { ...shared, positioningConfirmed: null } }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.reasons.includes("MISSING_POSITIONING"));
});

test("unconfirmed positioning is WATCH, not silently ignored", () => {
  const result = selectCandidateStyle(makeInput({ shared: { ...shared, positioningConfirmed: false } }));
  assert.equal(result.status, "WATCH");
  assert.equal(result.candidateKey, null);
});

test("unconfirmed break/failure evidence is WATCH, not silently ignored", () => {
  const result = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 7 }, shared: { ...shared, breakFailureConfirmed: false } }));
  assert.equal(result.status, "WATCH");
});

test("bad liquidity hard-blocks candidate selection", () => {
  const result = selectCandidateStyle(makeInput({ shared: { ...shared, liquidityOk: false } }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.devilFlags.includes("LIQUIDITY_GATE_FAILED"));
});

test("SCALP may be READY while SWING is BLOCKED by higher-DTE thesis conflict", () => {
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP" }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 7 }, swing: { ...swing, nearExpiryNoiseNotDrivingThesis: false } }));
  assert.equal(scalpResult.status, "READY");
  assert.equal(swingResult.status, "BLOCKED");
});

test("SWING may be READY while SCALP is WATCH when fast premium confirmation is absent", () => {
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP", scalp: { ...scalp, fastPremiumResponseConfirmed: false } }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 7 } }));
  assert.equal(scalpResult.status, "WATCH");
  assert.equal(swingResult.status, "READY");
});

test("SWING hard-blocks unacceptable theta/IV burden", () => {
  const result = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 7 }, swing: { ...swing, thetaIvBurdenAcceptable: false } }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.devilFlags.includes("THETA_IV_BURDEN_UNACCEPTABLE"));
});

test("invalid exact contract identity is DATA_UNAVAILABLE", () => {
  const result = selectCandidateStyle(makeInput({ contract: { ...contract, strike: 0 } }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.side, null);
  assert.equal(result.contract, null);
  assert.equal(result.candidateKey, null);
});

test("DTE 0-1 routes to expiry scalp and DTE 2-6 to normal scalp", () => {
  const expiry = selectCandidateStyle(makeInput({ contract: { ...contract, dte: 1 } }));
  const normal = selectCandidateStyle(makeInput({ contract: { ...contract, dte: 6 } }));
  assert.equal(expiry.status, "READY");
  assert.equal(expiry.tradeHorizon, "EXPIRY_SCALP_0_1");
  assert.equal(normal.status, "READY");
  assert.equal(normal.tradeHorizon, "NORMAL_SCALP_2_6");
});

test("DTE above 13 is blocked by the strict research horizon", () => {
  const result = selectCandidateStyle(makeInput({ style: "SWING", contract: { ...contract, dte: 14 } }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.tradeHorizon, "UNSUPPORTED");
  assert.ok(result.reasons.includes("DTE_OUTSIDE_STRICT_0_13_RANGE"));
});
