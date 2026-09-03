import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiLagOverlay } from "../mdi-lag-transition-overlay.js";
import type { LagTransitionSnapshot } from "../lag-transition-research.js";

const lag: LagTransitionSnapshot = {
  tradeDate: "2026-09-03",
  t0Stage: "HEAVYWEIGHT",
  t0At: "2026-09-03T03:45:00.000Z",
  measurements: [
    { stage: "HEAVYWEIGHT", firstQualifiedAt: "2026-09-03T03:45:00.000Z", lagFromT0Minutes: 0, direction: "UP", source: "HW", present: true },
    { stage: "SECTOR", firstQualifiedAt: "2026-09-03T03:48:00.000Z", lagFromT0Minutes: 3, direction: "UP", source: "SEC", present: true },
    { stage: "BANKNIFTY", firstQualifiedAt: "2026-09-03T03:51:00.000Z", lagFromT0Minutes: 6, direction: "UP", source: "BN", present: true },
    { stage: "NIFTY", firstQualifiedAt: "2026-09-03T03:54:00.000Z", lagFromT0Minutes: 9, direction: "UP", source: "N", present: true },
    { stage: "VIX", firstQualifiedAt: "2026-09-03T03:57:00.000Z", lagFromT0Minutes: 12, direction: "UP", source: "V", present: true },
    { stage: "PREMIUM", firstQualifiedAt: "2026-09-03T04:00:00.000Z", lagFromT0Minutes: 15, direction: "UP", source: "P", present: true },
    { stage: "WALL", firstQualifiedAt: "2026-09-03T04:03:00.000Z", lagFromT0Minutes: 18, direction: "UP", source: "W", present: true },
  ],
  orderedStages: ["HEAVYWEIGHT", "SECTOR", "BANKNIFTY", "NIFTY", "VIX", "PREMIUM", "WALL"],
  missingStages: [],
  sequenceIntegrity: "PASS",
  directionalIntegrity: "ALIGNED",
  reasons: [],
  ruleVersion: "LAG_TRANSITION_RESEARCH_V1",
  semantics: "RESEARCH_REPLAY_ONLY",
  affectsVerdict: false,
  affectsTelegram: false,
  affectsExecution: false,
  createsOrders: false,
  aiMayOverride: false,
};

test("verified bullish MDI overlays timing without changing lag sequence", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", bias: "MILD_BULLISH", mdi: 42, sourceQualityVerified: true },
  });
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, 13);
  assert.equal(out.mdiLagFromNiftyMinutes, 4);
  assert.equal(out.mdiLagFromPremiumMinutes, -2);
  assert.equal(out.alignmentWithLagDirection, "ALIGNED");
  assert.equal(out.affectsLagSequence, false);
});

test("verified bearish MDI is marked contradicting against bullish lag direction", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", bias: "MILD_BEARISH", mdi: -40, sourceQualityVerified: true },
  });
  assert.equal(out.alignmentWithLagDirection, "CONTRADICTING");
});

test("unverified MDI source quality fails closed", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", bias: "STRONG_BULLISH", mdi: 80, sourceQualityVerified: false },
  });
  assert.equal(out.mdiFirstQualifiedAt, null);
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, null);
  assert.equal(out.mdiDirection, "UNKNOWN");
  assert.equal(out.alignmentWithLagDirection, "UNAVAILABLE");
});

test("overlay has no live authority", () => {
  const out = deriveMdiLagOverlay({ lag, mdi: { firstQualifiedAt: null, bias: "UNAVAILABLE", mdi: null, sourceQualityVerified: true } });
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "RESEARCH_REPLAY_ONLY");
});
