import test from "node:test";
import assert from "node:assert/strict";
import { buildH1AuthorityFreeLowNoiseCommentary } from "../h1-authority-free-low-noise-commentary.js";
import type { H1ShadowDirectionAssessmentResult } from "../h1-shadow-direction-assessment.js";
import type { H1ExactOptionPremiumMoveEvidence } from "../h1-exact-option-premium-move-evidence.js";
import type { H1LowNoiseMinuteCommentary } from "../h1-shadow-telegram-message-contract.js";

function assessment(direction: "UP" | "DOWN" = "DOWN"): H1ShadowDirectionAssessmentResult {
  return {
    version: "H1_SHADOW_DIRECTION_ASSESSMENT_V1",
    readySymbolCount: 1,
    rows: [
      { symbol: "NIFTY", state: direction === "UP" ? "OBSERVE_UP" : "OBSERVE_DOWN", direction, blockers: [] },
      { symbol: "SENSEX", state: "BLOCKED", direction: null, blockers: ["SPOT_MOVE_BELOW_DIRECTION_THRESHOLD"] },
      { symbol: "BANKNIFTY", state: "BLOCKED", direction: null, blockers: ["NEAREST_PEER_NOT_READY"] },
    ],
    semantics: "SHADOW_DIRECTION_OBSERVATION_ONLY_NO_TRADE_VERDICT",
    productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
    affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
    grantsPromotionAuthority: false, failClosed: true,
  };
}

function premium(side: "CE" | "PE", move: number, token: number): H1ExactOptionPremiumMoveEvidence {
  return {
    version: "H1_EXACT_OPTION_PREMIUM_MOVE_EVIDENCE_V1", ready: true,
    symbol: "NIFTY", instrumentToken: token, expiry: "2026-09-08", strike: 23900, side,
    previousObservedAt: "2026-09-04T09:45:00.000Z", currentObservedAt: "2026-09-04T09:48:00.000Z",
    previousLtp: 100, currentLtp: 100 * (1 + move / 100), premiumMovePct: move, blockers: [],
    semantics: "EXACT_SAME_TOKEN_PREMIUM_MOVE_ONLY_NO_DIRECTION_MAPPING",
    productionImpact: "NONE", readOnly: true, forwardsDownstream: false,
    affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
    grantsPromotionAuthority: false, failClosed: true,
  };
}

function commentary(): H1LowNoiseMinuteCommentary {
  return {
    observedAt: "2026-09-04T09:48:00.000Z", selectedCandle: "15m", marketMode: "TRENDING",
    timeframeViews: [
      { timeframe: "1m", side: "PE", state: "BUILDING" },
      { timeframe: "3m", side: "PE", state: "CONFIRMED" },
      { timeframe: "6m", side: "PE", state: "CONFIRMED" },
      { timeframe: "15m", side: "PE", state: "CONFIRMED" },
      { timeframe: "30m", side: "NONE", state: "UNCHANGED" },
    ],
    sameSide: { side: "PE", activeCount: 8, observedCount: 10, premiumChangePct: 6.2 },
    oppositeSide: { side: "CE", activeCount: 2, observedCount: 10, premiumChangePct: -4.1 },
  };
}

test("renders direction and exact CE/PE evidence without causal or trade authority", () => {
  const result = buildH1AuthorityFreeLowNoiseCommentary(
    assessment("DOWN"), [premium("CE", -4.1, 10914562), premium("PE", 6.2, 10914818)], commentary(),
    "2026-09-04T09:48:00.000Z",
  );
  assert.equal(result.ready, true);
  assert.match(result.text, /NIFTY: OBSERVE_DOWN \| direction DOWN/);
  assert.match(result.text, /NIFTY CE 23900 .*premium -4\.10%/);
  assert.match(result.text, /NIFTY PE 23900 .*premium \+6\.20%/);
  assert.match(result.text, /3m PE CONFIRMED/);
  assert.match(result.text, /Direction→CE\/PE inference: OFF/);
  assert.match(result.text, /BUY\/SELL inference: OFF/);
  assert.equal(result.telegramSendAllowed, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});

test("semantic key ignores observation clock so unchanged minute messages dedup", () => {
  const a = buildH1AuthorityFreeLowNoiseCommentary(assessment(), [premium("PE", 6.2, 10914818)], commentary(), "2026-09-04T09:48:00.000Z");
  const b = buildH1AuthorityFreeLowNoiseCommentary(assessment(), [premium("PE", 6.2, 10914818)], commentary(), "2026-09-04T09:49:00.000Z");
  assert.equal(a.semanticKey, b.semanticKey);
});

test("semantic key changes when verified direction or exact premium state changes", () => {
  const base = buildH1AuthorityFreeLowNoiseCommentary(assessment("DOWN"), [premium("PE", 6.2, 10914818)], commentary(), "2026-09-04T09:48:00.000Z");
  const directionChanged = buildH1AuthorityFreeLowNoiseCommentary(assessment("UP"), [premium("PE", 6.2, 10914818)], commentary(), "2026-09-04T09:49:00.000Z");
  const premiumChanged = buildH1AuthorityFreeLowNoiseCommentary(assessment("DOWN"), [premium("PE", 7.4, 10914818)], commentary(), "2026-09-04T09:49:00.000Z");
  assert.notEqual(base.semanticKey, directionChanged.semanticKey);
  assert.notEqual(base.semanticKey, premiumChanged.semanticKey);
});

test("fails closed on upstream authority drift while remaining renderable with blockers", () => {
  const unsafe = assessment();
  unsafe.affectsTelegram = true as false;
  const result = buildH1AuthorityFreeLowNoiseCommentary(unsafe, [premium("PE", 6.2, 10914818)], commentary(), "2026-09-04T09:48:00.000Z");
  assert.equal(result.ready, false);
  assert.equal(result.renderable, true);
  assert.ok(result.blockers.includes("DIRECTION_ASSESSMENT_SAFETY_CONTRACT_INVALID"));
  assert.equal(result.telegramSendAllowed, false);
});
