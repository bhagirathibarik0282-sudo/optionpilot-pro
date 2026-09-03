import assert from "node:assert/strict";
import test from "node:test";
import { renderH1ShadowTelegramMessage } from "../h1-shadow-telegram-message-contract.js";
import type { H1ShadowMeaningfulChangePreview } from "../h1-shadow-meaningful-change-preview.js";

function preview(overrides: Partial<H1ShadowMeaningfulChangePreview> = {}): H1ShadowMeaningfulChangePreview {
  return {
    version: "H1_SHADOW_MEANINGFUL_CHANGE_PREVIEW_V1",
    ready: true,
    meaningfulChange: true,
    kind: "MATERIAL_CHANGE",
    observedAt: "2026-09-03T15:30:20.000Z",
    decisions: [{
      key: "NIFTY|2026-09-08|24000|CE",
      decision: "SELECT",
      reasonCodes: ["ALL_GATES_PASS"],
      gates: { liquidity: true, premium: true },
      selectorVersion: "H1_TEST_V1",
    }],
    added: [],
    removed: [],
    changed: ["NIFTY|2026-09-08|24000|CE"],
    blockers: [],
    productionImpact: "NONE",
    telegramSendAllowed: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    failClosed: true,
    semantics: "READINESS_GATED_SELECTOR_CHANGE_PREVIEW_ONLY",
    ...overrides,
  };
}

test("renders meaningful preview to text with zero send authority", () => {
  const out = renderH1ShadowTelegramMessage(preview());
  assert.equal(out.ready, true);
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /NIFTY\|2026-09-08\|24000\|CE → SELECT/);
  assert.equal(out.telegramSendAllowed, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.productionImpact, "NONE");
});

test("suppresses non-meaningful periodic state", () => {
  const out = renderH1ShadowTelegramMessage(preview({ meaningfulChange: false, kind: null, changed: [] }));
  assert.equal(out.renderable, false);
  assert.equal(out.text, null);
  assert.ok(out.blockers.includes("NO_MEANINGFUL_CHANGE"));
});

test("fails closed on missing or unready preview", () => {
  assert.ok(renderH1ShadowTelegramMessage(null).blockers.includes("MISSING_MEANINGFUL_CHANGE_PREVIEW"));
  const out = renderH1ShadowTelegramMessage(preview({ ready: false, blockers: ["STALE_SHADOW_EVIDENCE"] }));
  assert.equal(out.renderable, false);
  assert.ok(out.blockers.includes("PREVIEW_NOT_READY"));
});

test("fails closed on authority violation", () => {
  const unsafe = preview({ affectsTelegram: true as false });
  const out = renderH1ShadowTelegramMessage(unsafe);
  assert.equal(out.renderable, false);
  assert.ok(out.blockers.includes("PREVIEW_AUTHORITY_CONTRACT_VIOLATION"));
});

test("fails closed on invalid timestamp", () => {
  const out = renderH1ShadowTelegramMessage(preview({ observedAt: "bad-time" }));
  assert.equal(out.renderable, false);
  assert.ok(out.blockers.includes("INVALID_PREVIEW_TIMESTAMP"));
});
