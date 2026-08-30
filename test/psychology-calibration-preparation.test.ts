import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyCalibrationPreparation } from "../psychology-calibration-preparation.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, type ShadowValidationRegime } from "../psychology-shadow-validation.ts";

function record(tradeId: string, regime: ShadowValidationRegime, tradingDate: string, source: "REAL_REPLAY" | "LIVE_OBSERVATION" = "REAL_REPLAY"): StoredPsychologyRealEvidence {
  const decisionAt = `${tradingDate}T10:00:00Z`;
  const prepared = preparePsychologyRealEvidenceForStorage({
    source,
    replay: {
      logicalKey: tradeId,
      observedAt: `${tradingDate}T09:59:00Z`,
      decisionAt,
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

function structurallyReadyRows(): StoredPsychologyRealEvidence[] {
  return REQUIRED_SHADOW_REGIMES.map((regime, index) => record(
    `T${index + 1}`,
    regime,
    index < 4 ? "2026-08-20" : "2026-08-21",
    index === 7 ? "LIVE_OBSERVATION" : "REAL_REPLAY",
  ));
}

test("empty evidence remains blocked and cannot imply calibration sufficiency", () => {
  const result = buildPsychologyCalibrationPreparation([]);
  assert.equal(result.status, "NO_EVIDENCE");
  assert.equal(result.statisticalSufficiencyEstablished, false);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
  assert.ok(result.blockers.includes("NO_REAL_EVIDENCE_RECORDS"));
});

test("structurally complete evidence advances only to calibration protocol design", () => {
  const result = buildPsychologyCalibrationPreparation(structurallyReadyRows());
  assert.equal(result.status, "READY_FOR_CALIBRATION_PROTOCOL_DESIGN");
  assert.equal(result.readiness.status, "STRUCTURALLY_READY_FOR_THRESHOLD_RESEARCH");
  assert.equal(result.uniqueTradingDates, 2);
  assert.equal(result.earliestTradingDate, "2026-08-20");
  assert.equal(result.latestTradingDate, "2026-08-21");
  assert.equal(result.chronologicalPartitionStructurallyPossible, true);
  assert.equal(result.sourceCounts.REAL_REPLAY, 7);
  assert.equal(result.sourceCounts.LIVE_OBSERVATION, 1);
  assert.equal(result.unresolvedProtocolItems.length, 8);
  assert.ok(result.unresolvedProtocolItems.includes("OUT_OF_SAMPLE_SPLIT_RULE"));
  assert.ok(result.unresolvedProtocolItems.includes("MINIMUM_SAMPLE_CRITERIA_PER_REGIME"));
  assert.equal(result.calibrationProtocolFrozen, false);
  assert.equal(result.statisticalSufficiencyEstablished, false);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("one trading date is not enough even for a chronological partition", () => {
  const rows = REQUIRED_SHADOW_REGIMES.map((regime, index) => record(`D${index + 1}`, regime, "2026-08-20"));
  const result = buildPsychologyCalibrationPreparation(rows);
  assert.equal(result.status, "READY_FOR_CALIBRATION_PROTOCOL_DESIGN");
  assert.equal(result.chronologicalPartitionStructurallyPossible, false);
  assert.ok(result.blockers.includes("CHRONOLOGICAL_PARTITION_NOT_STRUCTURALLY_POSSIBLE"));
  assert.equal(result.statisticalSufficiencyEstablished, false);
});

test("missing structural evidence cannot advance to calibration design", () => {
  const result = buildPsychologyCalibrationPreparation([record("ONLY", "TREND", "2026-08-20")]);
  assert.equal(result.status, "STRUCTURAL_EVIDENCE_BLOCKED");
  assert.ok(result.blockers.some((blocker) => blocker.startsWith("STRUCTURAL_READINESS_BLOCKED:")));
  assert.equal(result.acceptanceThresholdsProposed, false);
});
