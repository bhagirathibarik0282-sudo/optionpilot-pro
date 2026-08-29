import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidenceCompleteness, premiumPairRelation } from "../h1-derived-history.js";

test("normalizeEvidenceCompleteness clamps to 0..100", () => {
  assert.equal(normalizeEvidenceCompleteness(8, 10), 80);
  assert.equal(normalizeEvidenceCompleteness(15, 10), 100);
  assert.equal(normalizeEvidenceCompleteness(-2, 10), 0);
  assert.equal(normalizeEvidenceCompleteness(1, 0), null);
});

test("premiumPairRelation maps selected/opposite behaviour without guessing", () => {
  assert.equal(premiumPairRelation(2, -1), "SELECTED_UP_OPPOSITE_DOWN");
  assert.equal(premiumPairRelation(2, 1), "BOTH_UP");
  assert.equal(premiumPairRelation(-2, -1), "BOTH_DOWN");
  assert.equal(premiumPairRelation(-2, 1), "SELECTED_DOWN_OPPOSITE_UP");
  assert.equal(premiumPairRelation(0, 1), "MIXED");
  assert.equal(premiumPairRelation(null, 1), "UNAVAILABLE");
});
