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
  return {
    style: "SCALP",
    contract,
    shared,
    scalp,
    swing,
    ...overrides,
  };
}

test("SCALP becomes READY only when scalp-specific gates and confirmations are ready", () => {
  const result = selectCandidateStyle(makeInput({ style: "SCALP" }));
  assert.equal(result.status, "READY");
  assert.equal(result.style, "SCALP");
  assert.equal(result.side, "CE");
  assert.match(result.candidateKey ?? "", /^SCALP:NIFTY:CE:/);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
});

test("SWING becomes READY independently from scalp rules", () => {
  const result = selectCandidateStyle(makeInput({ style: "SWING" }));
  assert.equal(result.status, "READY");
  assert.match(result.candidateKey ?? "", /^SWING:NIFTY:CE:/);
});

test("same contract cannot collide between SCALP and SWING candidate identities", () => {
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP" }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING" }));
  assert.notEqual(scalpResult.candidateKey, swingResult.candidateKey);
});

test("stale truth blocks both styles before any trade-looking candidate is emitted", () => {
  const badShared = { ...shared, truthFresh: false };
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP", shared: badShared }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING", shared: badShared }));
  assert.equal(scalpResult.status, "BLOCKED");
  assert.equal(swingResult.status, "BLOCKED");
  assert.equal(scalpResult.candidateKey, null);
  assert.equal(swingResult.candidateKey, null);
});

test("missing required evidence is DATA_UNAVAILABLE, never guessed false or true", () => {
  const result = selectCandidateStyle(makeInput({
    style: "SCALP",
    scalp: { ...scalp, deltaGammaResponseConfirmed: null },
  }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.reasons.includes("MISSING_DELTA_GAMMA_RESPONSE"));
  assert.equal(result.candidateKey, null);
});

test("bad liquidity hard-blocks candidate selection", () => {
  const result = selectCandidateStyle(makeInput({
    shared: { ...shared, liquidityOk: false },
  }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.devilFlags.includes("LIQUIDITY_GATE_FAILED"));
});

test("SCALP may be READY while SWING is BLOCKED by higher-DTE thesis conflict", () => {
  const scalpResult = selectCandidateStyle(makeInput({ style: "SCALP" }));
  const swingResult = selectCandidateStyle(makeInput({
    style: "SWING",
    swing: { ...swing, nearExpiryNoiseNotDrivingThesis: false },
  }));
  assert.equal(scalpResult.status, "READY");
  assert.equal(swingResult.status, "BLOCKED");
  assert.ok(swingResult.devilFlags.includes("NEAR_EXPIRY_NOISE_DRIVES_SWING_THESIS"));
});

test("SWING may be READY while SCALP is WATCH when fast premium confirmation is absent", () => {
  const scalpResult = selectCandidateStyle(makeInput({
    style: "SCALP",
    scalp: { ...scalp, fastPremiumResponseConfirmed: false },
  }));
  const swingResult = selectCandidateStyle(makeInput({ style: "SWING" }));
  assert.equal(scalpResult.status, "WATCH");
  assert.equal(swingResult.status, "READY");
});

test("SWING hard-blocks unacceptable theta/IV burden", () => {
  const result = selectCandidateStyle(makeInput({
    style: "SWING",
    swing: { ...swing, thetaIvBurdenAcceptable: false },
  }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.devilFlags.includes("THETA_IV_BURDEN_UNACCEPTABLE"));
});

test("invalid exact contract identity is DATA_UNAVAILABLE", () => {
  const result = selectCandidateStyle(makeInput({
    contract: { ...contract, strike: 0 },
  }));
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.side, null);
  assert.equal(result.candidateKey, null);
});
