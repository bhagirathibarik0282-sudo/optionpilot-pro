import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeStoredPsychologyRealEvidence,
  preparePsychologyRealEvidenceForStorage,
  psychologyEvidenceKey,
} from "../psychology-real-evidence-store.ts";
import type { PsychologyReplayValidationInput } from "../psychology-shadow-replay-adapter.ts";

function input(tradeId = "T1", source: PsychologyReplayValidationInput["source"] = "REAL_REPLAY"): PsychologyReplayValidationInput {
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
    validation: {
      tradeId,
      regimes: ["TREND"],
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

test("admitted real replay becomes persistable research evidence", () => {
  const r = preparePsychologyRealEvidenceForStorage(input(), "2026-08-20T10:00:00+05:30");
  assert.ok(r);
  assert.equal(r?.evidenceKey, "REAL_REPLAY:T1");
  assert.equal(r?.source, "REAL_REPLAY");
  assert.equal(r?.affectsTelegram, false);
  assert.equal(r?.affectsVerdict, false);
  assert.equal(r?.affectsExecution, false);
});

test("synthetic and lookahead evidence never become persistable", () => {
  assert.equal(preparePsychologyRealEvidenceForStorage(input("T1", "SYNTHETIC"), "2026-08-20T10:00:00+05:30"), null);
  const future = input("T2");
  future.replay = { ...future.replay, observedAt: "2026-08-20T09:22:00+05:30" };
  assert.equal(preparePsychologyRealEvidenceForStorage(future, "2026-08-20T10:00:00+05:30"), null);
});

test("invalid recorded timestamp fails closed", () => {
  assert.equal(preparePsychologyRealEvidenceForStorage(input(), "not-a-time"), null);
});

test("evidence key isolates provenance and trade identity", () => {
  const replay = preparePsychologyRealEvidenceForStorage(input("T1", "REAL_REPLAY"), "2026-08-20T10:00:00+05:30");
  const live = preparePsychologyRealEvidenceForStorage(input("T1", "LIVE_OBSERVATION"), "2026-08-20T10:01:00+05:30");
  assert.ok(replay && live);
  assert.notEqual(psychologyEvidenceKey(replay!), psychologyEvidenceKey(live!));
});

test("append-only duplicates collapse to latest valid snapshot per source and trade", () => {
  const older = preparePsychologyRealEvidenceForStorage(input("T1"), "2026-08-20T10:00:00+05:30")!;
  const newerInput = input("T1");
  newerInput.validation = { ...newerInput.validation, spokenUpdates: 4 };
  const newer = preparePsychologyRealEvidenceForStorage(newerInput, "2026-08-20T10:05:00+05:30")!;
  const merged = mergeStoredPsychologyRealEvidence([older, newer]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].validation.spokenUpdates, 4);
});

test("malformed stored rows are ignored during restore merge", () => {
  const good = preparePsychologyRealEvidenceForStorage(input("T1"), "2026-08-20T10:00:00+05:30")!;
  const malformed = { ...good, evidenceKey: "WRONG" } as typeof good;
  const merged = mergeStoredPsychologyRealEvidence([malformed, good]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].evidenceKey, "REAL_REPLAY:T1");
});

test("restore re-runs admission so corrupted replay truth cannot re-enter", () => {
  const good = preparePsychologyRealEvidenceForStorage(input("T1"), "2026-08-20T10:00:00+05:30")!;
  const corrupted = { ...good, replay: { ...good.replay, quality: "STALE" as const } };
  const merged = mergeStoredPsychologyRealEvidence([corrupted as typeof good]);
  assert.equal(merged.length, 0);
});

test("restore rejects plausible-key rows with invalid validation counters or regimes", () => {
  const good = preparePsychologyRealEvidenceForStorage(input("T1"), "2026-08-20T10:00:00+05:30")!;
  const invalidCounter = {
    ...good,
    validation: { ...good.validation, spokenUpdates: 5, eligibleMessages: 4 },
  } as typeof good;
  const invalidRegime = {
    ...good,
    validation: { ...good.validation, regimes: ["UNKNOWN" as never] },
  } as typeof good;
  assert.equal(mergeStoredPsychologyRealEvidence([invalidCounter]).length, 0);
  assert.equal(mergeStoredPsychologyRealEvidence([invalidRegime]).length, 0);
});
