import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTwoLotQuantumRunner } from "../two-lot-quantum-runner.js";

const base = {
  entryPrice: 120,
  currentPremium: 138,
  currentTrailingSl: 112,
  lotSize: 65,
  filledEntryQty: 130,
  confirmedExitQty: 0,
  stage: "TWO_LOTS_ACTIVE" as const,
  scaleOutFeatures: [0.9, 0.8, 0.85, 0.75],
  runnerFeatures: [0.85, 0.8, 0.82, 0.78],
  scaleOutClassicalScore: 0.9,
  runnerClassicalScore: 0.85,
  scaleOutMinScore: 0.6,
  runnerExitMaxScore: 0.35,
  structuralSlCandidate: 118,
  runnerBuffer: {
    index: "NIFTY" as const,
    currentPremium: 138,
    premiumAtr: 6,
    realisedVolatilityPct: 18,
    relativeSpreadPct: 0.8,
    dte: 2,
    iv: 16,
    recentWhipsawRate: 0.25,
    structuralBuffer: 5,
    maxAllowedBuffer: 14,
    quantumFeatures: [0.8, 0.7, 0.75, 0.82],
  },
};

const withPremium = (currentPremium: number) => ({
  ...base,
  currentPremium,
  runnerBuffer: { ...base.runnerBuffer, currentPremium },
});

test("requests exactly one-lot partial exit when dynamic score qualifies", () => {
  const d = evaluateTwoLotQuantumRunner(base);
  assert.equal(d.action, "REQUEST_PARTIAL_EXIT");
  assert.equal(d.requestedExitQty, 65);
  assert.equal(d.placesOrder, false);
  assert.ok((d.runnerBufferPoints ?? 0) > 0);
});

test("holds two lots when scale-out quality is below threshold", () => {
  const d = evaluateTwoLotQuantumRunner({ ...base, scaleOutMinScore: 0.99 });
  assert.equal(d.action, "HOLD_TWO");
  assert.equal(d.requestedExitQty, 0);
});

test("never activates runner before broker confirms one-lot exit", () => {
  const d = evaluateTwoLotQuantumRunner({ ...base, stage: "PARTIAL_EXIT_PENDING" });
  assert.equal(d.action, "WAIT_PARTIAL_FILL");
});

test("activates runner only after exact one-lot confirmed exit", () => {
  const d = evaluateTwoLotQuantumRunner({ ...base, stage: "PARTIAL_EXIT_PENDING", confirmedExitQty: 65 });
  assert.equal(d.action, "RUNNER_HOLD");
});

test("blocks partial-exit overfill", () => {
  const d = evaluateTwoLotQuantumRunner({ ...base, stage: "PARTIAL_EXIT_PENDING", confirmedExitQty: 66 });
  assert.equal(d.action, "BLOCK");
  assert.equal(d.failClosed, true);
});

test("runner exits when quantum-adjusted runner quality deteriorates", () => {
  const p = withPremium(140);
  const d = evaluateTwoLotQuantumRunner({
    ...p,
    stage: "ONE_LOT_RUNNER",
    confirmedExitQty: 65,
    runnerClassicalScore: 0.2,
    structuralSlCandidate: 120,
  });
  assert.equal(d.action, "REQUEST_RUNNER_EXIT");
  assert.equal(d.requestedExitQty, 65);
});

test("trailing stop never widens", () => {
  const p = withPremium(140);
  const d = evaluateTwoLotQuantumRunner({
    ...p,
    stage: "ONE_LOT_RUNNER",
    confirmedExitQty: 65,
    currentTrailingSl: 125,
    structuralSlCandidate: 119,
  });
  assert.equal(d.nextTrailingSl, 125);
});

test("SENSEX and NIFTY use distinct runner buffers", () => {
  const n = evaluateTwoLotQuantumRunner(base);
  const s = evaluateTwoLotQuantumRunner({
    ...base,
    runnerBuffer: { ...base.runnerBuffer, index: "SENSEX" as const },
  });
  assert.notEqual(n.runnerBufferPoints, s.runnerBufferPoints);
});

test("blocks runner buffer price mismatch", () => {
  const d = evaluateTwoLotQuantumRunner({
    ...base,
    runnerBuffer: { ...base.runnerBuffer, currentPremium: 137 },
  });
  assert.equal(d.action, "BLOCK");
  assert.equal(d.reason, "RUNNER_BUFFER_STATE_MISMATCH");
});

test("blocks unconfirmed two-lot entry quantity", () => {
  const d = evaluateTwoLotQuantumRunner({ ...base, filledEntryQty: 65 });
  assert.equal(d.action, "BLOCK");
  assert.equal(d.reason, "TWO_LOT_ENTRY_NOT_CONFIRMED");
});

test("fails closed when quantum feature vector is invalid", () => {
  const d = evaluateTwoLotQuantumRunner({ ...base, scaleOutFeatures: [Number.NaN, 1] });
  assert.equal(d.action, "BLOCK");
  assert.equal(d.failClosed, true);
});
