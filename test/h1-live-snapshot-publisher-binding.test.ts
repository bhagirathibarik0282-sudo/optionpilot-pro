import test from "node:test";
import assert from "node:assert/strict";
import { bindH1LiveExactSnapshotsToPublisher } from "../h1-live-snapshot-publisher-binding.js";
import type { H1ExactSnapshotBundle } from "../h1-live-exact-snapshot-aggregator.js";

function bundle(observedAt: string, ltp: number, expiryDate = "2026-09-10"): H1ExactSnapshotBundle {
  const identity = { symbol: "NIFTY" as const, expiryDate, strike: 24000, side: "CE" as const, dte: 7 };
  return {
    version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1", ready: true, identity, observedAt,
    priceGreek: { ...identity, source: "LIVE_RUNTIME_EXACT", observedAt, ltp, delta: observedAt.endsWith("00.000Z") ? 0.45 : 0.50, gamma: 0.02, theta: -2, iv: 15 },
    depth: { ...identity, source: "LIVE_RUNTIME_EXACT", observedAt, receivedAt: observedAt, bid: ltp - 1, ask: ltp + 1, bidQty: 500, askQty: 500, lotQuantity: 75 },
    blockers: [], failClosed: true, semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY",
  };
}

const policy = {
  premiumPolicy: { maxObservationGapMs: 10_000, minPremiumMovePct: 1, minAbsoluteDeltaChange: 0.01, minCurrentGamma: 0.01 },
  burdenPolicy: { maxObservationAgeMs: 30_000, maxAbsThetaPctOfPremium: 5, minIv: 5, maxIv: 40, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
  capitalLiquidityDtePolicy: { maxCapitalPerTrade: 20_000, maxRelativeSpreadPct: 5, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
};

const peer = [{ source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, side: "CE" as const, expiryDate: "2026-09-17", dte: 14, observedAt: "2026-09-03T10:00:05.000Z", directionalState: "SUPPORTS" as const }];

test("binds ready exact bundles into publisher packet", () => {
  const r = bindH1LiveExactSnapshotsToPublisher({ previous: bundle("2026-09-03T10:00:00.000Z", 100), current: bundle("2026-09-03T10:00:05.000Z", 103), moneyness: "ATM", multiExpiryPeers: peer, ...policy, nowIso: "2026-09-03T10:00:06.000Z" });
  assert.equal(r.ready, true);
  assert.equal(r.producer?.packet?.identity.symbol, "NIFTY");
});

test("blocks non-ready exact bundle", () => {
  const prev = bundle("2026-09-03T10:00:00.000Z", 100); prev.ready = false;
  const r = bindH1LiveExactSnapshotsToPublisher({ previous: prev, current: bundle("2026-09-03T10:00:05.000Z", 103), moneyness: "ATM", multiExpiryPeers: peer, ...policy, nowIso: "2026-09-03T10:00:06.000Z" });
  assert.equal(r.ready, false); assert.ok(r.blockers.includes("PREVIOUS_EXACT_BUNDLE_NOT_READY"));
});

test("blocks contract mismatch", () => {
  const r = bindH1LiveExactSnapshotsToPublisher({ previous: bundle("2026-09-03T10:00:00.000Z", 100), current: bundle("2026-09-03T10:00:05.000Z", 103, "2026-09-11"), moneyness: "ATM", multiExpiryPeers: peer, ...policy, nowIso: "2026-09-03T10:00:06.000Z" });
  assert.equal(r.ready, false); assert.ok(r.blockers.includes("PREVIOUS_CURRENT_CONTRACT_MISMATCH"));
});

test("blocks reverse chronology", () => {
  const r = bindH1LiveExactSnapshotsToPublisher({ previous: bundle("2026-09-03T10:00:05.000Z", 100), current: bundle("2026-09-03T10:00:00.000Z", 103), moneyness: "ATM", multiExpiryPeers: peer, ...policy, nowIso: "2026-09-03T10:00:06.000Z" });
  assert.equal(r.ready, false); assert.ok(r.blockers.includes("NON_FORWARD_EXACT_BUNDLE_CHRONOLOGY"));
});

test("propagates producer fail-closed rejection", () => {
  const r = bindH1LiveExactSnapshotsToPublisher({ previous: bundle("2026-09-03T10:00:00.000Z", 100), current: bundle("2026-09-03T10:00:05.000Z", 103), moneyness: "ATM", multiExpiryPeers: [], ...policy, nowIso: "2026-09-03T10:00:06.000Z" });
  assert.equal(r.ready, false); assert.ok(r.blockers.some((x) => x.includes("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS")));
});
