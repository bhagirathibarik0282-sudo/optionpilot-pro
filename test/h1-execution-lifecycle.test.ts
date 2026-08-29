import test from "node:test";
import assert from "node:assert/strict";
import { buildLifecycleHistorySnapshot, classifyRegimeSurvival, derivePremiumPairObservation } from "../h1-execution-lifecycle.js";

test("premium pair confirms selected-up opposite-down without guessing", () => {
  const pair = derivePremiumPairObservation({ selectedSide: "CE", selectedLtp: 110, oppositeLtp: 90, previousSelectedLtp: 100, previousOppositeLtp: 100 });
  assert.equal(pair?.relation, "SELECTED_UP_OPPOSITE_DOWN");
});

test("missing prior premium keeps relation unavailable", () => {
  const pair = derivePremiumPairObservation({ selectedSide: "PE", selectedLtp: 120, oppositeLtp: 80, previousSelectedLtp: null, previousOppositeLtp: 100 });
  assert.equal(pair?.relation, "UNAVAILABLE");
});

test("regime survival increments only when thesis remains intact", () => {
  assert.deepEqual(classifyRegimeSurvival({ priorRegime: "TREND", currentRegime: "TREND", thesisIntact: true, priorSurvivalCount: 2 }), { state: "SURVIVED", count: 3 });
  assert.deepEqual(classifyRegimeSurvival({ priorRegime: "TREND", currentRegime: "REVERSAL", thesisIntact: false, priorSurvivalCount: 3 }), { state: "INVALIDATED", count: 3 });
});

test("history adapter cannot alter supplied live status", () => {
  const out = buildLifecycleHistorySnapshot({
    candidateId: "c1", symbol: "NIFTY", mode: "SWING", observedAt: new Date(0).toISOString(), status: "HOLD",
    direction: "BULLISH", expiry: null, strike: null, side: "CE", entryLow: 100, entryHigh: 105, sl: 90, t1: 120, t2: 140, t3: null,
    evidenceQuality: "HIGH", priorRegime: "TREND", currentRegime: "TREND", thesisIntact: true, priorSurvivalCount: 1,
  });
  assert.equal(out.lifecycle.status, "HOLD");
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
});
