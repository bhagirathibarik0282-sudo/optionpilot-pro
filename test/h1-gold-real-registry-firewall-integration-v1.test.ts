import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import {
  adaptH1GoldEvidence,
  type H1GoldEvidenceAdapterInput,
  type H1GoldExactFamilySignal,
} from "../h1-gold-evidence-adapter-v1.js";
import { listApprovedGoldProducers } from "../h1-gold-evidence-source-registry-v1.js";
import { evaluateH1GoldPromotionFirewall } from "../h1-gold-promotion-firewall-v1.js";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";
import { buildH1GoldPeerConflictAbsent } from "../h1-gold-peer-conflict-absent-producer-v1.js";

const T = "2026-09-16T05:45:00.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = "NIFTY-20260916-054500";

const canonicalFamilies: CanonicalMarketFamily[] = [
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

function canonicalSnapshot() {
  const components: CanonicalMarketComponent[] = canonicalFamilies.map((family, index) => ({
    family,
    status: "VERIFIED",
    exchangeTimestampMs: T_MS - 5_000,
    receivedAtMs: T_MS - 4_500,
    processedAtMs: T_MS - 4_000,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" : "LOCAL_DERIVED",
    source: `verified:${family}`,
    sourceTimeRange: { fromMs: T_MS - 60_000, toMs: T_MS - 5_000 },
    payload: { family },
  }));
  const freshnessBudgetsMs = Object.fromEntries(
    canonicalFamilies.map((family) => [family, 30_000]),
  ) as Record<CanonicalMarketFamily, number>;

  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: SNAPSHOT_ID,
    symbol: "NIFTY",
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-ws-connection-1",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs,
    ingestTelemetry: {
      queueDepth: 0,
      queueLagMs: 3,
      droppedPacketCount: 0,
      backpressureActive: false,
    },
  });
}

function signal(source: string): H1GoldExactFamilySignal {
  return {
    state: "PASS",
    source,
    snapshotId: SNAPSHOT_ID,
    observedAt: T,
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: ["EXACT_DECISION_TIME_EVIDENCE"],
  };
}

function exactDirection(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY", direction: "UP" | "DOWN" = "UP") {
  const base = symbol === "NIFTY" ? 24000 : symbol === "SENSEX" ? 80000 : 57000;
  const prior = new Date(T_MS - 5_000).toISOString();
  const current = direction === "UP" ? base * 1.001 : base * 0.999;
  return deriveH1ExactLiveSpotDirection(
    { source: "LIVE_RUNTIME_EXACT", symbol, price: base, observedAt: prior, receivedAt: prior },
    { source: "LIVE_RUNTIME_EXACT", symbol, price: current, observedAt: T, receivedAt: T },
    { maxObservationGapMs: 10_000, minAbsoluteSpotMovePct: 0.01 },
  );
}

function actualRegistryPathInput(): H1GoldEvidenceAdapterInput {
  const root = canonicalSnapshot();
  const peer = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: root,
    targetDirectionSource: exactDirection("NIFTY", "UP"),
    peerDirectionSources: [exactDirection("BANKNIFTY", "UP"), exactDirection("SENSEX", "UP")],
  });
  assert.equal(peer.state, "PASS");

  return {
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: root,
    dataIntegrity: signal("H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1"),
    premiumPair: signal("H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION"),
    spotStructure: signal("H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1"),
    targetFuturesPositioning: signal("H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1"),
    leaderPositioning: signal("H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1"),
    peerConflictAbsent: peer.signal,
    chainRepositioning: signal("H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1"),
    executionQuality: signal("H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1"),
    chasePhase: signal("CLAIMED_CHASE_PHASE_PRODUCER"),
    horizonComplete: signal("CLAIMED_HORIZON_COMPLETE_PRODUCER"),
  };
}

test("real registry now exposes exactly eight approved Gold producer families", () => {
  const approved = listApprovedGoldProducers();
  assert.equal(approved.length, 8);
  const families = new Set(approved.map((entry) => entry.family));
  assert.equal(families.has("peerConflictAbsent"), true);
  assert.equal(families.has("chasePhase"), false);
  assert.equal(families.has("horizonComplete"), false);
});

test("actual exact peer producer -> adapter -> registry -> firewall path passes peer family but cannot manufacture remaining Gold context", () => {
  const adapted = adaptH1GoldEvidence(actualRegistryPathInput());

  assert.equal(adapted.canonicalRootValid, true);
  assert.equal(adapted.families.dataIntegrity, "PASS");
  assert.equal(adapted.families.premiumPair, "PASS");
  assert.equal(adapted.families.spotStructure, "PASS");
  assert.equal(adapted.families.targetFuturesPositioning, "PASS");
  assert.equal(adapted.families.leaderPositioning, "PASS");
  assert.equal(adapted.families.peerConflictAbsent, "PASS");
  assert.equal(adapted.familyAudit.peerConflictAbsent.producerApproved, true);
  assert.equal(adapted.familyAudit.peerConflictAbsent.producerApprovalReason, "APPROVED_GOLD_PRODUCER");
  assert.equal(adapted.families.chainRepositioning, "PASS");
  assert.equal(adapted.families.executionQuality, "PASS");

  for (const family of ["chasePhase", "horizonComplete"] as const) {
    assert.equal(adapted.families[family], "MISSING");
    assert.equal(adapted.familyAudit[family].producerApproved, false);
    assert.equal(adapted.familyAudit[family].producerApprovalReason, "NO_APPROVED_GOLD_PRODUCER_FOR_FAMILY");
  }

  assert.equal(adapted.eligibility.decision, "BLOCKED");

  const firewall = evaluateH1GoldPromotionFirewall(adapted);
  assert.equal(firewall.state, "BLOCKED");
  assert.equal(firewall.strictEligibilityDecision, "BLOCKED");
  assert.equal(firewall.grantsPromotionAuthority, false);
  assert.equal(firewall.affectsSelector, false);
  assert.equal(firewall.affectsTelegram, false);
  assert.equal(firewall.affectsExecution, false);
  assert.equal(firewall.createsOrders, false);
  assert.equal(firewall.blockerCodes.includes("FAMILY_NOT_PASS_PEER_CONFLICT_ABSENT"), false);
  assert.ok(firewall.blockerCodes.includes("FAMILY_NOT_PASS_CHASE_PHASE"));
  assert.ok(firewall.blockerCodes.includes("FAMILY_NOT_PASS_HORIZON_COMPLETE"));
});
