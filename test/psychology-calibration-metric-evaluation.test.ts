import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePsychologyCalibrationMetrics } from "../psychology-calibration-metric-evaluation.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, type ShadowValidationRegime } from "../psychology-shadow-validation.ts";

function isoDate(dayIndex: number): string {
  const date = new Date(Date.UTC(2026, 0, 1 + dayIndex));
  return date.toISOString().slice(0, 10);
}

function record(tradeId: string, regime: ShadowValidationRegime, tradingDate: string): StoredPsychologyRealEvidence {
  const prepared = preparePsychologyRealEvidenceForStorage({
    source: "REAL_REPLAY",
    replay: {
      logicalKey: tradeId,
      observedAt: `${tradingDate}T09:59:00Z`,
      decisionAt: `${tradingDate}T10:00:00Z`,
      blockEnd: `${tradingDate}T09:59:00Z`,
      blockClosed: true,
      quality: "TRUE",
      expiry: tradingDate,
      dte: 0,
      tradingDate,
      sessionEligible: true,
    },
    validation: {
      tradeId,
      regimes: [regime],
      regimeEvidence: [{
        regime,
        source: "DETERMINISTIC_UPSTREAM",
        observedAt: `${tradingDate}T09:59:30Z`,
        ruleVersion: "REGIME_TEST_V1",
      }],
      completedTrade: true,
      chaseWarnings: 1,
      falseChaseWarnings: 0,
      lateExitEvents: 1,
      missedLateExitWarnings: 0,
      thesisFailures: 1,
      missedThesisFailures: 0,
      stateFlips: 1,
      eligibleMessages: 2,
      duplicateMessages: 0,
      spokenUpdates: 1,
      wrongSideFlips: 0,
      entries: 1,
      entriesAfterExtension: 0,
      stoppedTrades: 1,
      stopRespectViolations: 0,
      profitProtectionOpportunities: 1,
      usefulProfitProtectionEvents: 1,
    },
  }, `${tradingDate}T11:00:00Z`);
  assert.ok(prepared);
  return prepared;
}

function sufficientRows(): StoredPsychologyRealEvidence[] {
  const rows: StoredPsychologyRealEvidence[] = [];
  for (let day = 0; day < 67; day += 1) {
    const tradingDate = isoDate(day);
    for (let regimeIndex = 0; regimeIndex < REQUIRED_SHADOW_REGIMES.length; regimeIndex += 1) {
      rows.push(record(`T-${day}-${regimeIndex}`, REQUIRED_SHADOW_REGIMES[regimeIndex]!, tradingDate));
    }
  }
  return rows;
}

test("insufficient evidence cannot enter calibration metric evaluation", () => {
  const result = evaluatePsychologyCalibrationMetrics([]);
  assert.equal(result.status, "PARTITION_BLOCKED");
  assert.equal(result.calibrationMetricValues, null);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.oosUsedForThresholdSelection, false);
  assert.equal(result.promotionEligible, false);
});

test("evaluates all frozen metrics on calibration records only", () => {
  const result = evaluatePsychologyCalibrationMetrics(sufficientRows());
  assert.equal(result.status, "CALIBRATION_METRICS_READY");
  assert.equal(result.partitionStatus, "PARTITION_READY");
  assert.equal(result.calibrationTradingDates.length, 46);
  assert.equal(result.oosTradingDateCount, 21);
  assert.equal(result.calibrationRecordCount, 46 * REQUIRED_SHADOW_REGIMES.length);
  assert.equal(result.oosRecordCount, 21 * REQUIRED_SHADOW_REGIMES.length);
  assert.ok(result.calibrationMetricValues);
  assert.equal(result.nullCalibrationMetrics.length, 0);
  assert.equal(result.calibrationRejectedRecords, 0);
  assert.equal(result.calibrationRegimeProvenanceVerified, true);
  assert.equal(result.calibrationMetricValues.FALSE_CHASE_WARNING_RATE, 0);
  assert.equal(result.calibrationMetricValues.PROFIT_PROTECTION_USEFULNESS_RATE, 1);
  assert.equal(result.oosReadForMetricEvaluation, false);
  assert.equal(result.oosUsedForThresholdSelection, false);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
});

test("changing only untouched OOS outcomes cannot change calibration metrics", () => {
  const baselineRows = sufficientRows();
  const baseline = evaluatePsychologyCalibrationMetrics(baselineRows);
  assert.equal(baseline.status, "CALIBRATION_METRICS_READY");

  const firstOosDate = isoDate(46);
  const changedRows = baselineRows.map((row) => {
    if ((row.replay.tradingDate ?? "") < firstOosDate) return row;
    return {
      ...row,
      validation: {
        ...row.validation,
        falseChaseWarnings: row.validation.chaseWarnings,
        missedLateExitWarnings: row.validation.lateExitEvents,
        missedThesisFailures: row.validation.thesisFailures,
        duplicateMessages: row.validation.eligibleMessages,
        wrongSideFlips: row.validation.completedTrade ? 1 : 0,
        entriesAfterExtension: row.validation.entries,
        stopRespectViolations: row.validation.stoppedTrades,
        usefulProfitProtectionEvents: 0,
      },
    };
  });

  const changed = evaluatePsychologyCalibrationMetrics(changedRows);
  assert.equal(changed.status, "CALIBRATION_METRICS_READY");
  assert.deepEqual(changed.calibrationMetricValues, baseline.calibrationMetricValues);
  assert.equal(changed.oosUsedForThresholdSelection, false);
});
