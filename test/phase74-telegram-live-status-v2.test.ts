import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhase74CanonicalStatus,
  buildPhase74HaikuPrompt,
  renderPhase74TelegramStatus,
} from "../telegram-live-status-v2.js";

test("Phase74 supports exactly three indices and renders recognizable V2 header", () => {
  for (const symbol of ["NIFTY", "BANKNIFTY", "SENSEX"]) {
    const status = buildPhase74CanonicalStatus({
      symbol,
      observedAt: "2026-08-28T03:45:00.000Z",
      metrics: { freshnessStatus: "FRESH" },
      validation: { valid: true },
      rule: { verdict: "OBSERVING", score: 2, maxScore: 10 },
    });
    const text = renderPhase74TelegramStatus(status, "Canonical output explain only.", "DETERMINISTIC_FALLBACK");
    assert.match(text, /OP LIVE V2/);
    assert.match(text, new RegExp(symbol));
    assert.match(text, /Dashboard unchanged/);
    assert.match(text, /no auto-promotion/);
  }
});

test("Phase74 rejects unsupported symbols", () => {
  assert.throws(() => buildPhase74CanonicalStatus({ symbol: "MIDCAP", metrics: {}, validation: {}, rule: {} }), /Unsupported/);
});

test("Phase74 fail-closes unknown data instead of fabricating PASS", () => {
  const status = buildPhase74CanonicalStatus({ symbol: "NIFTY", metrics: {}, validation: {}, rule: {} });
  assert.equal(status.validatorState, "UNKNOWN");
  assert.equal(status.freshness, "UNKNOWN");
  assert.equal(status.verdict, "DATA UNAVAILABLE");
  assert.equal(status.score, null);
});

test("Phase74 Haiku prompt is explanation-only and prohibits decision mutation", () => {
  const status = buildPhase74CanonicalStatus({
    symbol: "BANKNIFTY",
    metrics: { freshnessStatus: "FRESH" },
    validation: { valid: false, blockers: ["FUTURES_VWAP_UNAVAILABLE"] },
    rule: { verdict: "DATA UNAVAILABLE", score: null, maxScore: 12 },
  });
  const prompt = buildPhase74HaikuPrompt(status);
  assert.match(prompt, /Explanation-only auditor/);
  assert.match(prompt, /Never change or reinterpret verdict, score, candidate, entry, stop-loss, target/);
  assert.match(prompt, /Never invent missing values/);
  assert.match(prompt, /FUTURES_VWAP_UNAVAILABLE/);
});

test("Phase74 AI signature ignores numeric score churn but display signature tracks it", () => {
  const common = {
    symbol: "SENSEX",
    metrics: { freshnessStatus: "FRESH" },
    validation: { valid: true },
  };
  const a = buildPhase74CanonicalStatus({ ...common, rule: { verdict: "OBSERVING", score: 1, maxScore: 10 } });
  const b = buildPhase74CanonicalStatus({ ...common, rule: { verdict: "OBSERVING", score: 2, maxScore: 10 } });
  assert.equal(a.aiSignature, b.aiSignature);
  assert.notEqual(a.displaySignature, b.displaySignature);
});
