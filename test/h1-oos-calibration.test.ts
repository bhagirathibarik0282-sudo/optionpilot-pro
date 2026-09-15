import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOosCalibration } from "../h1-oos-calibration.js";
import { runH1Dte0MultidayOos } from "../h1-dte0-multiday-oos-v1.js";

function window(id: string, startDate: string, endDate: string, eligibleOutcomes: number, wins: number, losses: number, scratches = 0) {
  return { id, startDate, endDate, eligibleOutcomes, wins, losses, scratches, unknownOrIncomplete: 0 };
}

function dte0Day(tradeDate: string) {
  return {
    tradeDate,
    calibration: {
      ok: true,
      windowCount: 1,
      windows: [{
        observed: {
          absoluteDeltaChange: 0.08,
          premiumMovePct: 0.5,
          currentGamma: 0.002,
          thetaPctOfPremium: 1.2,
          iv: 12,
        },
        currentPolicy: {
          minPremiumMovePct: 0.25,
          gammaPass: true,
        },
      }],
    },
  } as any;
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

test("DTE0 multiday readiness waits fail-closed with only three usable days", () => {
  const result = runH1Dte0MultidayOos([
    dte0Day("2026-09-01"),
    dte0Day("2026-09-08"),
    dte0Day("2026-09-15"),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.readiness.state, "WAITING_FOR_MORE_DTE0_DAYS");
  assert.equal(result.readiness.usableDte0DayCount, 3);
  assert.equal(result.readiness.minimumRequiredDte0Days, 4);
  assert.equal(result.readiness.missingUsableDte0Days, 1);
  assert.equal(result.readiness.policyPromotionAuthority, "NONE");
  assert.equal(result.readiness.selectorAuthority, "NONE");
  assert.equal(result.readiness.telegramAuthority, "NONE");
  assert.equal(result.readiness.executionAuthority, "NONE");
  assert.equal(result.safety.affectsSelector, false);
  assert.equal(result.safety.affectsTelegram, false);
  assert.equal(result.safety.affectsExecution, false);
});

test("DTE0 multiday readiness exposes validation-ready at four days without granting production authority", () => {
  const result = runH1Dte0MultidayOos([
    dte0Day("2026-08-25"),
    dte0Day("2026-09-01"),
    dte0Day("2026-09-08"),
    dte0Day("2026-09-15"),
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.readiness.state, "READY_FOR_POLICY_VALIDATION");
  assert.equal(result.readiness.usableDte0DayCount, 4);
  assert.equal(result.readiness.minimumRequiredDte0Days, 4);
  assert.equal(result.readiness.missingUsableDte0Days, 0);
  assert.equal(result.readiness.policyPromotionAuthority, "NONE");
  assert.equal(result.readiness.selectorAuthority, "NONE");
  assert.equal(result.readiness.telegramAuthority, "NONE");
  assert.equal(result.readiness.executionAuthority, "NONE");
  assert.equal(result.safety.thresholdPromoted, false);
  assert.equal(result.safety.affectsSelector, false);
  assert.equal(result.safety.affectsTelegram, false);
  assert.equal(result.safety.affectsExecution, false);
});