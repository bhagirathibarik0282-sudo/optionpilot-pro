import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalBusinessEvidenceInputs } from "../canonical-business-evidence-input-adapter.js";
import { buildBusinessHorizonView } from "../business-buyer-seller-layer.js";

const families = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE",
  "VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
] as const;

function source(readyForStrictFiltering = true): any {
  const components = families.map((family, i) => ({
    family,
    status: readyForStrictFiltering || family !== "HEAVYWEIGHTS" ? "VERIFIED" : "BLOCKED",
    exchangeTimestampMs: 1000,
    receivedAtMs: 1100,
    processedAtMs: 1200,
    ingestSeq: i + 1,
    provenance: "LOCAL_DERIVED",
    source: `TEST_${family}`,
    payload: {},
    devilFlags: readyForStrictFiltering || family !== "HEAVYWEIGHTS" ? [] : ["MISSING_TICK:101"],
  }));
  return {
    version: "CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_V1",
    ready: true,
    sourceManifestHash: "a".repeat(64),
    snapshotReadyForStrictFiltering: readyForStrictFiltering,
    constituentTickCount: 2,
    blockers: [],
    readOnly: true,
    shadowOnly: true,
    readsLiveConstituentTicks: true,
    forwardsDownstream: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsCandidateAuthority: false,
    wiredIntoServer: false,
    failClosed: true,
    snapshot: {
      version: "CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2",
      snapshotId: "snap-business-1",
      symbol: "NIFTY",
      asOfMs: 2000,
      connectionId: "c1",
      instrumentMasterVersion: "m1",
      minuteClosed: true,
      immutableRecord: true,
      recordable: true,
      readyForStrictFiltering,
      qualityState: readyForStrictFiltering ? "VERIFIED" : "BLOCKED",
      userFacingState: readyForStrictFiltering ? "READY_FOR_BUYER_SELLER_FILTER" : "WAIT_FOR_CONFIRMATION",
      newEntryGate: readyForStrictFiltering ? "ALLOW_NEW_ENTRIES" : "BLOCK_NEW_ENTRIES",
      components,
      freshnessBudgetsMs: {},
      ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
      internalBlockers: readyForStrictFiltering ? [] : ["HEAVYWEIGHTS:NOT_VERIFIED"],
      failClosed: true,
      createsOrders: false,
      affectsExecution: false,
      aiMayOverride: false,
    },
  };
}

test("verified snapshot becomes score-neutral business evidence for all three horizons", () => {
  const result = buildCanonicalBusinessEvidenceInputs(source(true));
  assert.equal(result.ready, true);
  assert.equal(result.symbol, "NIFTY");
  assert.equal(result.horizons.length, 3);
  assert.equal(result.verifiedFamilies.length, 10);
  assert.equal(result.blockedFamilies.length, 0);
  for (const input of result.horizons) {
    assert.equal(input.evidenceReady, true);
    assert.equal(input.buyerScore, null);
    assert.equal(input.sellerScore, null);
    assert.equal(buildBusinessHorizonView(input).action, "WAIT");
  }
  assert.equal(result.scoresComputed, false);
  assert.equal(result.candidateSelected, false);
  assert.equal(result.telegramSent, false);
  assert.equal(result.createsOrders, false);
});

test("blocked snapshot preserves blockers and forces business WAIT", () => {
  const result = buildCanonicalBusinessEvidenceInputs(source(false));
  assert.equal(result.ready, true);
  assert.equal(result.blockedFamilies.includes("HEAVYWEIGHTS"), true);
  for (const input of result.horizons) {
    assert.equal(input.evidenceReady, false);
    assert.ok(input.devilFlags?.includes("HEAVYWEIGHTS:NOT_VERIFIED"));
    assert.equal(buildBusinessHorizonView(input).action, "WAIT");
  }
});

test("fails closed on unready or authority-tampered live source", () => {
  const unready = source(true); unready.ready = false;
  assert.equal(buildCanonicalBusinessEvidenceInputs(unready).ready, false);
  const tampered = source(true); tampered.affectsTelegram = true;
  const result = buildCanonicalBusinessEvidenceInputs(tampered);
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("|"), /AUTHORITY_BOUNDARY_INVALID/);
});
