import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiLagOverlay } from "../mdi-lag-transition-overlay.js";
import type { LagTransitionSnapshot } from "../lag-transition-research.js";
import type { MdiInput, MdiPoint, MdiSourceQualityMap } from "../mdi-research-shadow.js";

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

const verified: MdiSourceQualityMap = { PCR: "VERIFIED", WALL: "VERIFIED", IV: "VERIFIED", VIX: "VERIFIED", FUTURES: "VERIFIED" };

const base: MdiPoint = {
  ts: "2026-09-03T03:52:00.000Z",
  sourceQuality: verified,
  fullPcr: 0.80,
  band7Pcr: 0.85,
  callWallStrike: 24000,
  putWallStrike: 23800,
  callWallStrength: 100,
  putWallStrength: 100,
  ceIv: 12,
  peIv: 12,
  indiaVix: 12,
  futureLtp: 23900,
};

function bullish(currentTs = "2026-09-03T03:58:00.000Z"): MdiInput {
  return {
    previous: base,
    current: {
      ...base,
      ts: currentTs,
      fullPcr: 0.95,
      band7Pcr: 1.00,
      callWallStrike: 24050,
      putWallStrike: 23850,
      callWallStrength: 90,
      putWallStrength: 120,
      ceIv: 15,
      peIv: 12,
      indiaVix: 11.4,
      futureLtp: 23990,
    },
    strikeStep: 50,
  };
}

function bearish(currentTs = "2026-09-03T03:58:00.000Z"): MdiInput {
  return {
    previous: base,
    current: {
      ...base,
      ts: currentTs,
      fullPcr: 0.65,
      band7Pcr: 0.70,
      callWallStrike: 23950,
      putWallStrike: 23750,
      callWallStrength: 120,
      putWallStrength: 85,
      ceIv: 12,
      peIv: 15,
      indiaVix: 12.8,
      futureLtp: 23810,
    },
    strikeStep: 50,
  };
}

test("internally derived bullish MDI overlays timing without changing lag sequence", () => {
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [bullish()] });
  assert.equal(out.mdiFirstQualifiedAt, "2026-09-03T03:58:00.000Z");
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, 13);
  assert.equal(out.mdiLagFromNiftyMinutes, 4);
  assert.equal(out.mdiLagFromPremiumMinutes, -2);
  assert.ok(out.reasons.includes("MDI_PRECEDES_PREMIUM_CONFIRMATION"));
  assert.equal(out.alignmentWithLagDirection, "ALIGNED");
  assert.equal(out.affectsLagSequence, false);
  assert.equal(out.sourcePolicy, "DERIVE_MDI_INTERNALLY_FROM_RAW_VERIFIED_INPUTS");
});

test("internally derived bearish MDI contradicts bullish lag direction", () => {
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [bearish()] });
  assert.equal(out.alignmentWithLagDirection, "CONTRADICTING");
});

test("proxy or stale MDI evidence fails closed through the upstream MDI derivation", () => {
  const bad = bullish();
  bad.current = { ...bad.current, sourceQuality: { ...verified, PCR: "PROXY", WALL: "STALE", IV: "DEGRADED", FUTURES: "UNKNOWN" } };
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [bad] });
  assert.equal(out.mdiFirstQualifiedAt, null);
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, null);
  assert.equal(out.mdiDirection, "UNKNOWN");
  assert.equal(out.alignmentWithLagDirection, "UNAVAILABLE");
  assert.ok(out.reasons.includes("MDI_OBSERVATION_NOT_QUALIFIED"));
});

test("non-forward or invalid MDI observation timestamps fail closed", () => {
  const invalid = bullish("2026-09-03T03:50:00.000Z");
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [invalid] });
  assert.equal(out.mdiFirstQualifiedAt, null);
  assert.ok(out.reasons.includes("MDI_OBSERVATION_TIMESTAMP_INVALID_OR_NON_FORWARD"));
});

test("earliest internally qualified observation is selected independent of caller ordering", () => {
  const later = bullish("2026-09-03T04:02:00.000Z");
  const earlier = bullish("2026-09-03T03:58:00.000Z");
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [later, earlier] });
  assert.equal(out.mdiFirstQualifiedAt, "2026-09-03T03:58:00.000Z");
});

test("mixed lag direction is unavailable, not falsely labelled contradiction", () => {
  const mixedLag: LagTransitionSnapshot = { ...lag, directionalIntegrity: "MIXED" };
  const out = deriveMdiLagOverlay({ lag: mixedLag, mdiObservations: [bullish()] });
  assert.equal(out.alignmentWithLagDirection, "UNAVAILABLE");
  assert.ok(out.reasons.includes("LAG_DIRECTION_MIXED_ALIGNMENT_UNAVAILABLE"));
});

test("MDI before Heavyweight T0 is measured but explicitly flagged", () => {
  const earlyBase: MdiPoint = { ...base, ts: "2026-09-03T03:36:00.000Z" };
  const early = bullish("2026-09-03T03:42:00.000Z");
  early.previous = earlyBase;
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [early] });
  assert.equal(out.mdiLagFromHeavyweightT0Minutes, -3);
  assert.ok(out.reasons.includes("MDI_PRECEDES_HEAVYWEIGHT_T0"));
});

test("overlay has no live authority", () => {
  const out = deriveMdiLagOverlay({ lag, mdiObservations: [] });
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.aiMayOverride, false);
  assert.equal(out.semantics, "RESEARCH_REPLAY_ONLY");
});
