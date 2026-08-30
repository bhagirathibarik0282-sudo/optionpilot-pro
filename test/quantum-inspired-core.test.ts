import test from "node:test";
import assert from "node:assert/strict";
import { quantumInspiredAugment, tightenOnlyLimit } from "../quantum-inspired-core.js";

test("produces bounded quantum-inspired companion metrics", () => {
  const r = quantumInspiredAugment({ label: "COMB-11", values: [1, 2, 3, 4], classicalScore: 80 });
  assert.equal(r.valid, true);
  for (const v of [r.kernelCoherence, r.normalizedEntropy, r.amplitudeConcentration, r.uncertainty]) {
    assert.ok(v !== null && v >= 0 && v <= 1);
  }
  assert.ok(r.adjustedScore !== null && r.adjustedScore <= 80);
});

test("invalid vectors fail closed", () => {
  const r = quantumInspiredAugment({ label: "X", values: [Number.NaN, 1] });
  assert.equal(r.valid, false);
  assert.equal(r.adjustedScore, null);
});

test("zero-norm vector fails closed", () => {
  const r = quantumInspiredAugment({ label: "X", values: [0, 0] });
  assert.equal(r.valid, false);
});

test("quantum-inspired limit can never loosen deterministic safety limit", () => {
  assert.equal(tightenOnlyLimit(1180, 1500), 1180);
  assert.equal(tightenOnlyLimit(1180, 900), 900);
});

test("invalid proposed safety limit collapses fail closed", () => {
  assert.equal(tightenOnlyLimit(1180, Number.NaN), 0);
});
