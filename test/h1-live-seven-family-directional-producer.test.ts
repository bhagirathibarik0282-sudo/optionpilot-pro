import assert from "node:assert/strict";
import test from "node:test";
import { produceH1LiveSevenDirectionalFamilies, type H1LiveSevenFamilyFacts, type H1LiveSevenFamilyPolicy } from "../h1-live-seven-family-directional-producer.js";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";

const now = Date.parse("2026-09-15T04:05:00.000Z");
const common = { provenance: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, observedAtMs: now - 5_000, devilFlags: [] as string[] };
const policy: H1LiveSevenFamilyPolicy = {
  minSpotMovePct: 0.1, requiredStructureHoldSamples: 2,
  minFuturesMovePct: 0.1, requiredFuturesAcceptanceSamples: 2,
  minBand7PcrDelta: 0.02, minVolumePcrDelta: 0.02, minWallAsymmetryPct: 2,
  minCandidatePremiumMovePct: 2, minVolExpansionPct: 0.2,
  minHeavyweightDirectionalMarginPct: 20, minSectorDirectionalSharePct: 60,
  requiredResponseStages: 3, maxAgeMs: 90_000,
};

function direction() {
  return deriveH1ExactLiveSpotDirection(
    { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: 23300, observedAt: "2026-09-15T04:03:00.000Z", receivedAt: "2026-09-15T04:03:01.000Z" },
    { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: 23350, observedAt: "2026-09-15T04:04:30.000Z", receivedAt: "2026-09-15T04:04:31.000Z" },
    { maxObservationGapMs: 120_000, minAbsoluteSpotMovePct: 0.1 },
  );
}

function facts(): H1LiveSevenFamilyFacts {
  return {
    marketStructure: { ...common, sourceId: "exact-market-structure", spotMovePct: 0.22, spotPivotAccepted: true, structureHoldSamples: 2 },
    futuresConfirmation: { ...common, sourceId: "exact-futures", futuresMovePct: 0.2, futuresVwapAccepted: true, acceptanceSamples: 2 },
    oiPositioning: { ...common, sourceId: "exact-oi", band7PcrDelta: 0.04, volumePcrDelta: 0.03, wallAsymmetryPct: 4 },
    volatility: { ...common, sourceId: "exact-vol", candidatePremiumMovePct: 4, vixChangePct: 0.3, atmIvChangePct: 0.4 },
    heavyweights: { ...common, sourceId: "exact-heavyweights", bullishWeightPct: 70, bearishWeightPct: 20 },
    sectorBreadth: { ...common, sourceId: "exact-sectors", bullishCount: 7, bearishCount: 2, totalCount: 10 },
    responseLadder: { ...common, sourceId: "exact-ladder", direction: "UP", confirmedStages: 3, totalStages: 4 },
  };
}

test("produces all seven exact same-direction family facts with transparent policy scores", () => {
  const out = produceH1LiveSevenDirectionalFamilies({
    symbol: "NIFTY", directionSource: direction(), facts: facts(), policy,
    sourceManifestHash: "manifest-live", nowMs: now,
  });
  assert.equal(out.ready, true);
  assert.equal(out.evidence.length, 7);
  assert.equal(out.calibratedProbabilityClaimed, false);
  assert.ok(out.evidence.every((row) => row.direction === "UP" && row.strength >= 0 && row.strength <= 100));
});

test("one opposing family blocks the complete batch", () => {
  const value = facts();
  value.oiPositioning.band7PcrDelta = -0.05;
  const out = produceH1LiveSevenDirectionalFamilies({
    symbol: "NIFTY", directionSource: direction(), facts: value, policy,
    sourceManifestHash: "manifest-live", nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.deepEqual(out.evidence, []);
  assert.ok(out.blockers.includes("OI_POSITIONING:POLICY_NOT_CONFIRMED"));
});

test("stale, devil-flagged or invalid policy evidence fails closed", () => {
  const stale = facts();
  stale.sectorBreadth.observedAtMs = now - 100_000;
  assert.equal(produceH1LiveSevenDirectionalFamilies({
    symbol: "NIFTY", directionSource: direction(), facts: stale, policy,
    sourceManifestHash: "manifest-live", nowMs: now,
  }).ready, false);

  const flagged = facts();
  flagged.volatility.devilFlags = ["IV_SOURCE_CONFLICT"];
  assert.equal(produceH1LiveSevenDirectionalFamilies({
    symbol: "NIFTY", directionSource: direction(), facts: flagged, policy,
    sourceManifestHash: "manifest-live", nowMs: now,
  }).ready, false);

  assert.equal(produceH1LiveSevenDirectionalFamilies({
    symbol: "NIFTY", directionSource: direction(), facts: facts(),
    policy: { ...policy, minSectorDirectionalSharePct: 50 },
    sourceManifestHash: "manifest-live", nowMs: now,
  }).ready, false);
});

test("volatility cannot support without premium expansion and direction is never inferred from option side", () => {
  const value = facts();
  value.volatility.candidatePremiumMovePct = -2;
  const out = produceH1LiveSevenDirectionalFamilies({
    symbol: "NIFTY", directionSource: direction(), facts: value, policy,
    sourceManifestHash: "manifest-live", nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.equal(out.optionSideInferenceUsed, false);
  assert.equal(out.contextOnlyEvidencePromoted, false);
});
