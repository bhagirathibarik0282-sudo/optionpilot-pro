import test from "node:test";
import assert from "node:assert/strict";
import { produceH1LivePublisherPacket } from "../h1-live-publisher-packet-producer.js";

const identity = {
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 24000,
  expiryDate: "2026-09-08",
  dte: 5,
  moneyness: "ATM" as const,
  premiumLtp: 120,
  observedAt: "2026-09-03T10:00:10.000Z",
  source: "LIVE_CHAIN",
  provenance: "LIVE_RUNTIME_EXACT" as const,
};

function baseInput() {
  return {
    identity,
    previousPremiumSnapshot: { symbol: "NIFTY", expiry: "2026-09-08", strike: 24000, side: "CE" as const, observedAt: "2026-09-03T10:00:00.000Z", ltp: 100, delta: 0.45, gamma: 0.002, source: "LIVE_RUNTIME_EXACT" as const },
    currentPremiumSnapshot: { symbol: "NIFTY", expiry: "2026-09-08", strike: 24000, side: "CE" as const, observedAt: "2026-09-03T10:00:10.000Z", ltp: 120, delta: 0.55, gamma: 0.003, source: "LIVE_RUNTIME_EXACT" as const },
    premiumPolicy: { maxObservationGapMs: 60_000, minPremiumMovePct: 5, minAbsoluteDeltaChange: 0.05, minCurrentGamma: 0.001 },
    burdenSnapshot: { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, side: "CE" as const, strike: 24000, expiryDate: "2026-09-08", dte: 5, observedAt: "2026-09-03T10:00:10.000Z", premiumLtp: 120, theta: -2, iv: 16 },
    multiExpiryPeers: [
      { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, side: "CE" as const, expiryDate: "2026-09-15", dte: 12, observedAt: "2026-09-03T10:00:10.000Z", directionalState: "SUPPORTS" as const },
    ],
    burdenPolicy: { maxObservationAgeMs: 90_000, maxAbsThetaPctOfPremium: 5, minIv: 5, maxIv: 50, requiredPeerCount: 1, maxConflictingPeerCount: 0 },
    capitalLiquidityDteEvidence: { provenance: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, dte: 5, premiumLtp: 120, lotQuantity: 150, bid: 119, ask: 120, bidQty: 500, askQty: 500, occurredAt: "2026-09-03T10:00:10.000Z", receivedAt: "2026-09-03T10:00:11.000Z" },
    capitalLiquidityDtePolicy: { maxCapitalPerTrade: 20_000, maxRelativeSpreadPct: 2, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: true },
    nowIso: "2026-09-03T10:00:20.000Z",
  };
}

test("produces one exact weekly packet including fallback approval", () => {
  const out = produceH1LivePublisherPacket(baseInput());
  assert.equal(out.ready, true);
  assert.ok(out.packet);
  assert.equal(out.packet!.gates.premiumResponseConfirmed?.value, true);
  assert.equal(out.packet!.gates.deltaGammaResponseConfirmed?.value, true);
  assert.equal(out.packet!.gates.thetaIvBurdenAcceptable?.value, true);
  assert.equal(out.packet!.gates.multiExpiryConflictAbsent?.value, true);
  assert.equal(out.packet!.gates.fallbackDteApproved?.value, true);
  assert.equal(out.packet!.gates.higherDteUsable, undefined);
});

test("business gate false remains publishable evidence instead of disappearing", () => {
  const input = baseInput();
  input.capitalLiquidityDtePolicy.maxCapitalPerTrade = 10_000;
  const out = produceH1LivePublisherPacket(input);
  assert.equal(out.ready, true);
  assert.equal(out.packet!.gates.capitalFit?.value, false);
});

test("blocks cross-contract premium evidence", () => {
  const input = baseInput();
  input.currentPremiumSnapshot.strike = 24100;
  const out = produceH1LivePublisherPacket(input);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("PREMIUM_CONTRACT_IDENTITY_MISMATCH"));
});

test("blocks evaluator-unavailable premium evidence", () => {
  const input = baseInput();
  input.currentPremiumSnapshot.observedAt = input.previousPremiumSnapshot.observedAt;
  const out = produceH1LivePublisherPacket(input);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.some((x) => x.includes("NON_FORWARD_CHRONOLOGY")));
});

test("blocks insufficient exact multi-expiry peers", () => {
  const input = baseInput();
  input.multiExpiryPeers = [];
  const out = produceH1LivePublisherPacket(input);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.some((x) => x.includes("INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS")));
});

test("BANKNIFTY routes only higher-DTE gate", () => {
  const input = baseInput();
  input.identity = { ...identity, symbol: "BANKNIFTY", strike: 57000, expiryDate: "2026-09-29", dte: 26, premiumLtp: 200 };
  input.previousPremiumSnapshot = { ...input.previousPremiumSnapshot, symbol: "BANKNIFTY", strike: 57000, expiry: "2026-09-29", ltp: 180 };
  input.currentPremiumSnapshot = { ...input.currentPremiumSnapshot, symbol: "BANKNIFTY", strike: 57000, expiry: "2026-09-29", ltp: 200 };
  input.burdenSnapshot = { ...input.burdenSnapshot, symbol: "BANKNIFTY", strike: 57000, expiryDate: "2026-09-29", dte: 26, premiumLtp: 200 };
  input.multiExpiryPeers = [{ ...input.multiExpiryPeers[0], symbol: "BANKNIFTY", expiryDate: "2026-10-27", dte: 54 }];
  input.capitalLiquidityDteEvidence = { ...input.capitalLiquidityDteEvidence, symbol: "BANKNIFTY", dte: 26, premiumLtp: 200 };
  input.capitalLiquidityDtePolicy.maxCapitalPerTrade = 40_000;
  const out = produceH1LivePublisherPacket(input);
  assert.equal(out.ready, true);
  assert.equal(out.packet!.gates.higherDteUsable?.value, true);
  assert.equal(out.packet!.gates.currentOrNearExpiryUsable, undefined);
  assert.equal(out.packet!.gates.fallbackDteApproved, undefined);
});
