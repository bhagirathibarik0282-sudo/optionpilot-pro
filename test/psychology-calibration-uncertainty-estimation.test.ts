import test from "node:test";
import assert from "node:assert/strict";
import { estimatePsychologyCalibrationUncertainty } from "../psychology-calibration-uncertainty-estimation.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, type ShadowValidationRegime } from "../psychology-shadow-validation.ts";

function isoDate(dayIndex: number): string {
  return new Date(Date.UTC(2026, 0, 1 + dayIndex)).toISOString().slice(0, 10);
}

function record(tradeId: string, regime: ShadowValidationRegime, tradingDate: string, day: number): StoredPsychologyRealEvidence {
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
      chaseWarnings: 2,
      falseChaseWarnings: day % 5 === 0 ? 1 : 0,
      lateExitEvents: 2,
      missedLateExitWarnings: day % 7 === 0 ? 1 : 0,
      thesisFailures: 2,
      missedThesisFailures: day % 9 === 0 ? 1 : 0,
      stateFlips: 1 + (day % 3),
      eligibleMessages: 4,
      duplicateMessages: day % 6 === 0 ? 1 : 0,
      spokenUpdates: 1 + (day % 2),
      wrongSideFlips: day % 11 === 0 ? 1 : 0,
      entries: 2,
      entriesAfterExtension: day % 8 === 0 ? 1 : 0,
      stoppedTrades: 2,
      stopRespectViolations: day % 13 === 0 ? 1 : 0,
      profitProtectionOpportunities: 2,
      usefulProfitProtectionEvents: day % 4 === 0 ? 1 : 2,
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
      rows.push(record(`T-${day}-${regimeIndex}`, REQUIRED_SHADOW_REGIMES[regimeIndex]!, tradingDate, day));
    }
  }
  return rows;
}

test("insufficient evidence cannot estimate uncertainty", () => {
  const result = estimatePsychologyCalibrationUncertainty([]);
  assert.equal(result.status, "CANDIDATE_DESIGN_BLOCKED");
  assert.equal(result.cards.length, 0);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
});

test("estimates all 10 calibration uncertainties with frozen methods", () => {
  const result = estimatePsychologyCalibrationUncertainty(sufficientRows());
  assert.equal(result.status, "UNCERTAINTY_ESTIMATES_READY");
  assert.equal(result.allTenFrozenMetricsEstimated, true);
  assert.equal(result.cards.length, 10);
  assert.equal(result.calibrationTradingDateCount, 46);
  assert.equal(result.calibrationRecordCount, 46 * REQUIRED_SHADOW_REGIMES.length);

  const falseChase = result.cards.find((card) => card.metric === "FALSE_CHASE_WARNING_RATE");
  assert.ok(falseChase);
  assert.equal(falseChase.uncertaintyMethod, "WILSON_95");
  assert.equal(falseChase.bootstrapReplicates, null);
  assert.equal(falseChase.bootstrapSeed, null);
  assert.ok(falseChase.uncertaintyLower <= falseChase.calibrationValue);
  assert.ok(falseChase.uncertaintyUpper >= falseChase.calibrationValue);

  const flips = result.cards.find((card) => card.metric === "STATE_FLIPS_PER_TRADE");
  assert.ok(flips);
  assert.equal(flips.uncertaintyMethod, "TRADING_DATE_CLUSTER_BOOTSTRAP_95");
  assert.equal(flips.bootstrapReplicates, 2000);
  assert.equal(typeof flips.bootstrapSeed, "number");
  assert.ok(flips.uncertaintyLower <= flips.calibrationValue);
  assert.ok(flips.uncertaintyUpper >= flips.calibrationValue);

  const updates = result.cards.find((card) => card.metric === "AVERAGE_UPDATES_PER_TRADE");
  assert.ok(updates);
  assert.equal(updates.bootstrapReplicates, 2000);
  assert.equal(result.oosUsedForUncertaintyEstimation, false);
  assert.equal(result.oosUsedForCandidateSelection, false);
  assert.equal(result.thresholdSelectionRuleFrozen, false);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
});

test("uncertainty estimates are deterministic under the frozen bootstrap seed", () => {
  const rows = sufficientRows();
  const first = estimatePsychologyCalibrationUncertainty(rows);
  const second = estimatePsychologyCalibrationUncertainty(rows);
  assert.equal(first.status, "UNCERTAINTY_ESTIMATES_READY");
  assert.deepEqual(first.cards, second.cards);
});

test("changing only OOS counters cannot change calibration uncertainty estimates", () => {
  const rows = sufficientRows();
  const baseline = estimatePsychologyCalibrationUncertainty(rows);
  assert.equal(baseline.status, "UNCERTAINTY_ESTIMATES_READY");

  const changed = rows.map((row) => {
    const tradingDate = row.replay.tradingDate!;
    if (tradingDate < isoDate(46)) return row;
    return {
      ...row,
      validation: {
        ...row.validation,
        falseChaseWarnings: row.validation.chaseWarnings,
        missedLateExitWarnings: row.validation.lateExitEvents,
        missedThesisFailures: row.validation.thesisFailures,
        stateFlips: row.validation.stateFlips + 50,
        duplicateMessages: row.validation.eligibleMessages,
        spokenUpdates: row.validation.eligibleMessages,
        wrongSideFlips: 20,
        entriesAfterExtension: row.validation.entries,
        stopRespectViolations: row.validation.stoppedTrades,
        usefulProfitProtectionEvents: 0,
      },
    };
  });

  const mutated = estimatePsychologyCalibrationUncertainty(changed);
  assert.equal(mutated.status, "UNCERTAINTY_ESTIMATES_READY");
  assert.deepEqual(mutated.cards, baseline.cards);
});
