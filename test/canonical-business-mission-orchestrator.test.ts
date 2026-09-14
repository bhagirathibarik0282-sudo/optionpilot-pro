import assert from "node:assert/strict";
import test from "node:test";
import { runCanonicalBusinessMission } from "../canonical-business-mission-orchestrator.js";
import { canonicalBusinessRuntimeRegistry } from "../canonical-business-runtime-registry.js";
import type { CanonicalLiveShadowSnapshotSourceResult } from "../canonical-live-shadow-snapshot-source.js";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import type { CanonicalDeterministicFamilySignal } from "../canonical-normalized-family-support-producer.js";
import { selectExecutionCandidate, type ExecutionCandidateInput } from "../execution-candidate-selector.js";

const now = Date.now();
const hash = "verified-manifest-v1";
const families: CanonicalMarketFamily[] = [
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

function source(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY"): CanonicalLiveShadowSnapshotSourceResult {
  const freshnessBudgetsMs = Object.fromEntries(families.map((family) => [family, 60_000]));
  const snapshot = buildCanonicalOneRoofMarketSnapshot({
    snapshotId: `snapshot-${symbol}`,
    symbol,
    asOfMs: now - 1_000,
    minuteClosed: true,
    connectionId: "kite-live-1",
    instrumentMasterVersion: "kite-master-1",
    components: families.map((family, index) => ({
      family,
      status: "VERIFIED" as const,
      exchangeTimestampMs: now - 1_000,
      receivedAtMs: now - 900,
      processedAtMs: now - 800,
      ingestSeq: index + 1,
      provenance: "KITE_WS" as const,
      source: `verified-${family}`,
      payload: {},
      devilFlags: [],
    })),
    freshnessBudgetsMs,
    ingestTelemetry: {
      queueDepth: 0,
      queueLagMs: 0,
      droppedPacketCount: 0,
      backpressureActive: false,
    },
  });

  return {
    version: "CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_V1",
    ready: true,
    sourceManifestHash: hash,
    snapshot,
    snapshotReadyForStrictFiltering: true,
    constituentTickCount: 50,
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
  };
}

function signals(): CanonicalDeterministicFamilySignal[] {
  return families.map((family) => ({
    family,
    stance: "BUYER_SUPPORT" as const,
    strength: 80,
    deterministic: true as const,
    evidenceReady: true as const,
    sourceId: `engine-${family}`,
    sourceManifestHash: hash,
    sourceSemantics: "EXPLICIT_DIRECTIONAL_SUPPORT" as const,
    grantsDirectionalSupport: true as const,
    devilFlags: [],
  }));
}

function candidate(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY"): ExecutionCandidateInput {
  return {
    symbol,
    side: "CE",
    strike: symbol === "SENSEX" ? 75000 : symbol === "BANKNIFTY" ? 56600 : 23400,
    expiryDate: symbol === "BANKNIFTY" ? "2026-09-29" : "2026-09-15",
    dte: symbol === "BANKNIFTY" ? 15 : 1,
    moneyness: "ATM",
    premiumLtp: 150,
    capitalFit: true,
    liquidityOk: true,
    spreadOk: true,
    premiumResponseConfirmed: true,
    deltaGammaResponseConfirmed: true,
    thetaIvBurdenAcceptable: true,
    multiExpiryConflictAbsent: true,
    currentOrNearExpiryUsable: symbol !== "BANKNIFTY",
    higherDteUsable: symbol === "BANKNIFTY",
  };
}

function input(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY" = "NIFTY") {
  const exact = candidate(symbol);
  return {
    provenance: "LIVE_CANONICAL_MISSION_ORCHESTRATOR_V1" as const,
    decisionId: `decision-${symbol}`,
    nowMs: now,
    telegramHorizon: "INTRADAY" as const,
    source: source(symbol),
    familySignals: signals(),
    evaluations: [{ candidate: exact, selector: selectExecutionCandidate(exact) }],
  };
}

test.beforeEach(() => canonicalBusinessRuntimeRegistry.clear());

test("runs verified snapshot through ten families scoring selector and Telegram transport", () => {
  const out = runCanonicalBusinessMission(input());
  assert.equal(out.ready, true);
  assert.equal(out.stage, "READY_FOR_TELEGRAM_TRANSPORT");
  assert.equal(out.snapshotId, "snapshot-NIFTY");
  assert.equal(out.decisionId, "decision-NIFTY");
  assert.equal(out.candidateKey, "NIFTY:CE:23400:2026-09-15:DTE1:ATM");
  assert.equal(out.publishesCanonicalCandidate, true);
  assert.equal(out.sendsTelegram, false);
  assert.equal(out.createsOrders, false);
});

test("missing family signal fails closed before scoring", () => {
  const value = input();
  value.familySignals = value.familySignals.slice(0, 9);
  const out = runCanonicalBusinessMission(value);
  assert.equal(out.ready, false);
  assert.equal(out.stage, "NORMALIZATION");
  assert.ok(out.blockers.some((blocker) => blocker.includes("FAMILY_SIGNAL_MISSING")));
  assert.equal(canonicalBusinessRuntimeRegistry.read("NIFTY"), null);
});

test("blocked canonical source cannot enter normalization", () => {
  const value = input();
  value.source = { ...value.source, ready: false, blockers: ["LIVE_SOURCE_BLOCKED"] };
  const out = runCanonicalBusinessMission(value);
  assert.equal(out.ready, false);
  assert.equal(out.stage, "EVIDENCE_ADAPTER");
  assert.ok(out.blockers.includes("SOURCE_LIVE_SOURCE_BLOCKED"));
});

test("multiple exact SELECT decisions fail at the sole mission gate", () => {
  const value = input();
  const second = candidate("SENSEX");
  value.evaluations.push({ candidate: second, selector: selectExecutionCandidate(second) });
  const out = runCanonicalBusinessMission(value);
  assert.equal(out.ready, false);
  assert.equal(out.stage, "MISSION_GATE");
  assert.deepEqual(out.blockers, ["EXACTLY_ONE_LIVE_SELECT_REQUIRED"]);
});

test("BANKNIFTY remains observation-only after all upstream evidence passes", () => {
  const out = runCanonicalBusinessMission(input("BANKNIFTY"));
  assert.equal(out.ready, false);
  assert.equal(out.stage, "MISSION_GATE");
  assert.deepEqual(out.blockers, ["BANKNIFTY_OBSERVATION_ONLY"]);
});
