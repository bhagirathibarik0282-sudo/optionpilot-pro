import test from "node:test";
import assert from "node:assert/strict";
import { buildHistoricalMarketStory } from "../h1-market-story-thesis.js";

const metric = (code: string, rs5: number, rs20: number, rs60: number, ret20 = 1) => ({
  tradeDate: "2026-08-21",
  indexCode: code,
  return1d: null,
  return5d: 1,
  return20d: ret20,
  return60d: 2,
  return120d: null,
  return252d: null,
  rsVsNifty50_5d: rs5,
  rsVsNifty50_20d: rs20,
  rsVsNifty50_60d: rs60,
} as any);

test("broad risk-on story stays historical-only", () => {
  const out = buildHistoricalMarketStory({
    observedAt: "2026-08-21T10:00:00.000Z",
    dataQuality: "GOOD",
    liveDirection: "BULLISH",
    metrics: {
      NIFTY500: metric("NIFTY500", 1, 1.5, 1),
      NEXT50: metric("NEXT50", 1, 1.2, 1),
      MIDCAP150: metric("MIDCAP150", 1.5, 2, 1.5),
      SMALLCAP250: metric("SMALLCAP250", 2, 2.5, 2),
      NIFTY100: metric("NIFTY100", 0.2, 0.3, 0.2),
    },
  });
  assert.equal(out.historicalBias, "BULLISH");
  assert.equal(out.conflictWithLive, false);
  assert.equal(out.affectsVerdict, false);
});

test("historical/live conflict lowers confidence but never flips live", () => {
  const out = buildHistoricalMarketStory({
    observedAt: "2026-08-21T10:00:00.000Z",
    dataQuality: "GOOD",
    liveDirection: "BULLISH",
    metrics: {
      NIFTY500: metric("NIFTY500", -1, -1.5, -1, -2),
      NEXT50: metric("NEXT50", -1, -1.2, -1, -2),
      MIDCAP150: metric("MIDCAP150", -1.5, -2, -1.5, -3),
      SMALLCAP250: metric("SMALLCAP250", -2, -2.5, -2, -4),
      NIFTY100: metric("NIFTY100", -0.2, -0.3, -0.2, -1),
    },
  });
  assert.equal(out.historicalBias, "BEARISH");
  assert.equal(out.conflictWithLive, true);
  assert.equal(out.confidence, "LOW");
  assert.equal(out.affectsExecution, false);
});

test("uncalibrated regime strength remains an explicit unknown", () => {
  const out = buildHistoricalMarketStory({
    observedAt: "2026-08-21T10:00:00.000Z",
    dataQuality: "GOOD",
    metrics: {
      NIFTY500: metric("NIFTY500", 1, 1, 1),
      MIDCAP150: metric("MIDCAP150", 1, 1, 1),
      SMALLCAP250: metric("SMALLCAP250", 1, 1, 1),
    },
  });
  assert.ok(out.unknowns.includes("REGIME_STRENGTH_UNCALIBRATED"));
});
