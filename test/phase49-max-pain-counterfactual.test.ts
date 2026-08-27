import test from "node:test";
import assert from "node:assert/strict";
import {
  replayWithoutMaxPain,
  PHASE49_MAX_PAIN_COUNTERFACTUAL_SAFETY,
} from "../max-pain-counterfactual.js";

const thresholds = [
  { id: "WATCH_READY", value: 3 },
  { id: "FOCUS_READY", value: 5 },
];

test("removes exactly the recorded legacy Max Pain contribution from the same KNOWN_THEN score", () => {
  const r = replayWithoutMaxPain([
    { observationId:"o1", knownThen:true, timestamp:"2026-08-26T10:00:00Z", symbol:"NIFTY", legacyScore:5.2, maxPainContribution:0.5 },
    { observationId:"o2", knownThen:true, timestamp:"2026-08-26T10:01:00Z", symbol:"NIFTY", legacyScore:4.8, maxPainContribution:-0.5 },
    { observationId:"o3", knownThen:true, timestamp:"2026-08-26T10:02:00Z", symbol:"NIFTY", legacyScore:4.0, maxPainContribution:0 },
  ], thresholds);
  assert.equal(r.rows[0].counterfactualScore, 4.7);
  assert.equal(r.rows[1].counterfactualScore, 5.3);
  assert.equal(r.rows[2].counterfactualScore, 4.0);
  assert.deepEqual(r.rows[0].thresholdCrossings, ["FOCUS_READY"]);
  assert.deepEqual(r.rows[1].thresholdCrossings, ["FOCUS_READY"]);
  assert.equal(r.scoreChangedRows, 2);
  assert.equal(r.thresholdCrossingRows, 2);
});

test("does not fabricate verdict or candidate flips when deterministic counterfactual outputs are unavailable", () => {
  const r = replayWithoutMaxPain([
    { observationId:"o1", knownThen:true, timestamp:"2026-08-26T10:00:00Z", symbol:"BANKNIFTY", legacyScore:5.1, maxPainContribution:0.5, legacyVerdict:"FOCUS" },
  ], thresholds);
  assert.equal(r.verdictComparableRows, 0);
  assert.equal(r.verdictFlipRows, 0);
  assert.equal(r.impactRates.verdictFlipPctOfComparable, null);
  assert.equal(r.candidateComparableRows, 0);
  assert.equal(r.impactRates.candidateFlipPctOfComparable, null);
});

test("counts verdict and candidate flips only when both legacy and counterfactual states are supplied", () => {
  const r = replayWithoutMaxPain([
    { observationId:"o1", knownThen:true, timestamp:"2026-08-26T10:00:00Z", symbol:"SENSEX", legacyScore:5.2, maxPainContribution:0.5, legacyVerdict:"FOCUS", counterfactualVerdict:"WATCH", legacyCandidate:"CE", counterfactualCandidate:"NONE" },
    { observationId:"o2", knownThen:true, timestamp:"2026-08-26T10:01:00Z", symbol:"SENSEX", legacyScore:6.0, maxPainContribution:0.5, legacyVerdict:"FOCUS", counterfactualVerdict:"FOCUS", legacyCandidate:"CE", counterfactualCandidate:"CE" },
  ], thresholds);
  assert.equal(r.verdictComparableRows, 2);
  assert.equal(r.verdictFlipRows, 1);
  assert.equal(r.impactRates.verdictFlipPctOfComparable, 50);
  assert.equal(r.candidateComparableRows, 2);
  assert.equal(r.candidateFlipRows, 1);
});

test("unknown legacy contribution is excluded rather than assumed zero", () => {
  const r = replayWithoutMaxPain([
    { observationId:"o1", knownThen:true, timestamp:"2026-08-26T10:00:00Z", symbol:"NIFTY", legacyScore:4.2, maxPainContribution:null },
  ], thresholds);
  assert.equal(r.includedRows, 0);
  assert.equal(r.excludedRows, 1);
  assert.equal(r.rows[0].counterfactualScore, null);
  assert.equal(r.rows[0].exclusionReason, "MAX_PAIN_CONTRIBUTION_UNKNOWN");
  assert.equal(r.impactRates.thresholdCrossingPct, null);
});

test("empty replay reports null impact rates instead of invented zero-effect evidence", () => {
  const r = replayWithoutMaxPain([], thresholds);
  assert.equal(r.totalRows, 0);
  assert.equal(r.impactRates.thresholdCrossingPct, null);
  assert.equal(r.impactRates.verdictFlipPctOfComparable, null);
  assert.equal(r.impactRates.candidateFlipPctOfComparable, null);
});

test("Phase49 safety contract cannot alter production score, verdict, Telegram or execution", () => {
  assert.deepEqual(PHASE49_MAX_PAIN_COUNTERFACTUAL_SAFETY, {
    researchOnly: true,
    knownThenOnly: true,
    readOnlyForTrading: true,
    affectsProductionScore: false,
    affectsVerdict: false,
    affectsTelegramTradeDecision: false,
    affectsExecution: false,
    noProductionThresholdInference: true,
    noFabricatedImpactRateWithoutRows: true,
  });
});
