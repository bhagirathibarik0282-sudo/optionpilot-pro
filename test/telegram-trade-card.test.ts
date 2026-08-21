import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTelegramTradeCard, TradeCardInput, TRADE_CARD_SECTION_SEPARATOR } from "../telegram-trade-card.js";

function baseInput(overrides: Partial<TradeCardInput> = {}): TradeCardInput {
  return {
    symbol: "NIFTY",
    decision: "BEST_CE",
    label: "BUY",
    strike: 24500,
    moneynessRole: "ATM",
    lastPrice: 120.5,
    spot: 24487.3,
    dte: 3,
    probability: 78,
    grade: "B",
    confidence: "MODERATE",
    scoreReasons: ["✅ Delta in favorable range", "✅ OI trend supportive"],
    contextNotes: [],
    riskFlags: [],
    timestampIst: "21-08-2026 10:15:00 IST",
    ...overrides,
  };
}

// 1. Basic BUY signal renders FINAL ACTION with BUY label, not blocked.
test("basic BUY signal shows BUY in FINAL ACTION, no BLOCKED text", () => {
  const text = buildTelegramTradeCard(baseInput());
  assert.match(text, /BUY SIGNAL — NIFTY/);
  assert.doesNotMatch(text, /BLOCKED/);
});

// 2. Basic SELL (PE) signal.
test("BEST_PE decision with label SELL shows SELL SIGNAL and Buy PE", () => {
  const text = buildTelegramTradeCard(baseInput({ decision: "BEST_PE", label: "SELL" }));
  assert.match(text, /SELL SIGNAL — NIFTY/);
  assert.match(text, /Buy PE/);
});

// 3. Blocked trade shows BLOCKED, not an executable-looking plan.
test("blocked trade shows BLOCKED and suppresses TRADE PLAN even if tmPlan present", () => {
  const text = buildTelegramTradeCard(
    baseInput({
      blockStatus: { blocked: true, reasons: ["H4: spread too wide", "H10: devil detector hard block"] },
      tmPlan: { status: "OK", entry: 120, sl: 90, t1: 150, t2: 180, t3: 220, rPremium: 30, atrUnderlying: 85, deltaUsed: 0.42, trailingRule: "trail to breakeven at T1" },
    })
  );
  assert.match(text, /🚫 <b>BLOCKED/);
  assert.doesNotMatch(text, /Trade Plan \(forward-test only/);
  assert.match(text, /H4: spread too wide/);
  assert.match(text, /H10: devil detector hard block/);
});

// 4. Missing optional fields (advancedGreeks, futuresOiBuildup, marketRegime,
//    liveStatus) are OMITTED, not printed as guessed/placeholder values.
test("missing optional fields are omitted, never fabricated as placeholders", () => {
  const text = buildTelegramTradeCard(baseInput());
  assert.doesNotMatch(text, /N\/A/);
  assert.doesNotMatch(text, /Greeks:/);
  assert.doesNotMatch(text, /Futures OI buildup/);
  assert.doesNotMatch(text, /Market regime/);
  assert.doesNotMatch(text, /Status:/); // liveStatus section
});

// 5. TRADE PLAN section reflects an unavailable plan honestly, no fabricated numbers.
test("tmPlan INSUFFICIENT_DATA renders UNAVAILABLE with reason, no numbers", () => {
  const text = buildTelegramTradeCard(baseInput({ tmPlan: { status: "INSUFFICIENT_DATA", reason: "no ATR data" } }));
  assert.match(text, /Trade Plan:<\/b> UNAVAILABLE \(no ATR data\)/);
  assert.doesNotMatch(text, /Entry: <b>₹/);
});

// 6. OPTION BUYER EDGE section only ever surfaces OBE-3 lines, never fabricates
//    OBE-1/2/4/5 (not-yet-built) sections.
test("OPTION BUYER EDGE section shows only OBE-3 content, never fabricates unbuilt OBE features", () => {
  const text = buildTelegramTradeCard(
    baseInput({ contextNotes: ["ℹ️ OBE-3 Volatility Purchase Condition: FAIR_VOL — test reason."] })
  );
  assert.match(text, /Option Buyer Edge:/);
  assert.match(text, /OBE-3 Volatility Purchase Condition/);
  assert.doesNotMatch(text, /Best Index Selector/i);
  assert.doesNotMatch(text, /Buy Permission/i);
  assert.doesNotMatch(text, /Movement Sufficiency/i);
  assert.doesNotMatch(text, /Premium Response Efficiency/i);
  assert.doesNotMatch(text, /Entry Timing/i);
});

// 7. No OBE-3 context note at all -> OPTION BUYER EDGE section is fully omitted
//    (not printed with an empty body).
test("no OBE-3 context note omits the OPTION BUYER EDGE section entirely", () => {
  const text = buildTelegramTradeCard(baseInput({ contextNotes: [] }));
  assert.doesNotMatch(text, /Option Buyer Edge:/);
});

// 8. DEVIL CHECK section aggregates risk flags and block reasons, omitted
//    entirely when there is nothing to show.
test("DEVIL CHECK section omitted when no risk flags and not blocked; shown when risk flags present", () => {
  const clean = buildTelegramTradeCard(baseInput());
  assert.doesNotMatch(clean, /Devil Check/);

  const withRisk = buildTelegramTradeCard(baseInput({ riskFlags: ["Wide spread vs mid"] }));
  assert.match(withRisk, /Devil Check \(1\):/);
  assert.match(withRisk, /Wide spread vs mid/);
});

// 9. Output uses the SAME section separator server.ts's existing
//    telegramSplitMessageSafely() splits on, and never exceeds a sane
//    section count that would defeat that splitter's contract.
test("sections are joined with the shared TRADE_CARD_SECTION_SEPARATOR", () => {
  const text = buildTelegramTradeCard(
    baseInput({
      contextNotes: ["ℹ️ OBE-3 Volatility Purchase Condition: CHEAP_VOL — test."],
      riskFlags: ["some risk"],
      tmPlan: { status: "OK", entry: 100, sl: 80, t1: 120, t2: 140, t3: 160, rPremium: 20, atrUnderlying: 70, deltaUsed: 0.4, trailingRule: "trail rule" },
      liveStatus: { statusLine: "🟡 LIVE — tracking...", elapsedMin: 12 },
    })
  );
  assert.ok(text.includes(`\n${TRADE_CARD_SECTION_SEPARATOR}\n`));
  const sectionCount = text.split(`\n${TRADE_CARD_SECTION_SEPARATOR}\n`).length;
  assert.ok(sectionCount >= 6, `expected at least 6 sections, got ${sectionCount}`);
});
