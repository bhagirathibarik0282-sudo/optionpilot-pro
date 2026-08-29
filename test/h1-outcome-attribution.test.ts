import test from "node:test";
import assert from "node:assert/strict";
import { createOutcomeRecord } from "../outcome-engine.js";
import { mapVerifiedOutcome } from "../h1-outcome-attribution.js";

function base(status: any) {
  const r = createOutcomeRecord({
    symbol: "NIFTY", tradingDate: "2026-08-28", verdict: "BUY", score: 8, maxScore: 10, confidence: "HIGH",
    side: "CE", strike: 25000, entry: 100, sl: 80, t1: 120, t2: 140, t3: 200,
    signalContributions: {}, windowMinutes: 60, nowMs: Date.parse("2026-08-28T04:00:00Z"), idSuffix: "x", planId: "p1", horizon: "60m",
  });
  return { ...r, status, evaluatedAt: "2026-08-28T05:00:00Z", maeR: 0.4, mfeR: 1.2, maePremium: 8, mfePremium: 24 } as any;
}

test("target outcome maps to calibration-eligible WIN without recomputation", () => {
  const out = mapVerifiedOutcome(base("TARGET_T1_HIT"));
  assert.equal(out.outcomeClass, "WIN");
  assert.equal(out.calibrationEligible, true);
  assert.equal(out.status, "TARGET_T1_HIT");
  assert.equal(out.affectsVerdict, false);
});

test("incomplete strike-shift remains incomplete and excluded from calibration", () => {
  const out = mapVerifiedOutcome({ ...base("INCOMPLETE_STRIKE_SHIFTED"), outcomeDetail: "fixed strike unavailable" });
  assert.equal(out.outcomeClass, "INCOMPLETE");
  assert.equal(out.calibrationEligible, false);
  assert.match(out.incompleteReason ?? "", /fixed strike unavailable/);
});
