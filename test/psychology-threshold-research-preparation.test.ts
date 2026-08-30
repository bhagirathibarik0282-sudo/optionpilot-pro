import test from "node:test";
import assert from "node:assert/strict";
import { preparePsychologyThresholdResearch } from "../psychology-threshold-research-preparation.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, SHADOW_VALIDATION_METRICS, type ShadowValidationRegime } from "../psychology-shadow-validation.ts";

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

test("insufficient calibration evidence cannot enter threshold research", () => {
  const result = preparePsychologyThresholdResearch([]);
  assert.equal(result.status, "CALIBRATION_METRICS_BLOCKED");
  assert.equal(result.metricCards.length, 0);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
});

test("prepares all 10 calibration metrics without inventing thresholds", () => {
  const result = preparePsychologyThresholdResearch(sufficientRows());
  assert.equal(result.status, "READY_FOR_THRESHOLD_RESEARCH");
  assert.equal(result.metricCards.length, Object.keys(SHADOW_VALIDATION_METRICS).length);
  assert.equal(result.allTenFrozenMetricsPresent, true);
  assert.equal(result.oosReadForThresholdResearch, false);
  assert.equal(result.oosUsedForThresholdSelection, false);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
  for (const card of result.metricCards) {
    assert.equal(card.definition, SHADOW_VALIDATION_METRICS[card.metric].definition);
    assert.equal(card.preferredDirection, SHADOW_VALIDATION_METRICS[card.metric].preferredDirection);
    assert.equal(card.acceptanceThreshold, null);
    assert.equal(card.thresholdSelected, false);
    assert.equal(card.thresholdFrozen, false);
  }
  const flips = result.metricCards.find((card) => card.metric === "STATE_FLIPS_PER_TRADE");
  assert.equal(flips?.metricFamily, "COUNT_PER_TRADE");
  assert.equal(flips?.preregisteredUncertaintyMethod, "TRADING_DATE_CLUSTER_BOOTSTRAP_95");
  const chase = result.metricCards.find((card) => card.metric === "FALSE_CHASE_WARNING_RATE");
  assert.equal(chase?.metricFamily, "BINOMIAL_RATE");
  assert.equal(chase?.preregisteredUncertaintyMethod, "WILSON_95");
});
