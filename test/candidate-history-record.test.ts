import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateHistoryRecord } from "../candidate-history-record.js";
import type { HistoricalCandidateQualitySnapshot } from "../h1-candidate-quality.js";

function quality(grade: HistoricalCandidateQualitySnapshot["grade"]): HistoricalCandidateQualitySnapshot {
  return {
    alignment: "FULL",
    direction: "BULLISH",
    grade,
    usableHorizons: 3,
    alignedHorizons: 3,
    overextended: false,
    noChase: false,
    liquidityAcceptable: true,
    evidenceCompletenessPct: 90,
    reasons: [],
    ruleVersion: "H1_CANDIDATE_QUALITY_V1",
    semantics: "HISTORICAL_RESEARCH_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}

test("maps observed candidate without fabricating missing metrics", () => {
  const row = buildCandidateHistoryRecord({
    candidateId: "cand-1",
    symbol: "NIFTY",
    observedAt: "2026-08-28T09:30:00.000Z",
    quality: quality("A"),
    side: "CE",
    strike: 25000,
    ltp: 100,
    iv: Number.NaN,
  });
  assert.equal(row?.status, "OBSERVED");
  assert.equal(row?.iv, null);
  assert.equal(row?.oi, null);
  assert.equal(row?.selectionVersion, "H1_CANDIDATE_QUALITY_V1");
});

test("reject grade maps to explicit rejected history state", () => {
  const row = buildCandidateHistoryRecord({ candidateId: "cand-2", symbol: "SENSEX", observedAt: "2026-08-28T09:30:00Z", quality: quality("REJECT") });
  assert.equal(row?.status, "REJECTED");
  assert.equal(row?.reasonCode, "QUALITY_REJECT");
});

test("unavailable grade remains explicit instead of guessed", () => {
  const row = buildCandidateHistoryRecord({ candidateId: "cand-3", symbol: "BANKNIFTY", observedAt: "2026-08-28T09:30:00Z", quality: quality("UNAVAILABLE") });
  assert.equal(row?.status, "UNAVAILABLE");
  assert.equal(row?.reasonCode, "QUALITY_UNAVAILABLE");
});

test("invalid identity/time is refused", () => {
  assert.equal(buildCandidateHistoryRecord({ candidateId: "", symbol: "NIFTY", observedAt: "2026-08-28T09:30:00Z", quality: quality("A") }), null);
  assert.equal(buildCandidateHistoryRecord({ candidateId: "cand-4", symbol: "NIFTY", observedAt: "not-a-date", quality: quality("A") }), null);
});
