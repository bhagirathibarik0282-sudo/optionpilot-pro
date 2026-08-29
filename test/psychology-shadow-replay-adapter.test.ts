import test from "node:test";
import assert from "node:assert/strict";
import { adaptPsychologyValidationEvidence } from "../psychology-shadow-replay-adapter.ts";
import type { ShadowValidationObservation } from "../psychology-shadow-validation.ts";

const validation: ShadowValidationObservation = {
  tradeId: "T1",
  regime: "TREND",
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

const replay = {
  logicalKey: "T1",
  observedAt: "2026-08-20T09:20:00+05:30",
  decisionAt: "2026-08-20T09:21:00+05:30",
  blockEnd: "2026-08-20T09:20:00+05:30",
  blockClosed: true,
  quality: "TRUE" as const,
  expiry: "2026-08-20",
  dte: 0,
  tradingDate: "2026-08-20",
  sessionEligible: true,
};

test("eligible real replay can enter validation", () => {
  const r = adaptPsychologyValidationEvidence({ source: "REAL_REPLAY", replay, validation });
  assert.equal(r.accepted, true);
  assert.equal(r.observation?.tradeId, "T1");
});

test("synthetic evidence can never enter real validation", () => {
  const r = adaptPsychologyValidationEvidence({ source: "SYNTHETIC", replay, validation });
  assert.equal(r.accepted, false);
  assert.ok(r.blockers.includes("SYNTHETIC_EVIDENCE_NOT_ACCEPTED"));
});

test("lookahead replay is blocked by H1 replay guard", () => {
  const r = adaptPsychologyValidationEvidence({
    source: "REAL_REPLAY",
    replay: { ...replay, observedAt: "2026-08-20T09:22:00+05:30" },
    validation,
  });
  assert.equal(r.accepted, false);
  assert.ok(r.blockers.includes("REPLAY_GUARD_LOOKAHEAD_FUTURE_OBSERVATION"));
});

test("trade identity mismatch fails closed", () => {
  const r = adaptPsychologyValidationEvidence({ source: "REAL_REPLAY", replay, validation: { ...validation, tradeId: "T2" } });
  assert.equal(r.accepted, false);
  assert.ok(r.blockers.includes("TRADE_ID_REPLAY_KEY_MISMATCH"));
});

test("low-quality live observation is blocked", () => {
  const r = adaptPsychologyValidationEvidence({
    source: "LIVE_OBSERVATION",
    replay: { ...replay, quality: "STALE" },
    validation,
  });
  assert.equal(r.accepted, false);
  assert.ok(r.blockers.includes("LIVE_OBSERVATION_QUALITY_STALE"));
});

test("adapter has no live authority", () => {
  const r = adaptPsychologyValidationEvidence({ source: "REAL_REPLAY", replay, validation });
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});
