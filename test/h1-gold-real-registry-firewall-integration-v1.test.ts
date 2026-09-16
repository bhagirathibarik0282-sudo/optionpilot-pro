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

function actualRegistryPathInput(): H1GoldEvidenceAdapterInput {
  return {
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: canonicalSnapshot(),
    dataIntegrity: signal("H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1"),
    premiumPair: signal("H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION"),
    spotStructure: signal("H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1"),
    targetFuturesPositioning: signal("H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1"),
    leaderPositioning: signal("H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1"),
    peerConflictAbsent: signal("CLAIMED_PEER_CONFLICT_PRODUCER"),
    chainRepositioning: signal("H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1"),
    executionQuality: signal("H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1"),
    chasePhase: signal("CLAIMED_CHASE_PHASE_PRODUCER"),
    horizonComplete: signal("CLAIMED_HORIZON_COMPLETE_PRODUCER"),
  };
}

test("real registry currently exposes exactly seven approved Gold producer families", () => {
  const approved = listApprovedGoldProducers();
  assert.equal(approved.length, 7);
  const families = new Set(approved.map((entry) => entry.family));
  assert.equal(families.has("peerConflictAbsent"), false);
  assert.equal(families.has("chasePhase"), false);
  assert.equal(families.has("horizonComplete"), false);
});

test("actual adapter -> registry -> firewall path cannot manufacture Gold from the three unregistered families", () => {
  const adapted = adaptH1GoldEvidence(actualRegistryPathInput());

  assert.equal(adapted.canonicalRootValid, true);
  assert.equal(adapted.families.dataIntegrity, "PASS");
  assert.equal(adapted.families.premiumPair, "PASS");
  assert.equal(adapted.families.spotStructure, "PASS");
  assert.equal(adapted.families.targetFuturesPositioning, "PASS");
  assert.equal(adapted.families.leaderPositioning, "PASS");
  assert.equal(adapted.families.chainRepositioning, "PASS");
  assert.equal(adapted.families.executionQuality, "PASS");

  for (const family of ["peerConflictAbsent", "chasePhase", "horizonComplete"] as const) {
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
  assert.ok(firewall.blockerCodes.includes("FAMILY_NOT_PASS_PEER_CONFLICT_ABSENT"));
  assert.ok(firewall.blockerCodes.includes("FAMILY_NOT_PASS_CHASE_PHASE"));
  assert.ok(firewall.blockerCodes.includes("FAMILY_NOT_PASS_HORIZON_COMPLETE"));
});
