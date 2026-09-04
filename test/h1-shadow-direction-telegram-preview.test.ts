import test from "node:test";
import assert from "node:assert/strict";
import { renderH1ShadowDirectionTelegramPreview } from "../h1-shadow-direction-telegram-preview.js";
import type { H1ShadowDirectionAssessmentResult } from "../h1-shadow-direction-assessment.js";

function assessment(): H1ShadowDirectionAssessmentResult {
  return {
    version: "H1_SHADOW_DIRECTION_ASSESSMENT_V1",
    readySymbolCount: 1,
    rows: [
      { symbol: "NIFTY", state: "OBSERVE_DOWN", direction: "DOWN", blockers: [] },
      { symbol: "SENSEX", state: "BLOCKED", direction: null, blockers: ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"] },
      { symbol: "BANKNIFTY", state: "BLOCKED", direction: null, blockers: ["NEAREST_PEER_NOT_READY"] },
    ],
    semantics: "SHADOW_DIRECTION_OBSERVATION_ONLY_NO_TRADE_VERDICT",
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}

test("renders verified direction without option-side or trade inference", () => {
  const result = renderH1ShadowDirectionTelegramPreview(assessment(), "2026-09-04T09:45:00.000Z");
  assert.equal(result.ready, true);
  assert.equal(result.renderable, true);
  assert.match(result.text ?? "", /NIFTY: OBSERVE_DOWN \| verified direction DOWN/);
  assert.match(result.text ?? "", /CE\/PE inference: OFF/);
  assert.match(result.text ?? "", /BUY\/SELL inference: OFF/);
  assert.match(result.text ?? "", /Telegram send: OFF/);
  assert.equal(result.telegramSendAllowed, false);
  assert.equal(result.affectsTelegram, false);
});

test("keeps blocked symbols blocked", () => {
  const result = renderH1ShadowDirectionTelegramPreview(assessment(), "2026-09-04T09:45:00.000Z");
  assert.match(result.text ?? "", /SENSEX: BLOCKED \| SPOT_MOVE_BELOW_DIRECTION_THRESHOLD/);
  assert.match(result.text ?? "", /BANKNIFTY: BLOCKED \| NEAREST_PEER_NOT_READY/);
});

test("fails closed on upstream safety contract drift", () => {
  const input = assessment();
  input.forwardsDownstream = true as false;
  const result = renderH1ShadowDirectionTelegramPreview(input, "2026-09-04T09:45:00.000Z");
  assert.equal(result.ready, false);
  assert.equal(result.renderable, false);
  assert.equal(result.text, null);
  assert.ok(result.blockers.includes("SHADOW_DIRECTION_SAFETY_CONTRACT_INVALID"));
});

test("fails closed on missing input or invalid time", () => {
  const missing = renderH1ShadowDirectionTelegramPreview(null, "2026-09-04T09:45:00.000Z");
  assert.equal(missing.ready, false);
  assert.ok(missing.blockers.includes("MISSING_SHADOW_DIRECTION_ASSESSMENT"));

  const badTime = renderH1ShadowDirectionTelegramPreview(assessment(), "not-a-time");
  assert.equal(badTime.ready, false);
  assert.ok(badTime.blockers.includes("INVALID_PREVIEW_TIME"));
});
