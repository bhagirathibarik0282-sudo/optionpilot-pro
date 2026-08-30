import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateHistoryRecord } from "../candidate-history-record.ts";
import {
  preparePsychologyEvidenceCollectionBatch,
  preparePsychologyEvidenceCollectionCandidate,
} from "../psychology-real-evidence-collector.ts";
import type { PsychologyReplayValidationInput } from "../psychology-shadow-replay-adapter.ts";

function candidate(candidateId = "T1", observedAt = "2026-08-20T09:20:00+05:30"): CandidateHistoryRecord {
  return {
    candidateId,
    symbol: "NIFTY",
    observedAt: new Date(observedAt).toISOString(),
    side: "CE",
    expiry: "2026-08-20",
    strike: 25000,
    dte: 0,
    ltp: 120,
    iv: 14,
    delta: 0.51,
    gamma: 0.002,
    vega: 8,
    theta: -12,
    intrinsic: 20,
    extrinsic: 100,
    spread: 1,
    volume: 1000,
    oi: 5000,
    grade: "A",
    status: "OBSERVED",
    reasonCode: "QUALITY_OBSERVED",
    selectionVersion: "TEST_SELECTOR_V1",
  };
}

function input(tradeId = "T1", withProvenance = true): PsychologyReplayValidationInput {
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
      regimes: ["TREND"],
      ...(withProvenance ? {
        regimeEvidence: [{
          regime: "TREND",
          source: "DETERMINISTIC_UPSTREAM" as const,
          observedAt: "2026-08-20T09:20:30+05:30",
          ruleVersion: "REGIME_RULE_V1",
        }],
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

test("collector prepares a provenance-backed observed candidate for persistence", () => {
  const result = preparePsychologyEvidenceCollectionCandidate({
    candidate: candidate(),
    input: input(),
    recordedAt: "2026-08-20T10:00:00+05:30",
  });
  assert.equal(result.status, "READY_TO_PERSIST");
  assert.equal(result.candidateId, "T1");
  assert.ok(result.record);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("collector blocks legacy diagnostic regimes without deterministic provenance", () => {
  const result = preparePsychologyEvidenceCollectionCandidate({
    candidate: candidate(),
    input: input("T1", false),
    recordedAt: "2026-08-20T10:00:00+05:30",
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.record, null);
  assert.ok(result.blockers.includes("REGIME_EVIDENCE_MISSING"));
});

test("collector blocks candidate identity mismatch", () => {
  const result = preparePsychologyEvidenceCollectionCandidate({
    candidate: candidate("CANDIDATE-X"),
    input: input("T1"),
    recordedAt: "2026-08-20T10:00:00+05:30",
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("CANDIDATE_VALIDATION_TRADE_ID_MISMATCH"));
  assert.ok(result.blockers.includes("CANDIDATE_REPLAY_KEY_MISMATCH"));
});

test("collector blocks candidate evidence observed after the replay decision", () => {
  const result = preparePsychologyEvidenceCollectionCandidate({
    candidate: candidate("T1", "2026-08-20T09:22:00+05:30"),
    input: input(),
    recordedAt: "2026-08-20T10:00:00+05:30",
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("CANDIDATE_OBSERVED_AFTER_DECISION"));
});

test("batch exposes ready and blocked counts without persisting or promoting", () => {
  const result = preparePsychologyEvidenceCollectionBatch([
    { candidate: candidate("T1"), input: input("T1"), recordedAt: "2026-08-20T10:00:00+05:30" },
    { candidate: candidate("T2"), input: input("T2", false), recordedAt: "2026-08-20T10:01:00+05:30" },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.ready, 1);
  assert.equal(result.blocked, 1);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});
