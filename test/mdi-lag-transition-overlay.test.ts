import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiLagOverlay } from "../mdi-lag-transition-overlay.js";
import type { LagTransitionSnapshot } from "../lag-transition-research.js";
import type { MdiBias, MdiResult } from "../mdi-research-shadow.js";

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

function mdiResult(mdi: number | null, bias: MdiBias): MdiResult {
  return {
    mdi,
    bias,
    coveragePct: mdi == null ? 0 : 100,
    components: [],
    reasons: [],
    ruleVersion: "MDI_RESEARCH_SHADOW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    sourcePolicy: "VERIFIED_COMPONENT_SOURCES_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}

test("trusted bullish MDI overlays timing without changing lag sequence", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", result: mdiResult(42, "MILD_BULLISH") },
  });
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, 13);
  assert.equal(out.mdiLagFromNiftyMinutes, 4);
  assert.equal(out.mdiLagFromPremiumMinutes, -2);
  assert.ok(out.reasons.includes("MDI_PRECEDES_PREMIUM_CONFIRMATION"));
  assert.equal(out.alignmentWithLagDirection, "ALIGNED");
  assert.equal(out.affectsLagSequence, false);
});

test("trusted bearish MDI is marked contradicting against bullish lag direction", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", result: mdiResult(-40, "MILD_BEARISH") },
  });
  assert.equal(out.alignmentWithLagDirection, "CONTRADICTING");
});

test("untrusted MDI provenance contract fails closed", () => {
  const bad = { ...mdiResult(80, "STRONG_BULLISH"), sourcePolicy: "BROKEN" as MdiResult["sourcePolicy"] };
  const out = deriveMdiLagOverlay({ lag, mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", result: bad } });
  assert.equal(out.mdiFirstQualifiedAt, null);
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, null);
  assert.equal(out.mdiDirection, "UNKNOWN");
  assert.equal(out.alignmentWithLagDirection, "UNAVAILABLE");
  assert.ok(out.reasons.includes("MDI_PROVENANCE_CONTRACT_NOT_TRUSTED"));
});

test("inconsistent MDI score and bias fails closed", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", result: mdiResult(80, "STRONG_BEARISH") },
  });
  assert.equal(out.mdiFirstQualifiedAt, null);
  assert.equal(out.alignmentWithLagDirection, "UNAVAILABLE");
  assert.ok(out.reasons.includes("MDI_SCORE_BIAS_INCONSISTENT"));
});

test("mixed lag direction is unavailable, not falsely labelled contradiction", () => {
  const mixedLag: LagTransitionSnapshot = { ...lag, directionalIntegrity: "MIXED" };
  const out = deriveMdiLagOverlay({
    lag: mixedLag,
    mdi: { firstQualifiedAt: "2026-09-03T03:58:00.000Z", result: mdiResult(42, "MILD_BULLISH") },
  });
  assert.equal(out.alignmentWithLagDirection, "UNAVAILABLE");
  assert.ok(out.reasons.includes("LAG_DIRECTION_MIXED_ALIGNMENT_UNAVAILABLE"));
});

test("MDI before Heavyweight T0 is measured but explicitly flagged", () => {
  const out = deriveMdiLagOverlay({
    lag,
    mdi: { firstQualifiedAt: "2026-09-03T03:42:00.000Z", result: mdiResult(42, "MILD_BULLISH") },
  });
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, -3);
  assert.ok(out.reasons.includes("MDI_PRECEDES_HEAVYWEIGHT_T0"));
});

test("overlay has no live authority", () => {
  const out = deriveMdiLagOverlay({ lag, mdi: { firstQualifiedAt: null, result: mdiResult(null, "UNAVAILABLE") } });
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "RESEARCH_REPLAY_ONLY");
});
