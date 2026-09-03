import test from "node:test";
import assert from "node:assert/strict";
import { mapKiteFullPacketToH1ExactPriceGreek } from "../h1-kite-exact-price-greek-adapter.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const registry = new KiteImmediateTokenRegistry([{ instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-100-CE", expiry: "2027-09-03", strike: 100, optionSide: "CE" }]);
const policy = { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 };
const underlying = { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, observedAt: "2026-09-03T10:00:00.000Z", receivedAt: "2026-09-03T10:00:00.200Z", price: 100 };
const packet: KiteDecodedPacket = { mode: "full", instrumentToken: 111, lastPrice: 10.450583572, exchangeTimestamp: "2026-09-03T10:00:00.000Z", isIndex: false };

test("recovers bounded Black-Scholes IV and Greeks from exact same-time evidence", () => {
  const out = mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", policy);
  assert.ok(out);
  assert.ok(Math.abs(out.iv - 20) < 0.01);
  assert.ok(Math.abs(out.delta - 0.63683) < 0.001);
  assert.ok(Math.abs(out.gamma - 0.01876) < 0.001);
  assert.ok(Math.abs(out.theta - (-0.01757)) < 0.001);
  assert.equal(out.dte, 365);
  assert.equal(out.source, "LIVE_RUNTIME_EXACT");
});

test("fails closed on stale, skewed or wrong-symbol underlying evidence", () => {
  assert.equal(mapKiteFullPacketToH1ExactPriceGreek(packet, registry, { ...underlying, observedAt: "2026-09-03T09:59:50.000Z" }, "2026-09-03T10:00:00.500Z", policy), null);
  assert.equal(mapKiteFullPacketToH1ExactPriceGreek(packet, registry, { ...underlying, symbol: "SENSEX" }, "2026-09-03T10:00:00.500Z", policy), null);
});

test("fails closed on quote packets, missing exchange time and invalid policy", () => {
  assert.equal(mapKiteFullPacketToH1ExactPriceGreek({ ...packet, mode: "quote" }, registry, underlying, "2026-09-03T10:00:00.500Z", policy), null);
  assert.equal(mapKiteFullPacketToH1ExactPriceGreek({ ...packet, exchangeTimestamp: null }, registry, underlying, "2026-09-03T10:00:00.500Z", policy), null);
  assert.equal(mapKiteFullPacketToH1ExactPriceGreek(packet, registry, underlying, "2026-09-03T10:00:00.500Z", { ...policy, maxAgeMs: 0 }), null);
});

test("fails closed when premium violates discounted no-arbitrage bounds", () => {
  assert.equal(mapKiteFullPacketToH1ExactPriceGreek({ ...packet, lastPrice: 1000 }, registry, underlying, "2026-09-03T10:00:00.500Z", policy), null);
});
