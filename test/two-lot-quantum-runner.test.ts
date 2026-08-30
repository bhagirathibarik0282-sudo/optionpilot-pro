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
};

test("requests exactly one-lot partial exit when dynamic score qualifies", () => {
  const d = evaluateTwoLotQuantumRunner(base);
  assert.equal(d.action, "REQUEST_PARTIAL_EXIT");
  assert.equal(d.requestedExitQty, 65);
  assert.equal(d.placesOrder, false);
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
  const d = evaluateTwoLotQuantumRunner({
    ...base,
    stage: "ONE_LOT_RUNNER",
    confirmedExitQty: 65,
    runnerClassicalScore: 0.2,
    currentPremium: 140,
    structuralSlCandidate: 120,
  });
  assert.equal(d.action, "REQUEST_RUNNER_EXIT");
  assert.equal(d.requestedExitQty, 65);
});

test("trailing stop never widens", () => {
  const d = evaluateTwoLotQuantumRunner({
    ...base,
    stage: "ONE_LOT_RUNNER",
    confirmedExitQty: 65,
    currentTrailingSl: 125,
    structuralSlCandidate: 119,
    currentPremium: 140,
  });
  assert.equal(d.nextTrailingSl, 125);
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
