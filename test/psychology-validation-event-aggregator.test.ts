import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePsychologyValidationEvents, type PsychologyValidationEvent } from "../psychology-validation-event-aggregator.ts";

const base = {
  tradeId: "T1",
  source: "DETERMINISTIC_REPLAY" as const,
  ruleVersion: "PSY_EVENT_RULE_V1",
};

function event<T extends PsychologyValidationEvent>(value: T): T { return value; }

const common = {
  tradeId: "T1",
  evaluationCutoffAt: "2026-08-20T10:00:00+05:30",
  replayDecisionAt: "2026-08-20T09:21:00+05:30",
  regimes: ["TREND"] as const,
  regimeEvidence: [{
    regime: "TREND" as const,
    source: "DETERMINISTIC_UPSTREAM" as const,
    observedAt: "2026-08-20T09:20:30+05:30",
    ruleVersion: "REGIME_RULE_V1",
  }],
};

test("aggregates deterministic replay events into frozen validation counters", () => {
  const events: PsychologyValidationEvent[] = [
    event({ ...base, eventId: "E1", kind: "CHASE_WARNING", observedAt: "2026-08-20T09:22:00+05:30", falseWarning: true }),
    event({ ...base, eventId: "E2", kind: "LATE_EXIT_EVENT", observedAt: "2026-08-20T09:30:00+05:30", priorExitOrProtectWarning: false }),
    event({ ...base, eventId: "E3", kind: "THESIS_FAILURE", observedAt: "2026-08-20T09:35:00+05:30", priorThesisWarning: true }),
    event({ ...base, eventId: "E4", kind: "STATE_FLIP", observedAt: "2026-08-20T09:25:00+05:30", terminal: false }),
    event({ ...base, eventId: "E5", kind: "MESSAGE_ELIGIBLE", observedAt: "2026-08-20T09:26:00+05:30", duplicate: true, spoken: false }),
    event({ ...base, eventId: "E6", kind: "MESSAGE_ELIGIBLE", observedAt: "2026-08-20T09:27:00+05:30", duplicate: false, spoken: true }),
    event({ ...base, eventId: "E7", kind: "SIDE_FLIP", observedAt: "2026-08-20T09:28:00+05:30", freshDeterministicSetup: false }),
    event({ ...base, eventId: "E8", kind: "ENTRY", observedAt: "2026-08-20T09:23:00+05:30", accepted: true, extensionBlocked: true }),
    event({ ...base, eventId: "E9", kind: "STOPPED_TRADE", observedAt: "2026-08-20T09:40:00+05:30", stopRespected: false }),
    event({ ...base, eventId: "E10", kind: "PROFIT_PROTECTION_OPPORTUNITY", observedAt: "2026-08-20T09:32:00+05:30", useful: true }),
    event({ ...base, eventId: "E11", kind: "TRADE_COMPLETED", observedAt: "2026-08-20T09:45:00+05:30" }),
  ];

  const result = aggregatePsychologyValidationEvents({ ...common, regimes: [...common.regimes], events });
  assert.equal(result.status, "READY");
  assert.ok(result.observation);
  assert.equal(result.observation!.completedTrade, true);
  assert.equal(result.observation!.chaseWarnings, 1);
  assert.equal(result.observation!.falseChaseWarnings, 1);
  assert.equal(result.observation!.missedLateExitWarnings, 1);
  assert.equal(result.observation!.missedThesisFailures, 0);
  assert.equal(result.observation!.stateFlips, 1);
  assert.equal(result.observation!.eligibleMessages, 2);
  assert.equal(result.observation!.duplicateMessages, 1);
  assert.equal(result.observation!.spokenUpdates, 1);
  assert.equal(result.observation!.wrongSideFlips, 1);
  assert.equal(result.observation!.entries, 1);
  assert.equal(result.observation!.entriesAfterExtension, 1);
  assert.equal(result.observation!.stoppedTrades, 1);
  assert.equal(result.observation!.stopRespectViolations, 1);
  assert.equal(result.observation!.profitProtectionOpportunities, 1);
  assert.equal(result.observation!.usefulProfitProtectionEvents, 1);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("retrospective validation events may occur after decision but not after evaluation cutoff", () => {
  const result = aggregatePsychologyValidationEvents({
    ...common,
    regimes: [...common.regimes],
    events: [event({ ...base, eventId: "E1", kind: "TRADE_COMPLETED", observedAt: "2026-08-20T10:01:00+05:30" })],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("EVENT_AFTER_EVALUATION_CUTOFF:TRADE_COMPLETED"));
});

test("event stream is trade-isolated", () => {
  const result = aggregatePsychologyValidationEvents({
    ...common,
    regimes: [...common.regimes],
    events: [event({ ...base, eventId: "E1", tradeId: "T2", kind: "TRADE_COMPLETED", observedAt: "2026-08-20T09:45:00+05:30" })],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("EVENT_TRADE_ID_MISMATCH:TRADE_COMPLETED"));
});

test("regime evidence still obeys decision-time no-lookahead", () => {
  const result = aggregatePsychologyValidationEvents({
    ...common,
    regimes: ["TREND"],
    regimeEvidence: [{
      regime: "TREND",
      source: "DETERMINISTIC_UPSTREAM",
      observedAt: "2026-08-20T09:22:00+05:30",
      ruleVersion: "REGIME_RULE_V1",
    }],
    events: [],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("REGIME_EVIDENCE_LOOKAHEAD:TREND"));
});

test("blank event rule version is rejected", () => {
  const result = aggregatePsychologyValidationEvents({
    ...common,
    regimes: [...common.regimes],
    events: [event({ ...base, eventId: "E1", ruleVersion: " ", kind: "TRADE_COMPLETED", observedAt: "2026-08-20T09:45:00+05:30" })],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("EVENT_RULE_VERSION_MISSING:TRADE_COMPLETED"));
});

test("duplicate event ids are rejected so retries cannot inflate counters", () => {
  const result = aggregatePsychologyValidationEvents({
    ...common,
    regimes: [...common.regimes],
    events: [
      event({ ...base, eventId: "E1", kind: "CHASE_WARNING", observedAt: "2026-08-20T09:22:00+05:30", falseWarning: false }),
      event({ ...base, eventId: "E1", kind: "CHASE_WARNING", observedAt: "2026-08-20T09:22:00+05:30", falseWarning: false }),
    ],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("EVENT_ID_DUPLICATE:E1"));
});

test("evaluation cutoff cannot be earlier than replay decision", () => {
  const result = aggregatePsychologyValidationEvents({
    ...common,
    evaluationCutoffAt: "2026-08-20T09:20:00+05:30",
    regimes: [...common.regimes],
    events: [],
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.includes("EVALUATION_CUTOFF_BEFORE_REPLAY_DECISION"));
});
