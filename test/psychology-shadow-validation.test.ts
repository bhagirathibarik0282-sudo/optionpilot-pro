import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_SHADOW_REGIMES,
  SHADOW_VALIDATION_METRICS,
  validatePsychologyShadowObservations,
  type ShadowValidationObservation,
  type ShadowValidationRegime,
} from "../psychology-shadow-validation.ts";

function obs(regimes: ShadowValidationRegime | ShadowValidationRegime[], id: string): ShadowValidationObservation {
  return {
    tradeId: id,
    regimes: Array.isArray(regimes) ? regimes : [regimes],
    completedTrade: true,
    chaseWarnings: 2,
    falseChaseWarnings: 0,
    lateExitEvents: 1,
    missedLateExitWarnings: 0,
    thesisFailures: 1,
    missedThesisFailures: 0,
    stateFlips: 1,
    eligibleMessages: 5,
    duplicateMessages: 0,
    spokenUpdates: 4,
    wrongSideFlips: 0,
    entries: 1,
    entriesAfterExtension: 0,
    stoppedTrades: 1,
    stopRespectViolations: 0,
    profitProtectionOpportunities: 1,
    usefulProfitProtectionEvents: 1,
  };
}

test("metric registry freezes the ten agreed validation metrics", () => {
  assert.equal(Object.keys(SHADOW_VALIDATION_METRICS).length, 10);
  assert.ok("FALSE_CHASE_WARNING_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("MISSED_LATE_EXIT_WARNING_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("MISSED_THESIS_FAILURE_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("STATE_FLIPS_PER_TRADE" in SHADOW_VALIDATION_METRICS);
  assert.ok("DUPLICATE_MESSAGE_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("AVERAGE_UPDATES_PER_TRADE" in SHADOW_VALIDATION_METRICS);
  assert.ok("WRONG_SIDE_FLIP_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("ENTRY_AFTER_EXTENSION_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("STOP_RESPECT_VIOLATION_RATE" in SHADOW_VALIDATION_METRICS);
  assert.ok("PROFIT_PROTECTION_USEFULNESS_RATE" in SHADOW_VALIDATION_METRICS);
});

test("all eight diverse regimes are mandatory", () => {
  assert.deepEqual(REQUIRED_SHADOW_REGIMES, ["TREND", "RANGE", "GAP", "EXPIRY", "REVERSAL", "HIGH_IV", "LOW_VOL", "FALSE_BREAKOUT"]);
});

test("complete synthetic coverage calculates metrics but still cannot promote", () => {
  const rows = REQUIRED_SHADOW_REGIMES.map((r, i) => obs(r, `T${i + 1}`));
  const r = validatePsychologyShadowObservations(rows);
  assert.deepEqual(r.missingRegimes, []);
  assert.equal(r.completedTrades, 8);
  assert.equal(r.metrics.FALSE_CHASE_WARNING_RATE, 0);
  assert.equal(r.metrics.AVERAGE_UPDATES_PER_TRADE, 4);
  assert.equal(r.metrics.PROFIT_PROTECTION_USEFULNESS_RATE, 1);
  assert.equal(r.metricDefinitionsFrozen, true);
  assert.equal(r.acceptanceThresholdsFrozen, false);
  assert.equal(r.promotionEligible, false);
  assert.ok(r.blockers.includes("ACCEPTANCE_THRESHOLDS_NOT_CALIBRATED_OR_FROZEN"));
});

test("one real trade may cover multiple overlapping regimes without double-counting the trade", () => {
  const r = validatePsychologyShadowObservations([obs(["EXPIRY", "HIGH_IV", "TREND"], "T1")]);
  assert.equal(r.observations, 1);
  assert.equal(r.completedTrades, 1);
  assert.ok(r.coveredRegimes.includes("EXPIRY"));
  assert.ok(r.coveredRegimes.includes("HIGH_IV"));
  assert.ok(r.coveredRegimes.includes("TREND"));
  assert.equal(r.metrics.AVERAGE_UPDATES_PER_TRADE, 4);
});

test("missing regimes are explicit blockers", () => {
  const r = validatePsychologyShadowObservations([obs("TREND", "T1")]);
  assert.ok(r.missingRegimes.includes("FALSE_BREAKOUT"));
  assert.ok(r.blockers.includes("REGIME_COVERAGE_INCOMPLETE"));
});

test("empty validation fails closed", () => {
  const r = validatePsychologyShadowObservations([]);
  assert.equal(r.promotionEligible, false);
  assert.ok(r.blockers.includes("NO_SHADOW_OBSERVATIONS"));
  assert.ok(r.blockers.includes("NO_COMPLETED_CANDIDATE_TRADES"));
});

test("regime tags must be non-empty, supported and unique", () => {
  assert.throws(() => validatePsychologyShadowObservations([{ ...obs("TREND", "T1"), regimes: [] }]), /at least one validation regime/);
  assert.throws(() => validatePsychologyShadowObservations([{ ...obs("TREND", "T2"), regimes: ["UNKNOWN" as ShadowValidationRegime] }]), /unsupported regime/);
  assert.throws(() => validatePsychologyShadowObservations([{ ...obs("TREND", "T3"), regimes: ["TREND", "TREND"] }]), /duplicate regime tag/);
});

test("impossible counters are rejected instead of silently corrupting metrics", () => {
  const bad = { ...obs("TREND", "T1"), falseChaseWarnings: 3, chaseWarnings: 2 };
  assert.throws(() => validatePsychologyShadowObservations([bad]), /cannot exceed/);

  const impossibleSpeech = { ...obs("TREND", "T2"), eligibleMessages: 2, spokenUpdates: 3 };
  assert.throws(() => validatePsychologyShadowObservations([impossibleSpeech]), /spokenUpdates cannot exceed eligibleMessages/);
});

test("duplicate trade ids are rejected so per-trade denominators cannot be inflated", () => {
  assert.throws(
    () => validatePsychologyShadowObservations([obs("TREND", "T1"), obs("RANGE", "T1")]),
    /duplicate tradeId is not allowed/,
  );
});

test("validation harness has no live authority", () => {
  const r = validatePsychologyShadowObservations([obs("TREND", "T1")]);
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});
