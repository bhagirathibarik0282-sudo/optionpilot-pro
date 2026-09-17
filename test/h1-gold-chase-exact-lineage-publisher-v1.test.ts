import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalOneRoofMarketSnapshot, type CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";
import type { H1GoldExactFamilySignal } from "../h1-gold-evidence-adapter-v1.js";
import {
  H1GoldChaseExactLineagePublisher,
  H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1,
} from "../h1-gold-chase-exact-lineage-publisher-v1.js";
import { H1GoldChaseExactLineageResolver } from "../h1-gold-chase-exact-lineage-resolver-v1.js";
import type { H1GoldChaseRuntimeAttachmentGateResult } from "../h1-gold-chase-runtime-attachment-gate-v1.js";
import type { LiveGateEvidencePacket } from "../h1-live-gate-evidence-assembler.js";

const T = "2026-09-17T07:00:00.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT = "NIFTY-20260917-070000";
const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE", "FUTURES_CONFIRMATION", "OPTION_PREMIUMS", "OI_POSITIONING", "MULTI_DTE",
  "VOLATILITY", "HEAVYWEIGHTS", "SECTOR_BREADTH", "RESPONSE_LADDER", "LIQUIDITY_EXECUTABILITY",
];

function canonicalSnapshot() {
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: SNAPSHOT,
    symbol: "NIFTY",
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-live",
    instrumentMasterVersion: "master-1",
    components: families.map((family, index) => ({
      family, status: "VERIFIED" as const, exchangeTimestampMs: T_MS, receivedAtMs: T_MS + 1,
      processedAtMs: T_MS + 2, ingestSeq: index + 1, provenance: "LOCAL_DERIVED" as const,
      source: `exact-${family}`, payload: {}, devilFlags: [],
    })),
    freshnessBudgetsMs: Object.fromEntries(families.map((family) => [family, 60_000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
  });
}

function exactSignal(source: string, state: "PASS" | "MISSING" = "PASS"): H1GoldExactFamilySignal {
  return { state, source, snapshotId: SNAPSHOT, observedAt: T, provenance: "LIVE_RUNTIME_EXACT", reasonCodes: [] };
}

function packet(): LiveGateEvidencePacket {
  const gate = { value: true, observedAt: T, source: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1", provenance: "LIVE_RUNTIME_EXACT" as const };
  return {
    identity: {
      symbol: "NIFTY", side: "CE", strike: 24000, expiryDate: "2026-09-22", dte: 5,
      moneyness: "ATM", premiumLtp: 110, observedAt: T,
      source: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", provenance: "LIVE_RUNTIME_EXACT",
    },
    gates: { capitalFit: gate, liquidityOk: gate, spreadOk: gate, currentOrNearExpiryUsable: gate, fallbackDteApproved: gate },
    ppdSupport: {
      version: "H1_LIVE_PPD_SUPPORT_V1", provenance: "LIVE_RUNTIME_EXACT",
      source: "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION", observedAt: T,
      symbol: "NIFTY", expiryDate: "2026-09-22", strike: 24000, candidateSide: "CE",
      allRequiredWindowsReady: true, candidateConfirmed: true,
      windows: ([3, 6, 15] as const).map((windowMinutes) => ({
        windowMinutes, usable: true, from: T, to: T, controllingSide: "CE" as const,
        pairState: "CE_CONTROLLED_EXPANSION" as const, rawPpdPp: 1, candidateOrientedPpdPp: 1,
        candidateControlledExpansion: true, reason: null,
      })),
      reasonCodes: [], supportingOnly: true, standaloneTrigger: false,
      productionImpact: "SELECTOR_SUPPORTING_EVIDENCE",
    },
  };
}

function gateResult(): H1GoldChaseRuntimeAttachmentGateResult {
  return {
    version: "H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1", state: "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT",
    ready: true, candidateKey: "NIFTY|2026-09-22|24000|CE", decisionId: "decision", blockers: [],
    requiresSameProcessRegistry: true, startsRuntime: false, schedulesSampling: false, persistsSamples: false,
    productionImpact: "NONE", affectsGoldEligibility: false, affectsSelector: false, affectsTelegram: false,
    affectsExecution: false, grantsPromotionAuthority: false, createsOrders: false, failClosed: true,
    semantics: "PROVES_APPROVED_SAME_PROCESS_BOOTSTRAP_SOURCE_BEFORE_SHADOW_RUNTIME_ATTACHMENT",
  };
}

function input(value = packet()) {
  const snapshot = canonicalSnapshot();
  return {
    packet: value,
    canonicalSnapshot: snapshot,
    canonicalRuntime: {
      version: "H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1", ready: true,
      stage: "READY_FOR_TELEGRAM_TRANSPORT",
      missionChain: { mission: { ready: true, snapshotId: SNAPSHOT, candidateKey: "NIFTY:CE:24000:2026-09-22:DTE5:ATM" } },
    } as never,
    goldBridge: {
      version: "H1_GOLD_LIVE_RUNTIME_BRIDGE_V1", ready: true, symbol: "NIFTY", side: "CE", observedAt: T,
      mappedCoreFamilyCount: 4, blockers: [],
      dataIntegrity: exactSignal("H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1"),
      spotStructure: exactSignal("H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1"),
      targetFuturesPositioning: exactSignal("H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1"),
      leaderPositioning: exactSignal("H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1"),
      chainRepositioning: exactSignal("H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1"),
    } as never,
    peerConflictAbsent: { symbol: "NIFTY", side: "CE", observedAt: T, state: "MISSING", signal: exactSignal("H1_GOLD_EXACT_PEER_CONFLICT_ABSENT_V1", "MISSING") } as never,
    horizonComplete: { symbol: "NIFTY", observedAt: T, state: "MISSING", signal: exactSignal("H1_GOLD_IMMUTABLE_HORIZON_COMPLETE_V1", "MISSING") } as never,
    premiumPoints: [
      { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, expiry: "2026-09-22", strike: 24000, optionType: "CE" as const, ltp: 100, observedAt: "2026-09-17T06:55:00.000Z", receivedAt: "2026-09-17T06:55:00.100Z" },
      { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, expiry: "2026-09-22", strike: 24000, optionType: "CE" as const, ltp: 110, observedAt: T, receivedAt: "2026-09-17T07:00:00.100Z" },
    ],
  };
}

test("approved exact producer outputs bootstrap and publish one-shot lineage", () => {
  const resolver = new H1GoldChaseExactLineageResolver("same-process", () => gateResult());
  const publisher = new H1GoldChaseExactLineagePublisher(resolver);
  const source = packet();
  const out = publisher.publish(input(source));
  assert.equal(out.version, H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1);
  assert.equal(out.state, "PUBLISHED");
  assert.equal(out.bootstrap?.state, "READY_FOR_FORWARD_COLLECTION");
  assert.equal(out.bootstrap?.adapted.families.chasePhase, "MISSING");
  assert.equal(resolver.resolve({ packet: source, dualPath: {} as never, observedAt: T })?.packet, source);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("missing controlled-expansion PPD blocks before lineage publication", () => {
  const resolver = new H1GoldChaseExactLineageResolver("same-process", () => gateResult());
  const publisher = new H1GoldChaseExactLineagePublisher(resolver);
  const source = packet();
  delete source.ppdSupport;
  const out = publisher.publish(input(source));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.some((code) => code.includes("HARD_GATE_MISSING_PREMIUM_PAIR")));
  assert.equal(out.publication, null);
  assert.equal(resolver.resolve({ packet: source, dualPath: {} as never, observedAt: T }), null);
});

test("canonical mission candidate drift blocks before bootstrap", () => {
  const resolver = new H1GoldChaseExactLineageResolver("same-process", () => gateResult());
  const publisher = new H1GoldChaseExactLineagePublisher(resolver);
  const value = input();
  (value.canonicalRuntime as any).missionChain.mission.candidateKey = "NIFTY:PE:24000:2026-09-22:DTE5:ATM";
  const out = publisher.publish(value);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("CANONICAL_RUNTIME_CANDIDATE_LINEAGE_MISMATCH"));
  assert.equal(out.bootstrap, null);
});
