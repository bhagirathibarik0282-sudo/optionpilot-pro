import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import type { H1ExactLiveSpotDirectionResult } from "../h1-exact-live-spot-direction-provider.js";
import {
  H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1,
  type H1LiveSevenFamilyDirectionalProducerResult,
} from "../h1-live-seven-family-directional-producer.js";
import type { H1ExactDirectionalFamilyEvidence, H1RemainingDirectionalFamily } from "../h1-remaining-family-directional-attestor.js";
import {
  buildH1GoldLiveRuntimeBridge,
  H1_GOLD_LIVE_RUNTIME_SOURCES,
} from "../h1-gold-live-runtime-bridge-v1.js";
import { adaptH1GoldEvidence, type H1GoldExactFamilySignal } from "../h1-gold-evidence-adapter-v1.js";
import { evaluateGoldenShadowCandidate } from "../h1-golden-shadow-candidate-v1.js";

const T = "2026-09-16T05:45:00.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = "NIFTY-20260916-054500";
const MANIFEST = "seven-family-manifest-20260916";
const FAMILIES: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];
const SEVEN: H1RemainingDirectionalFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OI_POSITIONING",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
];

function snapshot(droppedPacketCount = 0) {
  const components: CanonicalMarketComponent[] = FAMILIES.map((family, index) => ({
    family,
    status: "VERIFIED",
    exchangeTimestampMs: T_MS - 1_000,
    receivedAtMs: T_MS - 900,
    processedAtMs: T_MS - 800,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" : "LOCAL_DERIVED",
    source: `verified:${family}`,
    payload: { family },
  }));
  const freshnessBudgetsMs = Object.fromEntries(FAMILIES.map((family) => [family, 30_000])) as Record<CanonicalMarketFamily, number>;
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: SNAPSHOT_ID,
    symbol: "NIFTY",
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-ws-1",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs,
    ingestTelemetry: { queueDepth: 0, queueLagMs: 1, droppedPacketCount, backpressureActive: false },
  });
}

function direction(direction: "UP" | "DOWN" = "UP"): H1ExactLiveSpotDirectionResult {
  return {
    version: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1",
    ready: true,
    symbol: "NIFTY",
    direction,
    source: "VERIFIED_DETERMINISTIC_RUNTIME",
    sourceId: "H1_EXACT_LIVE_SPOT_DIRECTION_PROVIDER_V1",
    liveRuntimeExact: true,
    deterministic: true,
    previousObservedAt: "2026-09-16T05:42:00.000Z",
    currentObservedAt: T,
    spotMovePct: direction === "UP" ? 0.2 : -0.2,
    blockers: [],
    failClosed: true,
    productionImpact: "NONE",
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
  };
}

function exactEvidence(family: H1RemainingDirectionalFamily, observedAtMs = T_MS, dir: "UP" | "DOWN" = "UP"): H1ExactDirectionalFamilyEvidence {
  return {
    provenance: "LIVE_RUNTIME_EXACT_DIRECTIONAL_FAMILY_V1",
    family,
    symbol: "NIFTY",
    direction: dir,
    strength: 70,
    observedAtMs,
    sourceId: `exact:${family}`,
    sourceManifestHash: MANIFEST,
    deterministic: true,
    evidenceReady: true,
    grantsDirectionalSupport: true,
    contextOnly: false,
    devilFlags: [],
  };
}

function producer(observedAtMs = T_MS, dir: "UP" | "DOWN" = "UP"): H1LiveSevenFamilyDirectionalProducerResult {
  return {
    version: H1_LIVE_SEVEN_FAMILY_DIRECTIONAL_PRODUCER_V1,
    ready: true,
    evidence: SEVEN.map((family) => exactEvidence(family, observedAtMs, dir)),
    blockers: [],
    scoreMeaning: "DETERMINISTIC_POLICY_ALIGNMENT_NOT_PROBABILITY_NOT_WIN_RATE",
    contextOnlyEvidencePromoted: false,
    optionSideInferenceUsed: false,
    calibratedProbabilityClaimed: false,
    createsOrders: false,
    affectsExecution: false,
    failClosed: true,
  };
}

function supportSignal(source: string): H1GoldExactFamilySignal {
  return {
    state: "PASS",
    source,
    snapshotId: SNAPSHOT_ID,
    observedAt: T,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: ["EXACT_RUNTIME_SUPPORT"],
  };
}

function missingSignal(source: string): H1GoldExactFamilySignal {
  return {
    state: "MISSING",
    source,
    snapshotId: SNAPSHOT_ID,
    observedAt: T,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: ["SUPPORT_CONTEXT_NOT_MAPPED"],
  };
}

test("typed bridge maps canonical integrity plus four side-attested exact core families", () => {
  const out = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    directionSource: direction("UP"),
    sevenFamilyProducer: producer(),
    sourceManifestHash: MANIFEST,
  });
  assert.equal(out.ready, true);
  assert.equal(out.mappedCoreFamilyCount, 4);
  assert.equal(out.dataIntegrity.state, "PASS");
  assert.equal(out.spotStructure.state, "PASS");
  assert.equal(out.targetFuturesPositioning.state, "PASS");
  assert.equal(out.leaderPositioning.state, "PASS");
  assert.equal(out.chainRepositioning.state, "PASS");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("wrong-symbol independent direction cannot attest NIFTY Gold core evidence", () => {
  const wrong = { ...direction("UP"), symbol: "SENSEX" as const };
  const out = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    directionSource: wrong,
    sevenFamilyProducer: producer(),
    sourceManifestHash: MANIFEST,
  });
  assert.equal(out.ready, false);
  assert.equal(out.spotStructure.state, "MISSING");
  assert.ok(out.blockers.includes("VERIFIED_EXACT_DIRECTION_SOURCE_REQUIRED"));
});

test("CE/PE side conflict is killed by the side-aware attestor instead of being inferred", () => {
  const out = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "PE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    directionSource: direction("UP"),
    sevenFamilyProducer: producer(),
    sourceManifestHash: MANIFEST,
  });
  assert.equal(out.ready, false);
  assert.equal(out.spotStructure.state, "MISSING");
  assert.ok(out.blockers.includes("SELECTED_OPTION_SIDE_CONFLICTS_WITH_INDEPENDENT_DIRECTION_SOURCE"));
});

test("stale-but-attestable family rows cannot be restamped as exact decision-time Gold evidence", () => {
  const out = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    directionSource: direction("UP"),
    sevenFamilyProducer: producer(T_MS - 1_000),
    sourceManifestHash: MANIFEST,
  });
  assert.equal(out.ready, false);
  assert.equal(out.dataIntegrity.state, "PASS");
  assert.equal(out.spotStructure.state, "MISSING");
  assert.ok(out.blockers.includes("MARKET_STRUCTURE:NOT_EXACT_CANONICAL_DECISION_TIMESTAMP"));
});

test("invalid canonical truth root blocks data integrity and every mapped core family", () => {
  const out = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(1),
    directionSource: direction("UP"),
    sevenFamilyProducer: producer(),
    sourceManifestHash: MANIFEST,
  });
  assert.equal(out.ready, false);
  assert.equal(out.dataIntegrity.state, "MISSING");
  assert.equal(out.spotStructure.state, "MISSING");
  assert.ok(out.blockers.includes("CANONICAL_NOT_READY_FOR_STRICT_FILTERING"));
});

test("bridge sources are family-specific and cannot be swapped in the Gold adapter", () => {
  const b = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    directionSource: direction("UP"),
    sevenFamilyProducer: producer(),
    sourceManifestHash: MANIFEST,
  });
  const out = adaptH1GoldEvidence({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    dataIntegrity: b.dataIntegrity,
    premiumPair: supportSignal("H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION"),
    spotStructure: { ...b.spotStructure, source: H1_GOLD_LIVE_RUNTIME_SOURCES.targetFuturesPositioning },
    targetFuturesPositioning: b.targetFuturesPositioning,
    leaderPositioning: b.leaderPositioning,
    peerConflictAbsent: missingSignal("NO_EXACT_CONTEXT_PRODUCER"),
    chainRepositioning: b.chainRepositioning,
    executionQuality: supportSignal("H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1"),
    chasePhase: missingSignal("NO_EXACT_CONTEXT_PRODUCER"),
    horizonComplete: missingSignal("NO_EXACT_CONTEXT_PRODUCER"),
  });
  assert.equal(out.families.spotStructure, "MISSING");
  assert.equal(out.familyAudit.spotStructure.producerApprovalReason, "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY");
});

test("mapped bridge evidence can form a shadow candidate while unmapped support context remains MISSING", () => {
  const b = buildH1GoldLiveRuntimeBridge({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    directionSource: direction("UP"),
    sevenFamilyProducer: producer(),
    sourceManifestHash: MANIFEST,
  });
  const adapted = adaptH1GoldEvidence({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    dataIntegrity: b.dataIntegrity,
    premiumPair: supportSignal("H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION"),
    spotStructure: b.spotStructure,
    targetFuturesPositioning: b.targetFuturesPositioning,
    leaderPositioning: b.leaderPositioning,
    peerConflictAbsent: missingSignal("NO_EXACT_CONTEXT_PRODUCER"),
    chainRepositioning: b.chainRepositioning,
    executionQuality: supportSignal("H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1"),
    chasePhase: missingSignal("NO_EXACT_CONTEXT_PRODUCER"),
    horizonComplete: missingSignal("NO_EXACT_CONTEXT_PRODUCER"),
  });
  assert.equal(adapted.families.dataIntegrity, "PASS");
  assert.equal(adapted.families.spotStructure, "PASS");
  assert.equal(adapted.families.targetFuturesPositioning, "PASS");
  assert.equal(adapted.families.leaderPositioning, "PASS");
  assert.equal(adapted.families.chainRepositioning, "PASS");
  assert.equal(adapted.families.peerConflictAbsent, "MISSING");
  assert.equal(adapted.eligibility.decision, "BLOCKED");

  const candidate = evaluateGoldenShadowCandidate(adapted);
  assert.equal(candidate.state, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(candidate.affectsTelegram, false);
  assert.equal(candidate.affectsExecution, false);
  assert.equal(candidate.createsOrders, false);
});
