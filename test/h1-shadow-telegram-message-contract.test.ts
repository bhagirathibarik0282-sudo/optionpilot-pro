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

test("renders one-minute candidate status with zero send authority", () => {
  const out = renderH1ShadowTelegramMessage(preview());
  assert.equal(out.ready, true);
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /KITE PUSH CANDIDATE/);
  assert.match(out.text ?? "", /liquidity=CONFIRMED/);
  assert.equal(out.telegramSendAllowed, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.productionImpact, "NONE");
});

test("renders periodic structure-unchanged state instead of suppressing it", () => {
  const out = renderH1ShadowTelegramMessage(preview({ meaningfulChange: false, kind: null, changed: [] }));
  assert.equal(out.ready, true);
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /STRUCTURE UNCHANGED/);
});

test("renders missing or unready evidence explicitly as MISSING", () => {
  const missing = renderH1ShadowTelegramMessage(null);
  assert.equal(missing.renderable, true);
  assert.match(missing.text ?? "", /Data: MISSING/);
  assert.match(missing.text ?? "", /Kite trade push: BLOCKED/);

  const unready = renderH1ShadowTelegramMessage(preview({ ready: false, blockers: ["STALE_SHADOW_EVIDENCE"] }));
  assert.equal(unready.renderable, true);
  assert.match(unready.text ?? "", /Data: MISSING/);
  assert.equal(unready.ready, false);
});

test("authority violation remains non-renderable and fail-closed", () => {
  const unsafe = preview({ affectsTelegram: true as false });
  const out = renderH1ShadowTelegramMessage(unsafe);
  assert.equal(out.renderable, false);
  assert.equal(out.text, null);
  assert.ok(out.blockers.includes("PREVIEW_AUTHORITY_CONTRACT_VIOLATION"));
});

test("invalid timestamp is displayed as missing and blocks trade push", () => {
  const out = renderH1ShadowTelegramMessage(preview({ observedAt: "bad-time" }));
  assert.equal(out.ready, false);
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /Observed: MISSING/);
  assert.match(out.text ?? "", /Kite trade push: BLOCKED/);
});

test("raw opposing reason labels are never rendered as a separate state", () => {
  const p = preview();
  p.decisions[0] = {
    ...p.decisions[0],
    decision: "REJECT",
    reasonCodes: ["MULTI_EXPIRY_CONFLICT_PRESENT"],
    gates: { liquidity: true, multiExpiry: false },
  };
  const out = renderH1ShadowTelegramMessage(p);
  assert.equal(out.renderable, true);
  assert.match(out.text ?? "", /multiExpiry=NOT CONFIRMED/);
  assert.match(out.text ?? "", /→ WAIT/);
  assert.doesNotMatch(out.text ?? "", /CONFLICT/i);
});
