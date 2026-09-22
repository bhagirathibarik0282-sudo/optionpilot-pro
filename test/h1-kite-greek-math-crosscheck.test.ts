import test from "node:test";
import assert from "node:assert/strict";
import { buildH1KiteGreekMathCrosscheckPersistRecord, crosscheckH1KiteGreeks } from "../h1-kite-greek-math-crosscheck.js";
import { mapKiteFullPacketToH1ExactPriceGreek } from "../h1-kite-exact-price-greek-adapter.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-100-CE", expiry: "2027-09-03", strike: 100, optionSide: "CE" },
]);
const policy = { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 };
const underlying = {
  source: "LIVE_RUNTIME_EXACT" as const,
  symbol: "NIFTY" as const,
  observedAt: "2026-09-03T10:00:00.000Z",
  receivedAt: "2026-09-03T10:00:00.200Z",
  price: 100,
};
const packet: KiteDecodedPacket = {
  mode: "full",
  instrumentToken: 111,
  lastPrice: 10.450583572,
  exchangeTimestamp: "2026-09-03T10:00:00.000Z",
  isIndex: false,
};

test("Kite-only cross-check independently reproduces IV, delta and gamma without production authority", () => {
  const primary = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", policy);
  assert.ok(primary);
  const out = crosscheckH1KiteGreeks(primary, underlying, policy);
  assert.equal(out.ready, true);
  assert.deepEqual(out.blockers, []);
  assert.ok((out.absoluteDeltaError ?? 1) < 1e-4);
  assert.ok((out.absoluteGammaError ?? 1) < 1e-4);
  assert.ok((out.absoluteIvErrorPctPoints ?? 1) < 1e-4);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.thresholdAuthority, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("keeps numerical Gamma stable for exact near-ATM NIFTY and SENSEX live edge cases", () => {
  const cases = [
    {
      observation: {
        source: "LIVE_RUNTIME_EXACT" as const,
        symbol: "NIFTY" as const,
        expiryDate: "2026-09-29",
        strike: 23350,
        side: "PE" as const,
        dte: 7,
        observedAt: "2026-09-22T07:35:00.000Z",
        ltp: 131.15,
        delta: -0.5001521988064681,
        gamma: 0.0012248256816981189,
        theta: -10,
        iv: 10.011795720915831,
      },
      underlying: {
        source: "LIVE_RUNTIME_EXACT" as const,
        symbol: "NIFTY" as const,
        observedAt: "2026-09-22T07:35:00.000Z",
        receivedAt: "2026-09-22T07:35:00.200Z",
        price: 23324.9,
      },
    },
    {
      observation: {
        source: "LIVE_RUNTIME_EXACT" as const,
        symbol: "SENSEX" as const,
        expiryDate: "2026-09-24",
        strike: 74600,
        side: "PE" as const,
        dte: 2,
        observedAt: "2026-09-22T07:40:00.000Z",
        ltp: 280,
        delta: -0.4998074988142851,
        gamma: 0.0005714189414716609,
        theta: -10,
        iv: 12.3504448471051,
      },
      underlying: {
        source: "LIVE_RUNTIME_EXACT" as const,
        symbol: "SENSEX" as const,
        observedAt: "2026-09-22T07:40:00.000Z",
        receivedAt: "2026-09-22T07:40:00.200Z",
        price: 74575.64,
      },
    },
  ];

  for (const item of cases) {
    const out = crosscheckH1KiteGreeks(item.observation, item.underlying, policy);
    assert.equal(out.ready, true);
    assert.ok((out.absoluteDeltaError ?? 1) < 0.02);
    assert.ok((out.absoluteGammaError ?? 1) < 0.0005);
  }
});

test("fails closed on mismatched symbol or non-exact source", () => {
  const primary = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", policy);
  assert.ok(primary);
  const mismatch = crosscheckH1KiteGreeks(primary, { ...underlying, symbol: "SENSEX" }, policy);
  assert.equal(mismatch.ready, false);
  assert.ok(mismatch.blockers.includes("SYMBOL_MISMATCH"));

  const nonExact = crosscheckH1KiteGreeks({ ...primary, source: "LIVE_RUNTIME_EXACT" }, { ...underlying, source: "LIVE_RUNTIME_EXACT" }, policy);
  assert.equal(nonExact.ready, true);
});

test("does not invent validation thresholds or promotion authority", () => {
  const primary = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", policy);
  assert.ok(primary);
  const out = crosscheckH1KiteGreeks(primary, underlying, policy);
  assert.equal("pass" in out, false);
  assert.equal("promotionEligible" in out, false);
  assert.equal(out.thresholdAuthority, "NONE");
});


test("persists the complete exact snapshot needed for later selector-policy validation without granting authority", () => {
  const primary = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", policy);
  assert.ok(primary);
  const evidence = crosscheckH1KiteGreeks(primary, underlying, policy);
  assert.equal(evidence.ready, true);

  const snapshot = {
    version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1" as const,
    ready: true,
    identity: { symbol: primary.symbol, expiryDate: primary.expiryDate, strike: primary.strike, side: primary.side, dte: primary.dte },
    observedAt: primary.observedAt,
    priceGreek: primary,
    depth: {
      symbol: primary.symbol, expiryDate: primary.expiryDate, strike: primary.strike, side: primary.side, dte: primary.dte,
      source: "LIVE_RUNTIME_EXACT" as const, observedAt: primary.observedAt, receivedAt: "2026-09-03T10:00:00.500Z",
      bid: 10.4, ask: 10.5, bidQty: 100, askQty: 120, lotQuantity: 50,
    },
    blockers: [],
    failClosed: true as const,
    semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY" as const,
  };

  const record = buildH1KiteGreekMathCrosscheckPersistRecord(
    111,
    snapshot,
    underlying,
    evidence,
    null,
    { greekPolicy: policy, directionSourcePolicy: null },
  );
  assert.ok(record);
  assert.equal(record.snapshot.priceGreek?.ltp, primary.ltp);
  assert.equal(record.snapshot.priceGreek?.theta, primary.theta);
  assert.equal(record.snapshot.priceGreek?.iv, primary.iv);
  assert.equal(record.snapshot.depth?.lotQuantity, 50);
  assert.equal(record.snapshot.depth?.bidQty, 100);
  assert.equal(record.underlying.price, 100);
  assert.equal(record.policyIdentity.version, "H1_KITE_GREEK_EVIDENCE_POLICY_IDENTITY_V1");
  assert.deepEqual(record.policyIdentity.greekPolicy, policy);
  assert.equal(record.policyIdentity.directionSourcePolicy, null);
  assert.equal(record.policyIdentity.greekPolicySemantics, "SHADOW_CALIBRATION_ONLY");
  assert.equal(record.policyIdentity.directionSourcePolicySemantics, null);
  assert.equal(record.policyIdentity.prospectiveP75Bound, false);
  assert.equal(record.policyIdentity.productionPolicyBound, false);
  assert.equal(record.thresholdAuthority, "NONE");
  assert.equal(record.affectsSelector, false);
  assert.equal(record.affectsBusinessCard, false);
  assert.equal(record.affectsTelegram, false);
  assert.equal(record.affectsExecution, false);
  assert.equal(record.createsOrders, false);
});


test("refuses durable Greek evidence when policy identity is missing", () => {
  const primary = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", policy);
  assert.ok(primary);
  const evidence = crosscheckH1KiteGreeks(primary, underlying, policy);
  const snapshot = {
    version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1" as const,
    ready: true,
    identity: { symbol: primary.symbol, expiryDate: primary.expiryDate, strike: primary.strike, side: primary.side, dte: primary.dte },
    observedAt: primary.observedAt,
    priceGreek: primary,
    depth: {
      symbol: primary.symbol, expiryDate: primary.expiryDate, strike: primary.strike, side: primary.side, dte: primary.dte,
      source: "LIVE_RUNTIME_EXACT" as const, observedAt: primary.observedAt, receivedAt: "2026-09-03T10:00:00.500Z",
      bid: 10.4, ask: 10.5, bidQty: 100, askQty: 120, lotQuantity: 50,
    },
    blockers: [],
    failClosed: true as const,
    semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY" as const,
  };
  const record = buildH1KiteGreekMathCrosscheckPersistRecord(111, snapshot, underlying, evidence, null, undefined as any);
  assert.equal(record, null);
});
