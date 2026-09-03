import test from "node:test";
import assert from "node:assert/strict";
import { H1KiteExactRuntimeCoordinator } from "../h1-kite-exact-runtime-coordinator.js";
import { clearH1LiveSelectorRegistry, getH1LiveSelectorRegistrySize } from "../h1-live-selector-registry.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 10, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY-SPOT" },
  { instrumentToken: 11, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-100-CE", expiry: "2026-09-08", strike: 100, optionSide: "CE" },
  { instrumentToken: 12, symbol: "NIFTY", role: "FUTURE", instrumentLabel: "NIFTY-FUT" },
]);

function indexPacket(at: string, price = 100): KiteDecodedPacket {
  return { mode: "full", instrumentToken: 10, lastPrice: price, exchangeTimestamp: at, isIndex: true };
}

function optionPacket(at: string, ltp: number): KiteDecodedPacket {
  return {
    mode: "full", instrumentToken: 11, lastPrice: ltp, exchangeTimestamp: at, isIndex: false,
    marketDepth: {
      buy: [{ quantity: 300, price: ltp - 0.05, orders: 12 }],
      sell: [{ quantity: 300, price: ltp + 0.05, orders: 10 }],
    },
  };
}

function coordinator() {
  return new H1KiteExactRuntimeCoordinator({
    registry,
    orderQuantityFor: () => 150,
    greekPolicy: { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 },
    publisherFor: (_entry, observedAt) => ({
      moneyness: "ATM",
      multiExpiryPeers: [{ source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", side: "CE", expiryDate: "2026-09-15", dte: 12, observedAt, directionalState: "SUPPORTS" }],
      premiumPolicy: { maxObservationGapMs: 10_000, minPremiumMovePct: 0, minAbsoluteDeltaChange: 0, minCurrentGamma: 0 },
      burdenPolicy: { maxObservationAgeMs: 30_000, maxAbsThetaPctOfPremium: 1_000, minIv: 0, maxIv: 500, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
      capitalLiquidityDtePolicy: { maxCapitalPerTrade: 100_000, maxRelativeSpreadPct: 20, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
    }),
  });
}

test("fresh exact SPOT packet becomes the same-symbol underlying", () => {
  const runtime = coordinator();
  const out = runtime.ingest(indexPacket("2026-09-03T10:00:00.000Z"), "2026-09-03T10:00:00.500Z");
  assert.equal(out.ready, true);
  assert.equal(out.action, "UNDERLYING_CACHED");
  assert.equal(runtime.getCachedUnderlyingCount(), 1);
});

test("option packet fails closed before an exact same-symbol underlying exists", () => {
  const runtime = coordinator();
  const out = runtime.ingest(optionPacket("2026-09-03T10:00:00.000Z", 1.05), "2026-09-03T10:00:00.500Z");
  assert.equal(out.ready, false);
  assert.equal(out.blocker, "SAME_SYMBOL_EXACT_UNDERLYING_UNAVAILABLE");
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});

test("two forward exact option packets progress baseline then publish", () => {
  clearH1LiveSelectorRegistry();
  const runtime = coordinator();
  runtime.ingest(indexPacket("2026-09-03T10:00:00.000Z"), "2026-09-03T10:00:00.500Z");
  const first = runtime.ingest(optionPacket("2026-09-03T10:00:00.000Z", 1.05), "2026-09-03T10:00:00.500Z");
  assert.equal(first.ready, false);
  assert.ok(first.blocker?.includes("PREVIOUS_EXACT_SNAPSHOT_UNAVAILABLE"));

  runtime.ingest(indexPacket("2026-09-03T10:00:05.000Z"), "2026-09-03T10:00:05.500Z");
  const second = runtime.ingest(optionPacket("2026-09-03T10:00:05.000Z", 1.20), "2026-09-03T10:00:05.500Z");
  assert.equal(second.ready, true);
  assert.equal(second.bridge?.publication?.reason, "LIVE_GATE_PACKET_ACCEPTED");
  assert.equal(getH1LiveSelectorRegistrySize(), 1);
});

test("reverse SPOT chronology cannot replace the cached underlying", () => {
  const runtime = coordinator();
  runtime.ingest(indexPacket("2026-09-03T10:00:05.000Z"), "2026-09-03T10:00:05.500Z");
  const out = runtime.ingest(indexPacket("2026-09-03T10:00:04.000Z"), "2026-09-03T10:00:05.500Z");
  assert.equal(out.ready, false);
  assert.equal(out.blocker, "NON_FORWARD_EXACT_UNDERLYING_CHRONOLOGY");
  assert.equal(runtime.getCachedUnderlyingCount(), 1);
});

test("unregistered and non-H1 roles are ignored without publication", () => {
  clearH1LiveSelectorRegistry();
  const runtime = coordinator();
  const unknown = runtime.ingest({ ...optionPacket("2026-09-03T10:00:00.000Z", 1.05), instrumentToken: 999 }, "2026-09-03T10:00:00.500Z");
  const future = runtime.ingest({ mode: "full", instrumentToken: 12, lastPrice: 101, exchangeTimestamp: "2026-09-03T10:00:00.000Z", isIndex: false }, "2026-09-03T10:00:00.500Z");
  assert.equal(unknown.blocker, "UNREGISTERED_INSTRUMENT_TOKEN");
  assert.equal(future.blocker, "NON_H1_EXACT_INSTRUMENT_ROLE");
  assert.equal(getH1LiveSelectorRegistrySize(), 0);
});
