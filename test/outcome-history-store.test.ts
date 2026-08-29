import test from "node:test";
import assert from "node:assert/strict";
import { mergeOutcomeHistory, outcomePersistenceFingerprint } from "../outcome-history-store.js";
import type { OutcomeRecord } from "../outcome-engine.js";

function record(id: string, recordedAtMs: number, status: OutcomeRecord["status"]): OutcomeRecord {
  return {
    outcomeId: id,
    recordedAt: new Date(recordedAtMs).toISOString(),
    recordedAtMs,
    tradingDate: "2026-08-28",
    symbol: "NIFTY",
    verdict: "BUY CE",
    score: 1,
    maxScore: 2,
    confidence: "TEST",
    side: "CE",
    strike: 25000,
    entry: 100,
    sl: 80,
    t1: 120,
    t2: 140,
    t3: 200,
    signalContributions: null,
    windowMinutes: 60,
    windowEndsAtMs: recordedAtMs + 3_600_000,
    status,
    evaluatedAt: status === "PENDING" ? null : new Date(recordedAtMs + 60_000).toISOString(),
    outcomeDetail: null,
    tmVersion: "TM_V1",
    planId: null,
    horizon: null,
    observationResolution: "3MIN_LTP_SAMPLED",
    rawRiskDistance: null,
    clampedRiskDistance: null,
    clampApplied: null,
    deltaSource: null,
    marketRegime: null,
    expiryType: null,
    signalType: null,
    maePremium: null,
    mfePremium: null,
    maeR: null,
    mfeR: null,
  };
}

test("restore merge keeps latest persisted version for each outcome id", () => {
  const pending = record("oc-1", 1000, "PENDING");
  const terminal = { ...pending, status: "TARGET_T1_HIT" as const, evaluatedAt: new Date(2000).toISOString() };
  assert.deepEqual(mergeOutcomeHistory([pending, terminal]), [terminal]);
});

test("restore merge returns deterministic recorded-time order", () => {
  const a = record("a", 3000, "PENDING");
  const b = record("b", 1000, "PENDING");
  const c = record("c", 2000, "PENDING");
  assert.deepEqual(mergeOutcomeHistory([a, b, c]).map((x) => x.outcomeId), ["b", "c", "a"]);
});

test("restore merge enforces cap after dedupe", () => {
  const rows = [record("a", 1000, "PENDING"), record("b", 2000, "PENDING"), record("c", 3000, "PENDING")];
  assert.deepEqual(mergeOutcomeHistory(rows, 2).map((x) => x.outcomeId), ["b", "c"]);
});

test("persistence fingerprint changes when evaluation state changes", () => {
  const pending = record("oc-2", 1000, "PENDING");
  const terminal = { ...pending, status: "STOP_HIT" as const, evaluatedAt: new Date(2000).toISOString(), maeR: 1 };
  assert.notEqual(outcomePersistenceFingerprint(pending), outcomePersistenceFingerprint(terminal));
});
