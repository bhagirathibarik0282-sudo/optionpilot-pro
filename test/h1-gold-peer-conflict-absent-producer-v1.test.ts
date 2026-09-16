import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";
import {
  buildH1GoldPeerConflictAbsent,
  H1_GOLD_PEER_CONFLICT_ABSENT_SOURCE,
} from "../h1-gold-peer-conflict-absent-producer-v1.js";

const T = "2026-09-16T06:00:00.000Z";
const T_MS = Date.parse(T);
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

function snapshot(symbol: "NIFTY" | "SENSEX" = "NIFTY", droppedPacketCount = 0) {
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
    snapshotId: `${symbol}-20260916-060000`,
    symbol,
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-ws-peer-test",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs,
    ingestTelemetry: { queueDepth: 0, queueLagMs: 1, droppedPacketCount, backpressureActive: false },
  });
}

function basePrice(symbol: "NIFTY" | "SENSEX" | "BANKNIFTY"): number {
  if (symbol === "NIFTY") return 24000;
  if (symbol === "SENSEX") return 80000;
  return 57000;
}

function direction(
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY",
  dir: "UP" | "DOWN" = "UP",
  currentAt = T,
) {
  const currentMs = Date.parse(currentAt);
  const previousAt = new Date(currentMs - 5_000).toISOString();
  const base = basePrice(symbol);
  const current = dir === "UP" ? base * 1.001 : base * 0.999;
  return deriveH1ExactLiveSpotDirection(
    { source: "LIVE_RUNTIME_EXACT", symbol, price: base, observedAt: previousAt, receivedAt: previousAt },
    { source: "LIVE_RUNTIME_EXACT", symbol, price: current, observedAt: currentAt, receivedAt: currentAt },
    { maxObservationGapMs: 10_000, minAbsoluteSpotMovePct: 0.01 },
  );
}

test("PASS requires target plus both exact tracked peers aligned at the canonical decision timestamp", () => {
  const out = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP"), direction("SENSEX", "UP")],
  });
  assert.equal(out.ready, true);
  assert.equal(out.state, "PASS");
  assert.deepEqual(out.expectedPeerSymbols, ["BANKNIFTY", "SENSEX"]);
  assert.deepEqual(out.validatedPeerSymbols, ["BANKNIFTY", "SENSEX"]);
  assert.deepEqual(out.conflictingPeerSymbols, []);
  assert.equal(out.signal.state, "PASS");
  assert.equal(out.signal.source, H1_GOLD_PEER_CONFLICT_ABSENT_SOURCE);
  assert.equal(out.signal.snapshotId, "NIFTY-20260916-060000");
  assert.equal(out.signal.observedAt, T);
  assert.equal(out.signal.provenance, "LIVE_RUNTIME_EXACT");
  assert.equal(out.calculatesThresholds, false);
  assert.equal(out.usesConsensusVote, false);
  assert.equal(out.optionSideDirectionInferred, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("one explicit opposite peer proves peerConflictAbsent FAIL without a majority vote", () => {
  const out = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "DOWN"), direction("SENSEX", "UP")],
  });
  assert.equal(out.ready, true);
  assert.equal(out.state, "FAIL");
  assert.deepEqual(out.conflictingPeerSymbols, ["BANKNIFTY"]);
  assert.ok(out.blockers.includes("EXPLICIT_PEER_DIRECTION_CONFLICT:BANKNIFTY"));
  assert.equal(out.signal.state, "FAIL");
});

test("missing, duplicate or unexpected peer evidence never becomes PASS", () => {
  const missing = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY", side: "CE", observedAt: T, canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP")],
  });
  assert.equal(missing.state, "MISSING");
  assert.ok(missing.blockers.includes("SENSEX:PEER_DIRECTION_MISSING"));

  const duplicate = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY", side: "CE", observedAt: T, canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP"), direction("BANKNIFTY", "UP"), direction("SENSEX", "UP")],
  });
  assert.equal(duplicate.state, "MISSING");
  assert.ok(duplicate.blockers.includes("BANKNIFTY:PEER_DIRECTION_DUPLICATE"));

  const reusedTarget = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY", side: "CE", observedAt: T, canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP"), direction("NIFTY", "UP")],
  });
  assert.equal(reusedTarget.state, "MISSING");
  assert.ok(reusedTarget.blockers.includes("NIFTY:TARGET_DIRECTION_REUSED_AS_PEER"));
});

test("stale peer timestamp, wrong target identity and invalid canonical truth fail closed", () => {
  const staleAt = new Date(T_MS - 1_000).toISOString();
  const stale = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY", side: "CE", observedAt: T, canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP", staleAt), direction("SENSEX", "UP")],
  });
  assert.equal(stale.state, "MISSING");
  assert.ok(stale.blockers.includes("BANKNIFTY:NOT_EXACT_CANONICAL_DECISION_TIMESTAMP"));

  const wrongTarget = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY", side: "CE", observedAt: T, canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("SENSEX", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP"), direction("SENSEX", "UP")],
  });
  assert.equal(wrongTarget.state, "MISSING");
  assert.ok(wrongTarget.blockers.includes("NIFTY:DIRECTION_SYMBOL_MISMATCH"));

  const badRoot = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY", side: "CE", observedAt: T, canonicalSnapshot: snapshot("NIFTY", 1),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP"), direction("SENSEX", "UP")],
  });
  assert.equal(badRoot.state, "MISSING");
  assert.ok(badRoot.blockers.includes("CANONICAL_NOT_READY_FOR_STRICT_FILTERING"));
});

test("target direction must independently agree with option side; side never manufactures direction", () => {
  const out = buildH1GoldPeerConflictAbsent({
    symbol: "NIFTY",
    side: "PE",
    observedAt: T,
    canonicalSnapshot: snapshot(),
    targetDirectionSource: direction("NIFTY", "UP"),
    peerDirectionSources: [direction("BANKNIFTY", "UP"), direction("SENSEX", "UP")],
  });
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("TARGET_DIRECTION_CONFLICTS_WITH_SELECTED_OPTION_SIDE"));
  assert.equal(out.optionSideDirectionInferred, false);
});

test("SENSEX Gold target requires exact NIFTY and BANKNIFTY peers", () => {
  const out = buildH1GoldPeerConflictAbsent({
    symbol: "SENSEX",
    side: "PE",
    observedAt: T,
    canonicalSnapshot: snapshot("SENSEX"),
    targetDirectionSource: direction("SENSEX", "DOWN"),
    peerDirectionSources: [direction("NIFTY", "DOWN"), direction("BANKNIFTY", "DOWN")],
  });
  assert.equal(out.state, "PASS");
  assert.deepEqual(out.expectedPeerSymbols, ["NIFTY", "BANKNIFTY"]);
});
