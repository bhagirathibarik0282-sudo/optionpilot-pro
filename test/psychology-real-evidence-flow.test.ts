import test from "node:test";
import assert from "node:assert/strict";
import type { CandidateHistoryRecord } from "../candidate-history-record.ts";
import { createOutcomeRecord } from "../outcome-engine.js";
import { mapVerifiedOutcome } from "../h1-outcome-attribution.js";
import type { CandidateIdentity } from "../live-psychology-coach-contract.ts";
import { buildPsychologyCandidateKey, type PsychologyShadowChainResult } from "../psychology-shadow-chain.ts";
import { preparePsychologyRealEvidenceFlow } from "../psychology-real-evidence-flow.ts";
import type { PsychologyRetrospectiveAdjudication } from "../psychology-retrospective-outcome-evidence.ts";

const candidateIdentity: CandidateIdentity = {
  style: "SCALP",
  symbol: "NIFTY",
  strike: 25000,
  side: "CE",
  expiryDate: "2026-08-28",
  candidateId: "T1",
};

function candidate(): CandidateHistoryRecord {
  return {
    candidateId: "T1",
    symbol: "NIFTY",
    observedAt: "2026-08-28T04:00:00.000Z",
    side: "CE",
    expiry: "2026-08-28",
    strike: 25000,
    dte: 0,
    ltp: 100,
    iv: 14,
    delta: 0.51,
    gamma: 0.002,
    vega: 8,
    theta: -12,
    intrinsic: 10,
    extrinsic: 90,
    spread: 1,
    volume: 1000,
    oi: 5000,
    grade: "A",
    status: "OBSERVED",
    reasonCode: "QUALITY_OBSERVED",
    selectionVersion: "TEST_SELECTOR_V1",
  };
}

function chain(input: {
  lifecycle: string;
  fingerprint: string;
  eligible?: boolean;
  duplicate?: boolean;
  shouldSpeak?: boolean;
  risks?: string[];
}): PsychologyShadowChainResult {
  return {
    candidateKey: buildPsychologyCandidateKey(candidateIdentity),
    currentFingerprint: input.fingerprint,
    premium: { state: "RESPONDING_WELL" },
    buyerSeller: { state: "BUYERS_IN_CONTROL" },
    lifecycle: { nextState: input.lifecycle },
    behaviourRisk: { risks: input.risks ?? [] },
    trigger: {
      eligibleBeforeDuplicateSuppression: input.eligible ?? false,
      duplicateSuppressed: input.duplicate ?? false,
      shouldSpeak: input.shouldSpeak ?? false,
    },
  } as unknown as PsychologyShadowChainResult;
}

function directSequence() {
  const entryReady = chain({ lifecycle: "ENTRY_READY", fingerprint: "f0" });
  const active = chain({ lifecycle: "ACTIVE", fingerprint: "f1", eligible: true, shouldSpeak: true, risks: ["DO_NOT_CHASE"] });
  const hold = chain({ lifecycle: "HOLD", fingerprint: "f2", eligible: true, duplicate: true, shouldSpeak: false });
  const trail = chain({ lifecycle: "TRAIL", fingerprint: "f3" });
  const exit = chain({ lifecycle: "EXIT", fingerprint: "f4", eligible: true, shouldSpeak: true });
  const base = {
    candidate: candidateIdentity,
    tradeId: "T1",
    source: "DETERMINISTIC_REPLAY" as const,
    ruleVersion: "PSY_SOURCE_BRIDGE_V1",
  };
  return [
    { ...base, observedAt: "2026-08-28T04:05:00Z", previous: entryReady, current: active },
    { ...base, observedAt: "2026-08-28T04:10:00Z", previous: active, current: hold },
    { ...base, observedAt: "2026-08-28T04:20:00Z", previous: hold, current: trail },
    { ...base, observedAt: "2026-08-28T04:30:00Z", previous: trail, current: exit },
  ];
}

function verifiedStopOutcome() {
  const base = createOutcomeRecord({
    symbol: "NIFTY",
    tradingDate: "2026-08-28",
    verdict: "BUY",
    score: 8,
    maxScore: 10,
    confidence: "HIGH",
    side: "CE",
    strike: 25000,
    entry: 100,
    sl: 80,
    t1: 120,
    t2: 140,
    t3: 200,
    signalContributions: {},
    windowMinutes: 60,
    nowMs: Date.parse("2026-08-28T04:00:00Z"),
    idSuffix: "psy",
    planId: "p1",
    horizon: "60m",
  });
  return mapVerifiedOutcome({
    ...base,
    status: "STOP_HIT",
    evaluatedAt: "2026-08-28T05:00:00Z",
    maeR: 1,
    mfeR: 0.5,
    maePremium: 20,
    mfePremium: 10,
  } as any);
}

function retrospective() {
  const outcome = verifiedStopOutcome();
  const evidenceBase = {
    tradeId: "T1",
    observedAt: "2026-08-28T05:05:00Z",
    source: "DETERMINISTIC_REPLAY" as const,
    ruleVersion: "RETRO_RULE_V1",
  };
  const adjudications: PsychologyRetrospectiveAdjudication[] = [
    { ...evidenceBase, evidenceId: "e1", kind: "CHASE_WARNING_ADJUDICATED", falseWarning: true },
    { ...evidenceBase, evidenceId: "e2", kind: "LATE_EXIT_ADJUDICATED", priorExitOrProtectWarning: false },
    { ...evidenceBase, evidenceId: "e3", kind: "THESIS_FAILURE_ADJUDICATED", priorThesisWarning: true },
    { ...evidenceBase, evidenceId: "e4", kind: "SIDE_FLIP_ADJUDICATED", freshDeterministicSetup: false },
    { ...evidenceBase, evidenceId: "e5", kind: "STOP_RESPECT_ADJUDICATED", stopRespected: false },
    { ...evidenceBase, evidenceId: "e6", kind: "PROFIT_PROTECTION_ADJUDICATED", useful: true },
  ];
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

function baseInput() {
  return {
    candidate: candidate(),
    replay: {
      logicalKey: "T1",
      observedAt: "2026-08-28T04:00:00Z",
      decisionAt: "2026-08-28T04:01:00Z",
      blockEnd: "2026-08-28T04:00:00Z",
      blockClosed: true,
      quality: "TRUE" as const,
      expiry: "2026-08-28",
      dte: 0,
      tradingDate: "2026-08-28",
      sessionEligible: true,
    },
    validationSource: "REAL_REPLAY" as const,
    evaluationCutoffAt: "2026-08-28T05:15:00Z",
    recordedAt: "2026-08-28T05:16:00Z",
    regimes: ["TREND"] as const,
    regimeEvidence: [{
      regime: "TREND" as const,
      source: "DETERMINISTIC_UPSTREAM" as const,
      observedAt: "2026-08-28T04:00:30Z",
      ruleVersion: "REGIME_RULE_V1",
    }],
    direct: directSequence(),
    retrospective: retrospective(),
  };
}

test("unified flow proves all frozen metric counters end-to-end without persistence authority", () => {
  const result = preparePsychologyRealEvidenceFlow({ ...baseInput(), regimes: ["TREND"] });
  assert.equal(result.status, "READY_TO_PERSIST");
  assert.ok(result.collection?.record);
  assert.equal(result.directEventCount, 9);
  assert.equal(result.retrospectiveEventCount, 6);
  assert.equal(result.totalEventCount, 15);
  assert.deepEqual(result.unresolvedSources, []);

  const v = result.collection!.record!.validation;
  assert.equal(v.completedTrade, true);
  assert.equal(v.chaseWarnings, 1);
  assert.equal(v.falseChaseWarnings, 1);
  assert.equal(v.lateExitEvents, 1);
  assert.equal(v.missedLateExitWarnings, 1);
  assert.equal(v.thesisFailures, 1);
  assert.equal(v.missedThesisFailures, 0);
  assert.equal(v.stateFlips, 3);
  assert.equal(v.eligibleMessages, 3);
  assert.equal(v.duplicateMessages, 1);
  assert.equal(v.spokenUpdates, 2);
  assert.equal(v.wrongSideFlips, 1);
  assert.equal(v.entries, 1);
  assert.equal(v.entriesAfterExtension, 1);
  assert.equal(v.stoppedTrades, 1);
  assert.equal(v.stopRespectViolations, 1);
  assert.equal(v.profitProtectionOpportunities, 1);
  assert.equal(v.usefulProfitProtectionEvents, 1);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("direct sequence must be chronologically continuous", () => {
  const request = baseInput();
  request.direct[1] = {
    ...request.direct[1],
    observedAt: request.direct[0].observedAt,
    previous: chain({ lifecycle: "ACTIVE", fingerprint: "wrong" }),
  };
  const result = preparePsychologyRealEvidenceFlow({ ...request, regimes: ["TREND"] });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("DIRECT_SEQUENCE_NOT_STRICTLY_CHRONOLOGICAL:1"));
  assert.ok(result.blockers.includes("DIRECT_SEQUENCE_CONTINUITY_MISMATCH:1"));
});

test("exact direct option contract cannot diverge from candidate history", () => {
  const request = baseInput();
  request.direct[0] = {
    ...request.direct[0],
    candidate: { ...candidateIdentity, strike: 25100 },
  };
  const result = preparePsychologyRealEvidenceFlow({ ...request, regimes: ["TREND"] });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("DIRECT_STRIKE_MISMATCH:0"));
});

test("replay exact expiry/DTE and recording chronology are mandatory", () => {
  const request = baseInput();
  request.replay = { ...request.replay, expiry: null, dte: null };
  request.recordedAt = "2026-08-28T05:14:00Z";
  const result = preparePsychologyRealEvidenceFlow({ ...request, regimes: ["TREND"] });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("REPLAY_EXPIRY_MISSING"));
  assert.ok(result.blockers.includes("REPLAY_DTE_MISSING"));
  assert.ok(result.blockers.includes("RECORDED_AT_BEFORE_EVALUATION_CUTOFF"));
});

test("replay and live evidence sources cannot be mixed in one trade flow", () => {
  const request = baseInput();
  request.retrospective = {
    ...request.retrospective!,
    eventSource: "DETERMINISTIC_LIVE",
  };
  const result = preparePsychologyRealEvidenceFlow({ ...request, regimes: ["TREND"] });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("RETROSPECTIVE_EVENT_SOURCE_MISMATCH"));
});

test("missing retrospective layer stays explicit instead of fabricating zero-quality facts", () => {
  const request = baseInput();
  request.retrospective = null;
  const result = preparePsychologyRealEvidenceFlow({ ...request, regimes: ["TREND"] });
  assert.equal(result.status, "READY_TO_PERSIST");
  assert.ok(result.unresolvedSources.includes("RETROSPECTIVE_OUTCOME_EVIDENCE_NOT_SUPPLIED"));
  const v = result.collection!.record!.validation;
  assert.equal(v.chaseWarnings, 0);
  assert.equal(v.stoppedTrades, 0);
});
