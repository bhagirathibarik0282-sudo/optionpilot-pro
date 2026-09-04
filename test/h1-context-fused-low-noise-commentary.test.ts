import test from "node:test";
import assert from "node:assert/strict";
import { buildH1ContextFusedLowNoiseCommentary } from "../h1-context-fused-low-noise-commentary.js";
import type { H1AuthorityFreeLowNoiseCommentary } from "../h1-authority-free-low-noise-commentary.js";
import type { H1PositioningChangeEvidence } from "../h1-positioning-change-evidence.js";
import type { H1VolatilityContextEvidence } from "../h1-volatility-context-evidence.js";
import type { H1CrossIndexBreadthEvidence } from "../h1-cross-index-breadth-state.js";
import type { H1TimeLagResponseLadder } from "../h1-time-lag-response-ladder.js";

const base: H1AuthorityFreeLowNoiseCommentary = {
  version: "H1_AUTHORITY_FREE_LOW_NOISE_COMMENTARY_V1", ready: true, renderable: true,
  text: "BASE", semanticKey: "base-key", blockers: [], productionImpact: "NONE",
  telegramSendAllowed: false, affectsTelegram: false, affectsVerdict: false, affectsExecution: false,
  grantsPromotionAuthority: false, failClosed: true,
  semantics: "DIRECTION_PLUS_EXACT_PREMIUM_TEXT_ONLY_NO_CAUSAL_MAPPING_NO_TRANSPORT",
};

const positioning: H1PositioningChangeEvidence = {
  version: "H1_POSITIONING_CHANGE_EVIDENCE_V1", ready: true, symbol: "NIFTY", expiry: "2026-09-08",
  previousObservedAt: "2026-09-04T09:30:00.000Z", currentObservedAt: "2026-09-04T09:33:00.000Z",
  fullChainOiPcrDelta: 0.04, band7OiPcrDelta: 0.07, volumePcrDelta: 0.02,
  callWallMigration: 50, putWallMigration: 50, callWallStrengthChangePct: -10, putWallStrengthChangePct: 15,
  callWallState: "SHEDDING", putWallState: "BUILDING", blockers: [],
  semantics: "POSITIONING_CHANGE_CONTEXT_ONLY_NO_DIRECTION_TRUTH", productionImpact: "NONE", readOnly: true,
  forwardsDownstream: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
  grantsPromotionAuthority: false, failClosed: true,
};

const volatility: H1VolatilityContextEvidence = {
  version: "H1_VOLATILITY_CONTEXT_EVIDENCE_V1", ready: true, symbol: "NIFTY",
  previousObservedAt: "2026-09-04T09:30:00.000Z", currentObservedAt: "2026-09-04T09:33:00.000Z",
  previousVix: 11.2, currentVix: 11.48, vixChange: 0.28, vixChangePct: 2.5, vixState: "RISING",
  ivAvailable: false, atmIv: null, ivVelocityPerMinute: null, ivStatus: "NOT_CONFIGURED", blockers: [],
  semantics: "VOLATILITY_CONTEXT_ONLY_NO_DIRECTION_TRUTH", productionImpact: "NONE", readOnly: true,
  forwardsDownstream: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false,
  grantsPromotionAuthority: false, failClosed: true,
};

const breadth: H1CrossIndexBreadthEvidence = {
  version: "H1_CROSS_INDEX_BREADTH_STATE_V1", ready: true, timeframe: "15M", consensusDirection: "UP", usableIndexCount: 3,
  rows: [
    { symbol: "NIFTY", state: "LEADING", direction: "UP", temporalState: "STRENGTHENING", blockEnd: "2026-09-04T09:30:00.000Z", blockers: [] },
    { symbol: "BANKNIFTY", state: "CONFIRMING", direction: "UP", temporalState: "STABLE", blockEnd: "2026-09-04T09:30:00.000Z", blockers: [] },
    { symbol: "SENSEX", state: "FADING", direction: "UP", temporalState: "WEAKENING", blockEnd: "2026-09-04T09:30:00.000Z", blockers: [] },
  ],
  heavyweightDetailAvailable: false, sectorDetailAvailable: false, heavyweightDetailStatus: "UNAVAILABLE", sectorDetailStatus: "UNAVAILABLE",
  blockers: [], semantics: "CROSS_INDEX_OBSERVATIONAL_BREADTH_ONLY_NO_CONSTITUENT_INFERENCE", productionImpact: "NONE", readOnly: true,
  forwardsDownstream: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false, grantsPromotionAuthority: false, failClosed: true,
};

const ladder: H1TimeLagResponseLadder = {
  version: "H1_TIME_LAG_RESPONSE_LADDER_V1", ready: true, symbol: "NIFTY", anchorDirection: "UP",
  highestConfirmedStage: "TRANSITION_VALIDATION", causalLagAvailable: false,
  stages: [
    { timeframe: "3M", stage: "EARLY_CLUE", direction: "UP", confirmed: true, blockEnd: "2026-09-04T09:33:00.000Z", observedBlockEndOffsetMinutesFrom3m: 0, blockers: [] },
    { timeframe: "6M", stage: "INITIAL_CONFIRMATION", direction: "UP", confirmed: true, blockEnd: "2026-09-04T09:30:00.000Z", observedBlockEndOffsetMinutesFrom3m: -3, blockers: [] },
    { timeframe: "15M", stage: "TRANSITION_VALIDATION", direction: "UP", confirmed: true, blockEnd: "2026-09-04T09:30:00.000Z", observedBlockEndOffsetMinutesFrom3m: -3, blockers: [] },
    { timeframe: "30M", stage: "SUSTAINED_REGIME_CONFIRMATION", direction: "DOWN", confirmed: false, blockEnd: "2026-09-04T09:30:00.000Z", observedBlockEndOffsetMinutesFrom3m: -3, blockers: ["DIRECTION_CONFLICTS_WITH_3M_ANCHOR"] },
  ],
  blockers: [], semantics: "OBSERVED_CLOSED_BLOCK_SEQUENCE_ONLY_NO_CAUSAL_CLAIM", productionImpact: "NONE", readOnly: true,
  forwardsDownstream: false, affectsVerdict: false, affectsExecution: false, affectsTelegram: false, grantsPromotionAuthority: false, failClosed: true,
};

test("fuses verified contexts without adding authority", () => {
  const result = buildH1ContextFusedLowNoiseCommentary(base, [positioning], [volatility], breadth, [ladder]);
  assert.equal(result.ready, true);
  assert.match(result.text, /PCR Δ/);
  assert.match(result.text, /VIX 11.48/);
  assert.match(result.text, /Heavyweight detail: UNAVAILABLE/);
  assert.match(result.text, /causal lag: UNAVAILABLE/);
  assert.match(result.text, /Direction→CE\/PE inference: OFF/);
  assert.equal(result.telegramSendAllowed, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("timestamp-only changes do not alter fused semantic key", () => {
  const first = buildH1ContextFusedLowNoiseCommentary(base, [positioning], [volatility], breadth, [ladder]);
  const laterP = { ...positioning, previousObservedAt: "2026-09-04T09:31:00.000Z", currentObservedAt: "2026-09-04T09:34:00.000Z" };
  const laterV = { ...volatility, previousObservedAt: "2026-09-04T09:31:00.000Z", currentObservedAt: "2026-09-04T09:34:00.000Z" };
  const second = buildH1ContextFusedLowNoiseCommentary(base, [laterP], [laterV], breadth, [ladder]);
  assert.equal(first.semanticKey, second.semanticKey);
});

test("real context change alters fused semantic key", () => {
  const first = buildH1ContextFusedLowNoiseCommentary(base, [positioning], [volatility], breadth, [ladder]);
  const second = buildH1ContextFusedLowNoiseCommentary(base, [{ ...positioning, band7OiPcrDelta: 0.12 }], [volatility], breadth, [ladder]);
  assert.notEqual(first.semanticKey, second.semanticKey);
});

test("fails closed on upstream authority drift", () => {
  const unsafe = { ...volatility, affectsExecution: true as false };
  const result = buildH1ContextFusedLowNoiseCommentary(base, [positioning], [unsafe], breadth, [ladder]);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("VOLATILITY_CONTEXT_SAFETY_CONTRACT_INVALID"));
});

test("renders missing context but does not call it ready", () => {
  const result = buildH1ContextFusedLowNoiseCommentary(base, [], [], null, []);
  assert.equal(result.ready, false);
  assert.equal(result.renderable, true);
  assert.match(result.text, /MISSING\/BLOCKED/);
});
