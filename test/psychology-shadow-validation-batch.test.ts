import test from "node:test";
import assert from "node:assert/strict";
import { runPsychologyValidationBatch } from "../psychology-shadow-validation-batch.ts";
import type { PsychologyReplayValidationInput } from "../psychology-shadow-replay-adapter.ts";
import type { ShadowValidationObservation } from "../psychology-shadow-validation.ts";

function validation(tradeId: string, regime: ShadowValidationObservation["regime"] = "TREND"): ShadowValidationObservation {
  return {
    tradeId,
    regime,
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
  };
}

function input(tradeId: string, source: PsychologyReplayValidationInput["source"] = "REAL_REPLAY"): PsychologyReplayValidationInput {
  return {
    source,
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
    validation: validation(tradeId),
  };
}

test("accepted real evidence flows into frozen validation metrics", () => {
  const r = runPsychologyValidationBatch([input("T1")]);
  assert.equal(r.acceptedInputs, 1);
  assert.equal(r.rejectedInputs, 0);
  assert.equal(r.acceptedRealReplay, 1);
  assert.equal(r.validation?.observations, 1);
  assert.equal(r.validation?.promotionEligible, false);
});

test("rejected evidence is surfaced and never enters validation", () => {
  const bad = input("T2", "SYNTHETIC");
  const r = runPsychologyValidationBatch([input("T1"), bad]);
  assert.equal(r.acceptedInputs, 1);
  assert.equal(r.rejectedInputs, 1);
  assert.equal(r.validation?.observations, 1);
  assert.ok(r.blockers.includes("EVIDENCE_REJECTIONS_PRESENT"));
  assert.ok(r.rejections[0].blockers.includes("SYNTHETIC_EVIDENCE_NOT_ACCEPTED"));
});

test("empty batch fails closed", () => {
  const r = runPsychologyValidationBatch([]);
  assert.equal(r.validation, null);
  assert.equal(r.promotionEligible, false);
  assert.ok(r.blockers.includes("NO_EVIDENCE_INPUTS"));
  assert.ok(r.blockers.includes("NO_ACCEPTED_REAL_EVIDENCE"));
});

test("duplicate accepted trade ids cannot corrupt aggregate metrics", () => {
  const r = runPsychologyValidationBatch([input("T1"), input("T1")]);
  assert.equal(r.validation, null);
  assert.ok(r.blockers.some((b) => b.startsWith("VALIDATION_INPUT_INVALID:duplicate tradeId")));
});

test("invalid aggregate counters fail closed without throwing the batch runner", () => {
  const bad = input("T1");
  bad.validation = { ...bad.validation, spokenUpdates: 5, eligibleMessages: 4 };
  const r = runPsychologyValidationBatch([bad]);
  assert.equal(r.validation, null);
  assert.ok(r.blockers.some((b) => b.startsWith("VALIDATION_INPUT_INVALID:spokenUpdates")));
});

test("live observation provenance is counted separately", () => {
  const r = runPsychologyValidationBatch([input("T1", "LIVE_OBSERVATION")]);
  assert.equal(r.acceptedLiveObservation, 1);
  assert.equal(r.acceptedRealReplay, 0);
});

test("batch pipeline has no live authority", () => {
  const r = runPsychologyValidationBatch([input("T1")]);
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
  assert.equal(r.promotionEligible, false);
});
