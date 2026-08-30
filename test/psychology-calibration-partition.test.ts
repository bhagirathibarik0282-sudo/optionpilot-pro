import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyCalibrationPartition } from "../psychology-calibration-partition.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES } from "../psychology-shadow-validation.ts";

function dateFromIndex(index: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + index));
  return d.toISOString().slice(0, 10);
}

function record(tradeId: string, tradingDate: string, regimeIndex: number): StoredPsychologyRealEvidence {
  const regime = REQUIRED_SHADOW_REGIMES[regimeIndex % REQUIRED_SHADOW_REGIMES.length]!;
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
      regimeEvidence: [{ regime, source: "DETERMINISTIC_UPSTREAM", observedAt: `${tradingDate}T09:59:30Z`, ruleVersion: "REGIME_TEST_V1" }],
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
    const tradingDate = dateFromIndex(day);
    for (let i = 0; i < 4; i += 1) rows.push(record(`T-${day}-${i}`, tradingDate, day * 4 + i));
  }
  return rows;
}

test("insufficient evidence cannot create a calibration/OOS partition", () => {
  const result = buildPsychologyCalibrationPartition([record("ONLY", "2026-01-01", 0)]);
  assert.equal(result.status, "PROTOCOL_GATE_BLOCKED");
  assert.equal(result.calibrationTradingDates.length, 0);
  assert.equal(result.oosTradingDates.length, 0);
  assert.equal(result.promotionEligible, false);
});

test("sufficient evidence is split by whole trading dates into earliest calibration and latest untouched OOS", () => {
  const result = buildPsychologyCalibrationPartition(sufficientRows());
  assert.equal(result.status, "PARTITION_READY");
  assert.equal(result.calibrationTradingDateCount, 46);
  assert.equal(result.oosTradingDateCount, 21);
  assert.equal(result.calibrationTradingDates.at(-1)! < result.oosTradingDates[0]!, true);
  assert.equal(new Set(result.calibrationTradingDates.filter((d) => result.oosTradingDates.includes(d))).size, 0);
  assert.equal(result.calibrationRecords.length, 184);
  assert.equal(result.oosRecords.length, 84);
  assert.equal(result.chronologicalOrderVerified, true);
  assert.equal(result.sameDateCrossPartition, false);
  assert.equal(result.oosUntouched, true);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("partition assignment is invariant to input row order", () => {
  const rows = sufficientRows();
  const forward = buildPsychologyCalibrationPartition(rows);
  const reversed = buildPsychologyCalibrationPartition([...rows].reverse());
  assert.deepEqual(reversed.calibrationTradingDates, forward.calibrationTradingDates);
  assert.deepEqual(reversed.oosTradingDates, forward.oosTradingDates);
});
