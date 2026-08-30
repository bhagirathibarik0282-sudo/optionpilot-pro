import test from "node:test";
import assert from "node:assert/strict";
import { createOutcomeRecord } from "../outcome-engine.js";
import { mapVerifiedOutcome } from "../h1-outcome-attribution.js";
import { buildPsychologyRetrospectiveOutcomeEvents, type PsychologyRetrospectiveAdjudication } from "../psychology-retrospective-outcome-evidence.ts";

function verifiedOutcome(status: any) {
  const base = createOutcomeRecord({
    symbol: "NIFTY", tradingDate: "2026-08-28", verdict: "BUY", score: 8, maxScore: 10, confidence: "HIGH",
    side: "CE", strike: 25000, entry: 100, sl: 80, t1: 120, t2: 140, t3: 200,
    signalContributions: {}, windowMinutes: 60, nowMs: Date.parse("2026-08-28T04:00:00Z"), idSuffix: "x", planId: "p1", horizon: "60m",
  });
  return mapVerifiedOutcome({
    ...base,
    status,
    evaluatedAt: "2026-08-28T05:00:00Z",
    maeR: 0.4,
    mfeR: 1.2,
    maePremium: 8,
    mfePremium: 24,
  } as any);
}

function input(status: any, adjudications: PsychologyRetrospectiveAdjudication[] = []) {
  const outcome = verifiedOutcome(status);
  return {
    tradeId: "T1",
    evaluationCutoffAt: "2026-08-28T05:15:00Z",
    eventSource: "DETERMINISTIC_REPLAY" as const,
    eventRuleVersion: "PSY_RETRO_EVENT_V1",
    binding: {
      tradeId: "T1",
      outcomeId: outcome.outcomeId,
      source: "DETERMINISTIC_OUTCOME_BINDING" as const,
      ruleVersion: "OUTCOME_BINDING_V1",
    },
    outcome,
    adjudications,
  };
}

const baseEvidence = {
  tradeId: "T1",
  observedAt: "2026-08-28T05:05:00Z",
  source: "DETERMINISTIC_REPLAY" as const,
  ruleVersion: "RETRO_RULE_V1",
};

test("projects deterministic retrospective adjudications into deferred validation events", () => {
  const adjudications: PsychologyRetrospectiveAdjudication[] = [
    { ...baseEvidence, evidenceId: "e1", kind: "CHASE_WARNING_ADJUDICATED", falseWarning: true },
    { ...baseEvidence, evidenceId: "e2", kind: "LATE_EXIT_ADJUDICATED", priorExitOrProtectWarning: false },
    { ...baseEvidence, evidenceId: "e3", kind: "THESIS_FAILURE_ADJUDICATED", priorThesisWarning: true },
    { ...baseEvidence, evidenceId: "e4", kind: "SIDE_FLIP_ADJUDICATED", freshDeterministicSetup: false },
    { ...baseEvidence, evidenceId: "e5", kind: "STOP_RESPECT_ADJUDICATED", stopRespected: false },
    { ...baseEvidence, evidenceId: "e6", kind: "PROFIT_PROTECTION_ADJUDICATED", useful: true },
  ];
  const result = buildPsychologyRetrospectiveOutcomeEvents(input("STOP_HIT", adjudications));
  assert.equal(result.status, "READY");
  assert.equal(result.events.length, 6);
  assert.equal(result.unresolvedSources.length, 0);
  assert.ok(result.events.some((event) => event.kind === "STOPPED_TRADE" && event.stopRespected === false));
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("STOP_HIT alone does not invent stop-respect quality", () => {
  const result = buildPsychologyRetrospectiveOutcomeEvents(input("STOP_HIT"));
  assert.equal(result.status, "READY");
  assert.equal(result.events.length, 0);
  assert.ok(result.unresolvedSources.includes("STOP_RESPECT_ADJUDICATION_NOT_SUPPLIED"));
});

test("stop-respect adjudication requires verified STOP_HIT outcome", () => {
  const adjudication: PsychologyRetrospectiveAdjudication = {
    ...baseEvidence, evidenceId: "e-stop", kind: "STOP_RESPECT_ADJUDICATED", stopRespected: true,
  };
  const result = buildPsychologyRetrospectiveOutcomeEvents(input("TARGET_T1_HIT", [adjudication]));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("STOP_RESPECT_REQUIRES_STOP_HIT_OUTCOME"));
});

test("outcome binding must match the verified outcome", () => {
  const request = input("STOP_HIT");
  request.binding.outcomeId = "wrong";
  const result = buildPsychologyRetrospectiveOutcomeEvents(request);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("OUTCOME_BINDING_OUTCOME_ID_MISMATCH"));
});

test("duplicate adjudication evidence ids are rejected", () => {
  const adjudications: PsychologyRetrospectiveAdjudication[] = [
    { ...baseEvidence, evidenceId: "dup", kind: "CHASE_WARNING_ADJUDICATED", falseWarning: false },
    { ...baseEvidence, evidenceId: "dup", kind: "THESIS_FAILURE_ADJUDICATED", priorThesisWarning: true },
  ];
  const result = buildPsychologyRetrospectiveOutcomeEvents(input("TARGET_T1_HIT", adjudications));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("DUPLICATE_EVIDENCE_ID:dup"));
});

test("outcome and adjudication timestamps cannot exceed evaluation cutoff", () => {
  const request = input("STOP_HIT", [{
    ...baseEvidence,
    evidenceId: "late",
    observedAt: "2026-08-28T05:16:00Z",
    kind: "CHASE_WARNING_ADJUDICATED",
    falseWarning: false,
  }]);
  const result = buildPsychologyRetrospectiveOutcomeEvents(request);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("EVIDENCE_AFTER_EVALUATION_CUTOFF:CHASE_WARNING_ADJUDICATED"));

  const outcomeLate = input("STOP_HIT");
  outcomeLate.outcome = { ...outcomeLate.outcome, evaluatedAt: "2026-08-28T05:16:00Z" };
  const result2 = buildPsychologyRetrospectiveOutcomeEvents(outcomeLate);
  assert.equal(result2.status, "BLOCKED");
  assert.ok(result2.blockers.includes("OUTCOME_AFTER_EVALUATION_CUTOFF"));
});
