import test from "node:test";
import assert from "node:assert/strict";
import { buildHistoryContext, summarizeHistoricalAnalogs } from "../h1-history-router.js";

const metrics = (r5: number | null, r20: number | null, r60: number | null, r252: number | null) => ({
  tradeDate: "2026-08-28",
  indexCode: "NIFTY50",
  return1d: null,
  return5d: r5,
  return20d: r20,
  return60d: r60,
  return120d: null,
  return252d: r252,
  rsVsNifty50_5d: null,
  rsVsNifty50_20d: null,
  rsVsNifty50_60d: null,
} as any);

test("historical conflict reduces confidence but never flips live authority", () => {
  const result = buildHistoryContext({ latestMetrics: metrics(-2, -3, -4, -5), liveBias: "BULLISH" });
  assert.equal(result.liveBias, "BULLISH");
  assert.equal(result.historicalConflict, true);
  assert.equal(result.confidenceAdjustment, "REDUCE");
  assert.equal(result.affectsVerdict, false);
});

test("20D is a computed lens inside the same history router", () => {
  const result = buildHistoryContext({ latestMetrics: metrics(1, 2, 3, null), liveBias: "BULLISH" });
  assert.equal(result.story5d, "BULLISH");
  assert.equal(result.lens20d, "BULLISH");
  assert.equal(result.context60d, "BULLISH");
  assert.equal(result.context1y, "UNAVAILABLE");
});

test("analog summary reports counts and forbids probability claims", () => {
  const cases = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    similarity: 0.8,
    outcome: i < 11 ? "CONTINUATION" : i < 17 ? "BALANCE" : "FAILURE",
    regimeMatched: true,
    qualityEligible: true,
  } as const));
  const result = summarizeHistoricalAnalogs(cases);
  assert.equal(result.highSimilarityCases, 20);
  assert.equal(result.continuation, 11);
  assert.equal(result.balance, 6);
  assert.equal(result.failure, 3);
  assert.equal(result.evidenceQuality, "MEDIUM");
  assert.equal(result.probabilityClaimAllowed, false);
  assert.equal(result.affectsVerdict, false);
});

test("bad-quality or regime-mismatched analogs are excluded", () => {
  const result = summarizeHistoricalAnalogs([
    { id: "a", similarity: 0.9, outcome: "CONTINUATION", regimeMatched: false, qualityEligible: true },
    { id: "b", similarity: 0.9, outcome: "FAILURE", regimeMatched: true, qualityEligible: false },
  ]);
  assert.equal(result.usableCases, 0);
  assert.equal(result.evidenceQuality, "INSUFFICIENT");
});
