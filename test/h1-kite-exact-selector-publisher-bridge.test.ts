import test from "node:test";
import assert from "node:assert/strict";
import { H1KiteExactSelectorPublisherBridge } from "../h1-kite-exact-selector-publisher-bridge.js";
import { clearH1LiveSelectorRegistry, getH1LiveSelectorRegistrySize } from "../h1-live-selector-registry.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const tokenRegistry = new KiteImmediateTokenRegistry([
  { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-100-CE", expiry: "2026-09-08", strike: 100, optionSide: "CE" },
]);

const publisher = {
  moneyness: "ATM" as const,
  multiExpiryPeers: [{ source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, side: "CE" as const, expiryDate: "2026-09-15", dte: 12, observedAt: "2026-09-03T10:00:05.000Z", directionalState: "SUPPORTS" as const }],
  premiumPolicy: { maxObservationGapMs: 10_000, minPremiumMovePct: 0, minAbsoluteDeltaChange: 0, minCurrentGamma: 0 },
  burdenPolicy: { maxObservationAgeMs: 30_000, maxAbsThetaPctOfPremium: 1_000, minIv: 0, maxIv: 500, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
  capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100_000, maxRelativeSpreadPct: 20, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
};

function packet(at: string, ltp: number, depth = true): KiteDecodedPacket {
  return {
    mode: "full", instrumentToken: 111, lastPrice: ltp, exchangeTimestamp: at, isIndex: false,
    marketDepth: depth ? { buy: [{ quantity: 300, price: ltp - 0.05, orders: 12 }], sell: [{ quantity: 300, price: ltp + 0.05, orders: 10 }] } : undefined,
  };
}

function input(at: string, ltp: number, depth = true, publisherFor = () => publisher) {
  const nowIso = new Date(Date.parse(at) + 500).toISOString();
  return {
    snapshot: {
      packet: packet(at, ltp, depth),
      registry: tokenRegistry,
      underlying: { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, observedAt: at, receivedAt: nowIso, price: 100 },
      receivedAt: nowIso, nowIso, orderQuantity: 150,
      greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 },
    },
    publisherFor,
  };
}

test("first ready exact snapshot becomes baseline but is not published", () => {
  clearH1LiveSelectorRegistry();
  const bridge = new H1KiteExactSelectorPublisherBridge();
  let calls = 0;
  const out = bridge.ingest(input("2026-09-03T10:00:00.000Z", 1.05, true, () => { calls += 1; return publisher; }));
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["PREVIOUS_EXACT_SNAPSHOT_UNAVAILABLE"]);
  assert.equal(calls, 0);
  assert.equal(bridge.getTrackedContractCount(), 1);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("forward same-contract exact snapshot publishes one registry packet", () => {
  clearH1LiveSelectorRegistry();
  const bridge = new H1KiteExactSelectorPublisherBridge();
  bridge.ingest(input("2026-09-03T10:00:00.000Z", 1.05));
  const out = bridge.ingest(input("2026-09-03T10:00:05.000Z", 1.20));
  assert.equal(out.ready, true);
  assert.equal(out.publication?.reason, "LIVE_GATE_PACKET_ACCEPTED");
  assert.equal(out.publisher?.producer?.packet?.identity.symbol, "NIFTY");
  assert.equal(getH1LiveSelectorRegistrySize(), 1);
});

test("invalid exact snapshot neither seeds state nor publishes", () => {
  clearH1LiveSelectorRegistry();
  const bridge = new H1KiteExactSelectorPublisherBridge();
  const out = bridge.ingest(input("2026-09-03T10:00:00.000Z", 1.05, false));
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("SNAPSHOT_MISSING_DEPTH_OBSERVATION"));
  assert.equal(bridge.getTrackedContractCount(), 0);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("duplicate or reverse timestamp cannot replace the latest baseline", () => {
  clearH1LiveSelectorRegistry();
  const bridge = new H1KiteExactSelectorPublisherBridge();
  bridge.ingest(input("2026-09-03T10:00:05.000Z", 1.20));
  const out = bridge.ingest(input("2026-09-03T10:00:04.000Z", 1.15));
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["NON_FORWARD_EXACT_SNAPSHOT_CHRONOLOGY"]);
  assert.equal(bridge.getTrackedContractCount(), 1);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("publisher rejection advances exact baseline but never publishes", () => {
  clearH1LiveSelectorRegistry();
  const bridge = new H1KiteExactSelectorPublisherBridge();
  bridge.ingest(input("2026-09-03T10:00:00.000Z", 1.05));
  const out = bridge.ingest(input("2026-09-03T10:00:05.000Z", 1.20, true, () => ({ ...publisher, multiExpiryPeers: [] })));
  assert.equal(out.ready, false);
  assert.ok(out.blockers.some((x) => x.includes("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS")));
  assert.equal(bridge.getTrackedContractCount(), 1);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("publisher context failure advances exact baseline but fails closed", () => {
  clearH1LiveSelectorRegistry();
  const bridge = new H1KiteExactSelectorPublisherBridge();
  bridge.ingest(input("2026-09-03T10:00:00.000Z", 1.05));
  const out = bridge.ingest(input("2026-09-03T10:00:05.000Z", 1.20, true, () => { throw new Error("peer unavailable"); }));
  assert.equal(out.ready, false);
  assert.deepEqual(out.blockers, ["PUBLISHER_CONTEXT_RESOLUTION_FAILED"]);
  assert.equal(bridge.getTrackedContractCount(), 1);
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});
