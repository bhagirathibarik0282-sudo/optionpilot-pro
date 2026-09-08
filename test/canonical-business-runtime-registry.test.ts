import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalBuyerCandidatePacket } from "../canonical-buyer-candidate-packet.ts";
import { consumeCanonicalBusinessPacket } from "../canonical-business-consumer.ts";
import { CanonicalBusinessRuntimeRegistry } from "../canonical-business-runtime-registry.ts";

const candidate = {
  symbol: "NIFTY" as const,
  side: "CE" as const,
  strike: 25000,
  expiryDate: "2026-09-08",
  dte: 2,
  moneyness: "ATM" as const,
  premiumLtp: 150,
  capitalFit: true,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
};

function buildConsumer() {
  const packet = buildCanonicalBuyerCandidatePacket(candidate).packet;
  assert.ok(packet);
  return consumeCanonicalBusinessPacket({
    packet,
    telegramQualityStars: 5,
    horizons: [
      { horizon: "INTRADAY", buyerScore: 85, sellerScore: 30, evidenceReady: true },
      { horizon: "MULTIDAY", buyerScore: 75, sellerScore: 45, evidenceReady: true },
      { horizon: "EXPIRY", buyerScore: 80, sellerScore: 35, evidenceReady: true },
    ],
  });
}

test("missing and stale runtime state fail closed", () => {
  const now = 1_000_000;
  const registry = new CanonicalBusinessRuntimeRegistry(60_000, () => now);
  assert.equal(registry.read("NIFTY"), null);
  const consumer = buildConsumer();
  assert.equal(registry.publish("NIFTY", consumer, now - 60_001), true);
  assert.equal(registry.read("NIFTY"), null);
});

test("fresh canonical consumer is readable with symbol normalization", () => {
  const now = 1_000_000;
  const registry = new CanonicalBusinessRuntimeRegistry(60_000, () => now);
  const consumer = buildConsumer();
  assert.equal(registry.publish("nifty", consumer, now), true);
  assert.equal(registry.read("NIFTY")?.candidateKey, consumer.candidateKey);
});

test("registry rejects mismatched symbol and candidate identity", () => {
  const now = 1_000_000;
  const registry = new CanonicalBusinessRuntimeRegistry(60_000, () => now);
  const consumer = buildConsumer();
  assert.equal(registry.publish("SENSEX", consumer, now), false);
  const broken = {
    ...consumer,
    buyerCandidate: consumer.buyerCandidate ? { ...consumer.buyerCandidate, candidateKey: "BROKEN" } : null,
  };
  assert.equal(registry.publish("NIFTY", broken, now), false);
});

test("registry rejects forged authority, role, key shape, and incomplete horizons", () => {
  const now = 1_000_000;
  const registry = new CanonicalBusinessRuntimeRegistry(60_000, () => now);
  const consumer = buildConsumer();
  assert.equal(registry.publish("NIFTY", {
    ...consumer,
    buyerCandidate: { ...consumer.buyerCandidate!, sourceAuthority: "OTHER" as never },
  }, now), false);
  assert.equal(registry.publish("NIFTY", {
    ...consumer,
    buyerCandidate: { ...consumer.buyerCandidate!, role: "OPTION_SELLER" as never },
  }, now), false);
  assert.equal(registry.publish("NIFTY", {
    ...consumer,
    candidateKey: "NIFTY:CE:25000:FORGED",
    buyerCandidate: { ...consumer.buyerCandidate!, candidateKey: "NIFTY:CE:25000:FORGED" },
  }, now), false);
  assert.equal(registry.publish("NIFTY", { ...consumer, horizons: consumer.horizons.slice(0, 2) }, now), false);
  assert.equal(registry.publish("NIFTY", { ...consumer, horizons: undefined as never }, now), false);
});

test("registry rejects any downstream authority escalation", () => {
  const now = 1_000_000;
  const registry = new CanonicalBusinessRuntimeRegistry(60_000, () => now);
  const consumer = buildConsumer();
  assert.equal(registry.publish("NIFTY", { ...consumer, affectsExecution: true as never }, now), false);
  assert.equal(registry.publish("NIFTY", { ...consumer, createsOrders: true as never }, now), false);
  assert.equal(registry.publish("NIFTY", { ...consumer, aiMayOverride: true as never }, now), false);
});

test("clear removes runtime authority", () => {
  const now = 1_000_000;
  const registry = new CanonicalBusinessRuntimeRegistry(60_000, () => now);
  const consumer = buildConsumer();
  assert.equal(registry.publish("NIFTY", consumer, now), true);
  registry.clear("NIFTY");
  assert.equal(registry.read("NIFTY"), null);
});
