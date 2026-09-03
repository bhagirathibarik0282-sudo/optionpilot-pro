import assert from "node:assert/strict";
import test from "node:test";
import {
  renderH1ShadowTelegramMessage,
  type H1LowNoiseMinuteCommentary,
} from "../h1-shadow-telegram-message-contract.js";
import type { H1ShadowMeaningfulChangePreview } from "../h1-shadow-meaningful-change-preview.js";

function preview(overrides: Partial<H1ShadowMeaningfulChangePreview> = {}): H1ShadowMeaningfulChangePreview {
  return {
    version: "H1_SHADOW_MEANINGFUL_CHANGE_PREVIEW_V1", ready: true,
    meaningfulChange: true, kind: "MATERIAL_CHANGE",
    observedAt: "2026-09-03T15:30:20.000Z",
    decisions: [{
      key: "NIFTY|2026-09-08|24000|CE", decision: "SELECT",
      reasonCodes: ["ALL_GATES_PASS"], gates: { liquidity: true, premium: true },
      selectorVersion: "H1_TEST_V1",
    }],
    added: [], removed: [], changed: ["NIFTY|2026-09-08|24000|CE"], blockers: [],
    productionImpact: "NONE", telegramSendAllowed: false, affectsTelegram: false,
    affectsVerdict: false, affectsExecution: false, grantsPromotionAuthority: false,
    failClosed: true, semantics: "READINESS_GATED_SELECTOR_CHANGE_PREVIEW_ONLY",
    ...overrides,
  };
}

function commentary(overrides: Partial<H1LowNoiseMinuteCommentary> = {}): H1LowNoiseMinuteCommentary {
  return {
    observedAt: "2026-09-03T15:30:20.000Z",
    selectedCandle: "6m",
    marketMode: "TRANSITION",
    timeframeViews: [
      { timeframe: "1m", side: "CE", state: "BUILDING" },
      { timeframe: "3m", side: "CE", state: "CONFIRMED" },
      { timeframe: "6m", side: "CE", state: "CONFIRMED" },
      { timeframe: "15m", side: "CE", state: "BUILDING" },
      { timeframe: "30m", side: "NONE", state: "UNCHANGED" },
    ],
    sameSide: { side: "CE", activeCount: 5, observedCount: 7, premiumChangePct: 5.4 },
    oppositeSide: { side: "PE", activeCount: 2, observedCount: 7, premiumChangePct: -6.8 },
    ...overrides,
  };
}

test("renders required heading, candle selection and continuous two-side commentary", () => {
  const out = renderH1ShadowTelegramMessage(preview(), commentary());
  assert.equal(out.ready, true);
  assert.match(out.text ?? "", /^MEANINGFUL MARKET MESSAGE/m);
  assert.match(out.text ?? "", /Selected candle: 6m/);
  assert.match(out.text ?? "", /Same side CE: 5\/7 active \| premium \+5.40%/);
  assert.match(out.text ?? "", /Opposite side PE: 2\/7 active \| premium -6.80%/);
  assert.match(out.text ?? "", /KITE PUSH CANDIDATE/);
});

test("renders all five timeframe views so higher-timeframe differences remain visible", () => {
  const out = renderH1ShadowTelegramMessage(preview(), commentary());
  for (const tf of ["1m", "3m", "6m", "15m", "30m"]) assert.match(out.text ?? "", new RegExp(tf));
  assert.match(out.text ?? "", /30m NONE UNCHANGED/);
});

test("renders periodic structure-unchanged state instead of suppressing it", () => {
  const out = renderH1ShadowTelegramMessage(
    preview({ meaningfulChange: false, kind: null, changed: [] }),
    commentary(),
  );
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /STRUCTURE UNCHANGED/);
});

test("missing commentary is explicit and blocks Kite push", () => {
  const out = renderH1ShadowTelegramMessage(preview(), null);
  assert.equal(out.ready, false);
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /Live commentary: MISSING/);
  assert.match(out.text ?? "", /Same side: MISSING/);
  assert.match(out.text ?? "", /Opposite side: MISSING/);
  assert.match(out.text ?? "", /Kite trade push: BLOCKED/);
});

test("invalid or same-side pair is treated as missing", () => {
  const invalid = commentary({
    oppositeSide: { side: "CE", activeCount: 1, observedCount: 7, premiumChangePct: -1 },
  });
  const out = renderH1ShadowTelegramMessage(preview(), invalid);
  assert.equal(out.ready, false);
  assert.match(out.text ?? "", /Live commentary: MISSING/);
});

test("raw opposing reason labels are never rendered", () => {
  const p = preview();
  p.decisions[0] = {
    ...p.decisions[0], decision: "REJECT",
    reasonCodes: ["MULTI_EXPIRY_CONFLICT_PRESENT"],
    gates: { liquidity: true, multiExpiry: false },
  };
  const out = renderH1ShadowTelegramMessage(p, commentary());
  assert.match(out.text ?? "", /multiExpiry=NOT CONFIRMED/);
  assert.match(out.text ?? "", /→ WAIT/);
  assert.doesNotMatch(out.text ?? "", /CONFLICT/i);
});

test("authority violation remains non-renderable and fail-closed", () => {
  const out = renderH1ShadowTelegramMessage(preview({ affectsTelegram: true as false }), commentary());
  assert.equal(out.renderable, false);
  assert.equal(out.text, null);
  assert.ok(out.blockers.includes("PREVIEW_AUTHORITY_CONTRACT_VIOLATION"));
});
