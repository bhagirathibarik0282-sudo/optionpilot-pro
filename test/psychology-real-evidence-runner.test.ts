import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyRealEvidenceRunnerResult } from "../psychology-real-evidence-runner.ts";
import { preparePsychologyRealEvidenceForStorage } from "../psychology-real-evidence-store.ts";
import type { PsychologyReplayValidationInput } from "../psychology-shadow-replay-adapter.ts";

function input(
  tradeId = "T1",
  regimes: PsychologyReplayValidationInput["validation"]["regimes"] = ["TREND"],
  withProvenance = false,
): PsychologyReplayValidationInput {
  return {
    source: "REAL_REPLAY",
    replay: {
      logicalKey: tradeId,
      observedAt: "2026-08-20T09:20:00+05:30",
      decisionAt: "2026-08-20T09:21:00+05:30",
      blockEnd: "2026-08-20T09:20:00+05:30",
      blockClosed: true,
      quality: "TRUE",
      expiry: "2026-08-20",
      dte: 0,
      tradingDate: "2026-08-20",
      sessionEligible: true,
    },
    validation: {
      tradeId,
      regimes,
      ...(withProvenance ? {
        regimeEvidence: regimes.map((regime) => ({
          regime,
          source: "DETERMINISTIC_UPSTREAM" as const,
          observedAt: "2026-08-20T09:20:30+05:30",
          ruleVersion: "REGIME_RULE_V1",
        })),
      } : {}),
      completedTrade: true,
      chaseWarnings: 1,
      falseChaseWarnings: 0,
      lateExitEvents: 1,
      missedLateExitWarnings: 0,
      thesisFailures: 1,
      missedThesisFailures: 0,
      stateFlips: 1,
      eligibleMessages: 4,
      duplicateMessages: 0,
      spokenUpdates: 3,
      wrongSideFlips: 0,
      entries: 1,
      entriesAfterExtension: 0,
      stoppedTrades: 1,
      stopRespectViolations: 0,
      profitProtectionOpportunities: 1,
      usefulProfitProtectionEvents: 1,
    },
  };
}

test("empty restored store is explicit NO_EVIDENCE and never promotion eligible", () => {
  const result = buildPsychologyRealEvidenceRunnerResult([]);
  assert.equal(result.status, "NO_EVIDENCE");
  assert.equal(result.restoredRecords, 0);
  assert.ok(result.blockers.includes("NO_STORED_REAL_EVIDENCE"));
  assert.equal(result.promotionEligible, false);
});

test("legacy diagnostic regime tags stay provenance-blocked", () => {
  const row = preparePsychologyRealEvidenceForStorage(input("T1", ["TREND", "EXPIRY"], false), "2026-08-20T10:00:00+05:30")!;
  const result = buildPsychologyRealEvidenceRunnerResult([row]);
  assert.equal(result.ledger.regimeTradeCounts.TREND, 0);
  assert.equal(result.ledger.regimeTradeCounts.EXPIRY, 0);
  assert.equal(result.regimeTagProvenanceVerified, false);
  assert.equal(result.status, "EVIDENCE_PRESENT_PROVENANCE_BLOCKED");
  assert.ok(result.blockers.includes("REGIME_TAG_PROVENANCE_NOT_VERIFIED"));
});

test("valid deterministic regime evidence clears provenance blocker but not coverage", () => {
  const row = preparePsychologyRealEvidenceForStorage(input("T1", ["TREND", "EXPIRY"], true), "2026-08-20T10:00:00+05:30")!;
  const result = buildPsychologyRealEvidenceRunnerResult([row]);
  assert.equal(result.regimeTagProvenanceVerified, true);
  assert.equal(result.ledger.regimeTradeCounts.TREND, 1);
  assert.equal(result.ledger.regimeTradeCounts.EXPIRY, 1);
  assert.equal(result.status, "COVERAGE_INCOMPLETE");
  assert.equal(result.blockers.includes("REGIME_TAG_PROVENANCE_NOT_VERIFIED"), false);
  assert.equal(result.promotionEligible, false);
});

test("runner preserves research-only authority boundaries", () => {
  const row = preparePsychologyRealEvidenceForStorage(input("T1", ["TREND"], true), "2026-08-20T10:00:00+05:30")!;
  const result = buildPsychologyRealEvidenceRunnerResult([row]);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});
