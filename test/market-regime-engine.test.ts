import test from "node:test";
import assert from "node:assert/strict";
import { classifyMarketRegime } from "../market-regime-engine.js";

const base = {
  trendDirection: "UP" as const,
  rangeState: "NORMAL" as const,
  volatilityState: "NORMAL" as const,
  transitionDetected: false,
  evidenceCount: 4,
  minEvidenceCount: 3,
};

test("fails closed when validated evidence is insufficient", () => {
  const result = classifyMarketRegime({ ...base, evidenceCount: 2 });
  assert.equal(result.regime, "UNKNOWN");
  assert.equal(result.ready, false);
});

test("explicit transition evidence has priority", () => {
  const result = classifyMarketRegime({ ...base, transitionDetected: true });
  assert.equal(result.regime, "TRANSITION");
});

test("high volatility requires range expansion", () => {
  const result = classifyMarketRegime({ ...base, volatilityState: "HIGH", rangeState: "EXPANDING" });
  assert.equal(result.regime, "HIGH_VOLATILITY");
});

test("validated direction maps to trending regime", () => {
  assert.equal(classifyMarketRegime(base).regime, "TRENDING_UP");
  assert.equal(classifyMarketRegime({ ...base, trendDirection: "DOWN" }).regime, "TRENDING_DOWN");
});

test("flat non-expanding structure maps to range", () => {
  const result = classifyMarketRegime({ ...base, trendDirection: "FLAT", rangeState: "COMPRESSED" });
  assert.equal(result.regime, "RANGE");
});

test("conflicting or unavailable evidence never guesses a regime", () => {
  const result = classifyMarketRegime({ ...base, trendDirection: "UNAVAILABLE", rangeState: "UNAVAILABLE" });
  assert.equal(result.regime, "UNKNOWN");
  assert.equal(result.ready, false);
});

test("foundation has no live authority", () => {
  const result = classifyMarketRegime(base);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
});
