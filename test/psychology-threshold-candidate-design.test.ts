import test from "node:test";
import assert from "node:assert/strict";
import { designPsychologyThresholdCandidates } from "../psychology-threshold-candidate-design.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, type ShadowValidationRegime } from "../psychology-shadow-validation.ts";

function isoDate(dayIndex: number): string {
  return new Date(Date.UTC(2026, 0, 1 + dayIndex)).toISOString().slice(0, 10);
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
    const tradingDate = isoDate(day);
    for (let i = 0; i < REQUIRED_SHADOW_REGIMES.length; i += 1) {
      rows.push(record(`T-${day}-${i}`, REQUIRED_SHADOW_REGIMES[i]!, tradingDate));
    }
  }
  return rows;
}

test("fails closed when threshold research preparation is not ready", () => {
  const result = designPsychologyThresholdCandidates([]);
  assert.equal(result.status, "THRESHOLD_RESEARCH_BLOCKED");
  assert.deepEqual(result.cards, []);
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.promotionEligible, false);
});

test("designs all ten candidate research cards without selecting thresholds", () => {
  const result = designPsychologyThresholdCandidates(sufficientRows());
  assert.equal(result.status, "READY_FOR_UNCERTAINTY_ESTIMATION");
  assert.equal(result.cards.length, 10);
  assert.equal(result.allTenFrozenMetricsPresent, true);
  assert.equal(result.uncertaintyRequiredBeforeCandidateSelection, true);
  assert.equal(result.thresholdSelectionRuleFrozen, false);
  assert.equal(result.oosReadForCandidateDesign, false);
  assert.equal(result.oosUsedForCandidateSelection, false);
  for (const card of result.cards) {
    assert.equal(card.candidateThreshold, null);
    assert.equal(card.candidateSelected, false);
    assert.equal(card.candidateFrozen, false);
    assert.equal(card.uncertaintyLower, null);
    assert.equal(card.uncertaintyUpper, null);
    assert.equal(card.comparisonOperator, card.preferredDirection === "LOWER" ? "LESS_THAN_OR_EQUAL" : "GREATER_THAN_OR_EQUAL");
  }
  assert.equal(result.acceptanceThresholdsProposed, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("profit protection remains the only higher-is-better gate", () => {
  const result = designPsychologyThresholdCandidates(sufficientRows());
  const higher = result.cards.filter((card) => card.preferredDirection === "HIGHER");
  assert.equal(higher.length, 1);
  assert.equal(higher[0]?.metric, "PROFIT_PROTECTION_USEFULNESS_RATE");
  assert.equal(higher[0]?.comparisonOperator, "GREATER_THAN_OR_EQUAL");
});
