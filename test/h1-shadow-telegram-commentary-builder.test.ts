import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ShadowTelegramCommentary } from "../h1-shadow-telegram-commentary-builder.js";
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

test("formats ready shadow observation without publish authority", () => {
  const result = buildH1ShadowTelegramCommentary(assessment());
  assert.equal(result.messages[0].publishable, false);
  assert.match(result.messages[0].text, /NIFTY \| LIVE SHADOW DOWN/);
  assert.equal(result.canSendTelegram, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.forwardsDownstream, false);
});

test("blocked rows remain non-publishable and preserve blockers", () => {
  const result = buildH1ShadowTelegramCommentary(assessment());
  assert.equal(result.messages[1].publishable, false);
  assert.match(result.messages[1].text, /SHADOW BLOCKED/);
  assert.ok(result.messages[1].blockers.includes("SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"));
});

test("fails closed on assessment safety-contract drift", () => {
  const source = assessment();
  (source as unknown as { affectsTelegram: boolean }).affectsTelegram = true;
  const result = buildH1ShadowTelegramCommentary(source);
  assert.ok(result.messages.every((message) => message.publishable === false));
  assert.ok(result.messages.every((message) => message.blockers.includes("SHADOW_ASSESSMENT_SAFETY_CONTRACT_INVALID")));
  assert.equal(result.canSendTelegram, false);
});
