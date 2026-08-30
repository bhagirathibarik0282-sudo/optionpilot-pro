import test from "node:test";
import assert from "node:assert/strict";
import { buildPsychologyRealEvidenceRunnerResult } from "../psychology-real-evidence-runner.ts";
import { preparePsychologyRealEvidenceForStorage } from "../psychology-real-evidence-store.ts";
import type { PsychologyReplayValidationInput } from "../psychology-shadow-replay-adapter.ts";

function input(tradeId = "T1", regimes: PsychologyReplayValidationInput["validation"]["regimes"] = ["TREND"]): PsychologyReplayValidationInput {
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

test("restored admitted evidence feeds the ledger but regime coverage stays provenance-blocked", () => {
  const row = preparePsychologyRealEvidenceForStorage(input("T1", ["TREND", "EXPIRY"]), "2026-08-20T10:00:00+05:30");
  assert.ok(row);
  const result = buildPsychologyRealEvidenceRunnerResult([row!]);
  assert.equal(result.restoredRecords, 1);
  assert.equal(result.ledger.acceptedInputs, 1);
  assert.equal(result.ledger.regimeTradeCounts.TREND, 1);
  assert.equal(result.ledger.regimeTradeCounts.EXPIRY, 1);
  assert.equal(result.regimeTagProvenanceVerified, false);
  assert.equal(result.status, "EVIDENCE_PRESENT_PROVENANCE_BLOCKED");
  assert.ok(result.blockers.includes("REGIME_TAG_PROVENANCE_NOT_VERIFIED"));
  assert.equal(result.promotionEligible, false);
});

test("runner preserves research-only authority boundaries", () => {
  const row = preparePsychologyRealEvidenceForStorage(input(), "2026-08-20T10:00:00+05:30")!;
  const result = buildPsychologyRealEvidenceRunnerResult([row]);
  assert.equal(result.acceptanceThresholdsFrozen, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});
