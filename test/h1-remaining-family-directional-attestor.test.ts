import assert from "node:assert/strict";
import test from "node:test";
import { attestH1RemainingDirectionalFamilies, type H1ExactDirectionalFamilyEvidence, type H1RemainingDirectionalFamily } from "../h1-remaining-family-directional-attestor.js";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";
import { CanonicalLiveFamilySignalRegistry } from "../canonical-live-family-signal-registry.js";

const now = Date.parse("2026-09-14T10:00:00.000Z");
const manifest = "manifest-seven-v1";
const families: H1RemainingDirectionalFamily[] = [
  "MARKET_STRUCTURE", "FUTURES_CONFIRMATION", "OI_POSITIONING", "VOLATILITY",
  "HEAVYWEIGHTS", "SECTOR_BREADTH", "RESPONSE_LADDER",
];

function direction() {
  return deriveH1ExactLiveSpotDirection(
    { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: 23350, observedAt: "2026-09-14T09:58:00.000Z", receivedAt: "2026-09-14T09:58:01.000Z" },
    { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", price: 23400, observedAt: "2026-09-14T09:59:30.000Z", receivedAt: "2026-09-14T09:59:31.000Z" },
    { maxObservationGapMs: 120_000, minAbsoluteSpotMovePct: 0.05 },
  );
}

function evidence(): H1ExactDirectionalFamilyEvidence[] {
  return families.map((family, index) => ({
    provenance: "LIVE_RUNTIME_EXACT_DIRECTIONAL_FAMILY_V1",
    family,
    symbol: "NIFTY",
    direction: "UP",
    strength: 51 + index,
    observedAtMs: now - 30_000,
    sourceId: `exact-directional-${family}`,
    sourceManifestHash: manifest,
    deterministic: true,
    evidenceReady: true,
    grantsDirectionalSupport: true,
    contextOnly: false,
    devilFlags: [],
  }));
}

test("attests exactly seven same-direction families and preserves strengths", () => {
  const out = attestH1RemainingDirectionalFamilies({
    symbol: "NIFTY", selectedOptionSide: "CE", directionSource: direction(),
    evidence: evidence(), sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(out.ready, true);
  assert.equal(out.verifiedFamilyCount, 7);
  assert.equal(out.scoresComputed, false);
  assert.deepEqual(out.envelopes.map((x) => x.signal.strength), [51, 52, 53, 54, 55, 56, 57]);
  const registry = new CanonicalLiveFamilySignalRegistry();
  assert.ok(out.envelopes.every((row) => registry.publish(row).accepted));
});

test("context-only evidence can never be promoted", () => {
  const rows = evidence();
  rows[3] = { ...rows[3], contextOnly: true } as H1ExactDirectionalFamilyEvidence;
  const out = attestH1RemainingDirectionalFamilies({
    symbol: "NIFTY", selectedOptionSide: "CE", directionSource: direction(),
    evidence: rows, sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.equal(out.contextOnlyEvidencePromoted, false);
  assert.deepEqual(out.envelopes, []);
});

test("option side conflict, stale evidence and manifest mismatch fail closed", () => {
  const side = attestH1RemainingDirectionalFamilies({
    symbol: "NIFTY", selectedOptionSide: "PE", directionSource: direction(),
    evidence: evidence(), sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(side.ready, false);
  assert.ok(side.blockers.includes("SELECTED_OPTION_SIDE_CONFLICTS_WITH_INDEPENDENT_DIRECTION_SOURCE"));

  const staleRows = evidence().map((row) => ({ ...row, observedAtMs: now - 120_000 }));
  assert.equal(attestH1RemainingDirectionalFamilies({
    symbol: "NIFTY", selectedOptionSide: "CE", directionSource: direction(),
    evidence: staleRows, sourceManifestHash: manifest, nowMs: now,
  }).ready, false);

  const wrong = evidence();
  wrong[0] = { ...wrong[0], sourceManifestHash: "wrong" };
  assert.equal(attestH1RemainingDirectionalFamilies({
    symbol: "NIFTY", selectedOptionSide: "CE", directionSource: direction(),
    evidence: wrong, sourceManifestHash: manifest, nowMs: now,
  }).ready, false);
});

test("duplicate, opposite-direction and devil-flagged families block all output", () => {
  const rows = evidence();
  rows.push({ ...rows[0] });
  rows[1] = { ...rows[1], direction: "DOWN" };
  rows[2] = { ...rows[2], devilFlags: ["CONFLICT"] };
  const out = attestH1RemainingDirectionalFamilies({
    symbol: "NIFTY", selectedOptionSide: "CE", directionSource: direction(),
    evidence: rows, sourceManifestHash: manifest, nowMs: now,
  });
  assert.equal(out.ready, false);
  assert.deepEqual(out.envelopes, []);
  assert.ok(out.blockers.some((x) => x.includes("DUPLICATE")));
});
