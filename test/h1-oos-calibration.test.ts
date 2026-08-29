import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOosCalibration } from "../h1-oos-calibration.js";

function window(id: string, startDate: string, endDate: string, eligibleOutcomes: number, wins: number, losses: number, scratches = 0) {
  return { id, startDate, endDate, eligibleOutcomes, wins, losses, scratches, unknownOrIncomplete: 0 };
}

test("strictly separated frozen OOS can unlock later regime-strength calibration", () => {
  const result = evaluateOosCalibration({
    inSample: window("train", "2026-05-01", "2026-07-31", 80, 45, 30, 5),
    outOfSample: window("oos", "2026-08-01", "2026-08-28", 40, 21, 17, 2),
    leakageDetected: false,
    ruleVersionFrozen: true,
    featureSetFrozen: true,
    thresholdSetFrozen: true,
    regimeCoverageCount: 4,
  });
  assert.equal(result.regimeStrengthMayBeCalibrated, true);
  assert.equal(result.status, "REGIME_STRENGTH_UNLOCKED");
  assert.equal(result.probabilityClaimAllowed, false);
  assert.equal(result.productionWeightingAllowed, false);
});

test("overlapping windows are blocked even with strong results", () => {
  const result = evaluateOosCalibration({
    inSample: window("train", "2026-05-01", "2026-08-10", 100, 70, 25, 5),
    outOfSample: window("oos", "2026-08-01", "2026-08-28", 40, 30, 8, 2),
    leakageDetected: false,
    ruleVersionFrozen: true,
    featureSetFrozen: true,
    thresholdSetFrozen: true,
    regimeCoverageCount: 4,
  });
  assert.equal(result.regimeStrengthMayBeCalibrated, false);
  assert.ok(result.blockers.includes("IN_SAMPLE_OOS_OVERLAP_OR_NO_FORWARD_SEPARATION"));
});

test("unfrozen thresholds block OOS promotion", () => {
  const result = evaluateOosCalibration({
    inSample: window("train", "2026-05-01", "2026-07-31", 80, 45, 30, 5),
    outOfSample: window("oos", "2026-08-01", "2026-08-28", 40, 21, 17, 2),
    leakageDetected: false,
    ruleVersionFrozen: true,
    featureSetFrozen: true,
    thresholdSetFrozen: false,
    regimeCoverageCount: 4,
  });
  assert.equal(result.regimeStrengthMayBeCalibrated, false);
  assert.ok(result.blockers.includes("THRESHOLD_SET_NOT_FROZEN"));
});

test("large OOS degradation blocks promotion", () => {
  const result = evaluateOosCalibration({
    inSample: window("train", "2026-05-01", "2026-07-31", 100, 75, 20, 5),
    outOfSample: window("oos", "2026-08-01", "2026-08-28", 40, 14, 24, 2),
    leakageDetected: false,
    ruleVersionFrozen: true,
    featureSetFrozen: true,
    thresholdSetFrozen: true,
    regimeCoverageCount: 4,
  });
  assert.equal(result.regimeStrengthMayBeCalibrated, false);
  assert.ok(result.blockers.includes("OOS_PERFORMANCE_DEGRADATION_TOO_LARGE"));
});
