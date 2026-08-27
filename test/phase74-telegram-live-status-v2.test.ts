import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhase74CanonicalStatus,
  buildPhase74HaikuPrompt,
  renderPhase74TelegramStatus,
  resolvePhase74Transport,
  validatePhase74Transport,
} from "../telegram-live-status-v2.js";

test("Phase74 supports exactly three indices and renders recognizable V2 header", () => {
  for (const symbol of ["NIFTY", "BANKNIFTY", "SENSEX"]) {
    const status = buildPhase74CanonicalStatus({
      symbol,
      observedAt: "2026-08-28T03:45:00.000Z",
      metrics: { freshnessStatus: "FRESH" },
      validation: { valid: true },
      rule: { verdict: "OBSERVING", score: 2, maxScore: 10, reasons: ["spot/futures aligned"] },
    });
    const text = renderPhase74TelegramStatus(status, "Canonical output explain only.", "DETERMINISTIC_FALLBACK");
    assert.match(text, /OP LIVE V2/);
    assert.match(text, new RegExp(symbol));
    assert.match(text, /Dashboard unchanged/);
    assert.match(text, /no auto-promotion/);
    assert.match(text, /🟢 FRESH/);
    assert.match(text, /✅ PASS/);
    assert.match(text, /EVIDENCE/);
  }
});

test("Phase74 verdict emoji changes with canonical direction", () => {
  const bullish = buildPhase74CanonicalStatus({ symbol: "NIFTY", metrics: { freshnessStatus: "FRESH" }, validation: { valid: true }, rule: { verdict: "BULLISH" } });
  const bearish = buildPhase74CanonicalStatus({ symbol: "SENSEX", metrics: { freshnessStatus: "FRESH" }, validation: { valid: true }, rule: { verdict: "BEARISH" } });
  assert.match(renderPhase74TelegramStatus(bullish, "x", "DETERMINISTIC_FALLBACK"), /📈🟢 BULLISH/);
  assert.match(renderPhase74TelegramStatus(bearish, "x", "DETERMINISTIC_FALLBACK"), /📉🔴 BEARISH/);
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

test("Phase74 strict routing requires three distinct Telegram groups", () => {
  const transport = resolvePhase74Transport({
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_NIFTY_CHAT_ID: "-1001",
    TELEGRAM_BANKNIFTY_CHAT_ID: "-1002",
    TELEGRAM_SENSEX_CHAT_ID: "-1003",
  });
  assert.deepEqual(validatePhase74Transport(transport), { ok: true });
  assert.equal(transport.chatIds.NIFTY, "-1001");
  assert.equal(transport.chatIds.BANKNIFTY, "-1002");
  assert.equal(transport.chatIds.SENSEX, "-1003");
});

test("Phase74 routing fails closed when group ids are missing or duplicated", () => {
  const missing = resolvePhase74Transport({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_NIFTY_CHAT_ID: "1" });
  assert.deepEqual(validatePhase74Transport(missing), { ok: false, reason: "THREE_GROUP_CHAT_IDS_REQUIRED" });

  const duplicate = resolvePhase74Transport({
    TELEGRAM_BOT_TOKEN: "x",
    TELEGRAM_NIFTY_CHAT_ID: "1",
    TELEGRAM_BANKNIFTY_CHAT_ID: "1",
    TELEGRAM_SENSEX_CHAT_ID: "3",
  });
  assert.deepEqual(validatePhase74Transport(duplicate), { ok: false, reason: "GROUP_CHAT_IDS_MUST_BE_DISTINCT" });
});
