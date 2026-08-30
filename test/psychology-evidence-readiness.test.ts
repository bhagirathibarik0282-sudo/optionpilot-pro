import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyEvidenceReadiness } from "../psychology-evidence-readiness.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "../psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES } from "../psychology-shadow-validation.ts";

function fullRecord(): StoredPsychologyRealEvidence {
  const decisionAt = "2026-08-20T09:21:00+05:30";
  const record = preparePsychologyRealEvidenceForStorage({
    source: "REAL_REPLAY",
    replay: {
      logicalKey: "T1",
      observedAt: "2026-08-20T09:20:00+05:30",
      decisionAt,
      blockEnd: "2026-08-20T09:20:00+05:30",
      blockClosed: true,
      quality: "TRUE",
      expiry: "2026-08-20",
      dte: 0,
      tradingDate: "2026-08-20",
      sessionEligible: true,
    },
    validation: {
      tradeId: "T1",
      regimes: [...REQUIRED_SHADOW_REGIMES],
      regimeEvidence: REQUIRED_SHADOW_REGIMES.map((regime, index) => ({
        regime,
        source: "DETERMINISTIC_UPSTREAM" as const,
        observedAt: new Date(Date.parse(decisionAt) - (index + 1) * 1000).toISOString(),
        ruleVersion: `REGIME_${regime}_V1`,
      })),
      completedTrade: true,
      chaseWarnings: 1,
      falseChaseWarnings: 0,
      lateExitEvents: 1,
      missedLateExitWarnings: 0,
      thesisFailures: 1,
      missedThesisFailures: 0,
      stateFlips: 2,
      eligibleMessages: 4,
      duplicateMessages: 1,
      spokenUpdates: 3,
      wrongSideFlips: 0,
      entries: 1,
      entriesAfterExtension: 0,
      stoppedTrades: 1,
      stopRespectViolations: 0,
      profitProtectionOpportunities: 1,
      usefulProfitProtectionEvents: 1,
    },
  }, "2026-08-20T10:00:00+05:30");
  assert.ok(record);
  return record;
}

test("reports structural readiness only when all regimes and metric denominators exist", () => {
  const result = buildPsychologyEvidenceReadiness([fullRecord()]);
  assert.equal(result.status, "STRUCTURALLY_READY_FOR_THRESHOLD_RESEARCH");
  assert.equal(result.allRegimesObserved, true);
  assert.equal(result.allMetricDenominatorsObserved, true);
  assert.equal(result.zeroDenominatorMetrics.length, 0);
  assert.equal(result.statisticalSufficiencyEstablished, false);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.promotionEligible, false);
  assert.ok(result.blockers.includes("STATISTICAL_SUFFICIENCY_NOT_ESTABLISHED"));
});

test("reports metric denominator gaps without treating zero evidence as a good metric", () => {
  const row = fullRecord();
  row.validation.chaseWarnings = 0;
  row.validation.falseChaseWarnings = 0;
  const result = buildPsychologyEvidenceReadiness([row]);
  assert.equal(result.status, "METRIC_DENOMINATORS_INCOMPLETE");
  assert.ok(result.zeroDenominatorMetrics.includes("FALSE_CHASE_WARNING_RATE"));
});

test("empty evidence remains NO_EVIDENCE and never promotion eligible", () => {
  const result = buildPsychologyEvidenceReadiness([]);
  assert.equal(result.status, "NO_EVIDENCE");
  assert.equal(result.promotionEligible, false);
  assert.equal(result.statisticalSufficiencyEstablished, false);
});

test("invalid stored rows are surfaced rather than silently ignored", () => {
  const invalid = { ...fullRecord(), evidenceKey: "tampered" } as StoredPsychologyRealEvidence;
  const result = buildPsychologyEvidenceReadiness([invalid]);
  assert.equal(result.status, "INVALID_EVIDENCE_PRESENT");
  assert.equal(result.invalidRecords, 1);
  assert.ok(result.blockers.includes("INVALID_EVIDENCE_RECORDS:1"));
});
