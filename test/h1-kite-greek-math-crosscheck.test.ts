import test from "node:test";
import assert from "node:assert/strict";
import { crosscheckH1KiteGreeks } from "../h1-kite-greek-math-crosscheck.js";
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
