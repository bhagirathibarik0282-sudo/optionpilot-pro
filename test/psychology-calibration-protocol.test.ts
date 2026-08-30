import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyCalibrationPreparation } from "../psychology-calibration-preparation.ts";
import {
  PSYCHOLOGY_CALIBRATION_PROTOCOL_V1,
  evaluatePsychologyCalibrationProtocolGate,
} from "../psychology-calibration-protocol.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, type ShadowValidationRegime } from "../psychology-shadow-validation.ts";

function isoDate(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
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
        ruleVersion: "REGIME_PROTOCOL_TEST_V1",
      }],
      completedTrade: true,
      chaseWarnings: 1,
      falseChaseWarnings: 0,
      lateExitEvents: 1,
      missedLateExitWarnings: 0,
      thesisFailures: 1,
      missedThesisFailures: 0,
      stateFlips: 1,
      eligibleMessages: 1,
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
  for (let i = 0; i < 240; i += 1) {
    rows.push(record(
      `P${i + 1}`,
      REQUIRED_SHADOW_REGIMES[i % REQUIRED_SHADOW_REGIMES.length],
      isoDate(i % 70),
    ));
  }
  return rows;
}

test("protocol freezes research governance but not acceptance thresholds or authority", () => {
  const p = PSYCHOLOGY_CALIBRATION_PROTOCOL_V1;
  assert.equal(p.governance.protocolFrozen, true);
  assert.equal(p.governance.acceptanceThresholdsFrozen, false);
  assert.equal(p.sampleCriteria.minimumUniqueTradingDates, 67);
  assert.equal(p.sampleCriteria.minimumCompletedTrades, 200);
  assert.equal(p.sampleCriteria.minimumTradesPerMandatoryRegime, 30);
  assert.equal(p.sampleCriteria.minimumDenominatorPerMetric, 100);
  assert.equal(p.chronologicalSplit.oosMayTuneThresholds, false);
  assert.equal(p.multipleComparisonControl.method, "HOLM_BONFERRONI");
  assert.equal(p.thresholdSelectionObjective.weightedCompositeScoreAllowed, false);
  assert.equal(p.recalibrationPolicy.automaticLiveRetuningAllowed, false);
  assert.equal(p.authority.affectsTelegram, false);
  assert.equal(p.authority.affectsVerdict, false);
  assert.equal(p.authority.affectsExecution, false);
});

test("empty preparation is fail-closed", () => {
  const gate = evaluatePsychologyCalibrationProtocolGate(buildPsychologyCalibrationPreparation([]));
  assert.equal(gate.status, "PREPARATION_BLOCKED");
  assert.equal(gate.statisticalSufficiencyEstablished, false);
  assert.equal(gate.acceptanceThresholdsProposed, false);
  assert.equal(gate.acceptanceThresholdsFrozen, false);
  assert.equal(gate.promotionEligible, false);
  assert.ok(gate.blockers.some((b) => b.startsWith("PREPARATION_NOT_READY:")));
});

test("structurally ready but small evidence remains sample-insufficient", () => {
  const rows = REQUIRED_SHADOW_REGIMES.map((regime, index) => record(`S${index + 1}`, regime, isoDate(index % 2)));
  const preparation = buildPsychologyCalibrationPreparation(rows);
  assert.equal(preparation.status, "READY_FOR_CALIBRATION_PROTOCOL_DESIGN");
  const gate = evaluatePsychologyCalibrationProtocolGate(preparation);
  assert.equal(gate.status, "SAMPLE_INSUFFICIENT");
  assert.equal(gate.statisticalSufficiencyEstablished, false);
  assert.ok(gate.blockers.some((b) => b.startsWith("TRADING_DATES_BELOW_MINIMUM:")));
  assert.ok(gate.blockers.some((b) => b.startsWith("COMPLETED_TRADES_BELOW_MINIMUM:")));
  assert.ok(gate.blockers.includes("REGIME_SAMPLE_CRITERIA_NOT_MET"));
  assert.ok(gate.blockers.includes("METRIC_DENOMINATOR_CRITERIA_NOT_MET"));
  assert.ok(gate.blockers.includes("CHRONOLOGICAL_PARTITION_MINIMUMS_NOT_MET"));
});

test("pre-registered minima permit calibration partition only, never promotion", () => {
  const preparation = buildPsychologyCalibrationPreparation(sufficientRows());
  assert.equal(preparation.status, "READY_FOR_CALIBRATION_PROTOCOL_DESIGN");
  assert.equal(preparation.uniqueTradingDates, 70);
  const gate = evaluatePsychologyCalibrationProtocolGate(preparation);
  assert.equal(gate.status, "READY_FOR_CALIBRATION_PARTITION");
  assert.equal(gate.statisticalSufficiencyEstablished, true);
  assert.equal(gate.chronologicalPartitionEligible, true);
  assert.deepEqual(gate.regimeDeficits, {});
  assert.deepEqual(gate.metricDenominatorDeficits, {});
  assert.equal(gate.acceptanceThresholdsProposed, false);
  assert.equal(gate.acceptanceThresholdsFrozen, false);
  assert.equal(gate.promotionEligible, false);
  assert.equal(gate.affectsTelegram, false);
  assert.equal(gate.affectsVerdict, false);
  assert.equal(gate.affectsExecution, false);
});
