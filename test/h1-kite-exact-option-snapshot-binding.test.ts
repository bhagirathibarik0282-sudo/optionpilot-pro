import test from "node:test";
import assert from "node:assert/strict";
import { bindKiteOptionPacketToH1ExactSnapshot } from "../h1-kite-exact-option-snapshot-binding.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 111, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-100-CE", expiry: "2027-09-03", strike: 100, optionSide: "CE" },
]);
const policy = { annualRiskFreeRate: 0.05, annualDividendYield: 0, maxAgeMs: 5_000, maxUnderlyingSkewMs: 2_000 };
const underlying = { source: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, observedAt: "2026-09-03T10:00:00.000Z", receivedAt: "2026-09-03T10:00:00.200Z", price: 100 };
const packet: KiteDecodedPacket = {
  mode: "full",
  instrumentToken: 111,
  lastPrice: 10.450583572,
  exchangeTimestamp: "2026-09-03T10:00:00.000Z",
  isIndex: false,
  marketDepth: {
    buy: [{ quantity: 300, price: 10.4, orders: 12 }],
    sell: [{ quantity: 250, price: 10.5, orders: 10 }],
  },
};

function bind(overrides: Partial<Parameters<typeof bindKiteOptionPacketToH1ExactSnapshot>[0]> = {}) {
  return bindKiteOptionPacketToH1ExactSnapshot({
    packet,
    registry,
    underlying,
    receivedAt: "2026-09-03T10:00:00.500Z",
    nowIso: "2026-09-03T10:00:00.500Z",
    orderQuantity: 150,
    greekPolicy: policy,
    ...overrides,
  });
}

test("builds one ready same-contract exact snapshot bundle", () => {
  const out = bind();
  assert.equal(out.ready, true);
  assert.deepEqual(out.identity, { symbol: "NIFTY", expiryDate: "2027-09-03", strike: 100, side: "CE", dte: 365 });
  assert.equal(out.priceGreek?.source, "LIVE_RUNTIME_EXACT");
  assert.equal(out.depth?.source, "LIVE_RUNTIME_EXACT");
  assert.equal(out.depth?.lotQuantity, 150);
  assert.ok(Math.abs((out.priceGreek?.iv ?? 0) - 20) < 0.01);
});

test("fails closed when exact market depth is absent", () => {
  const out = bind({ packet: { ...packet, marketDepth: undefined } });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("MISSING_DEPTH_OBSERVATION"));
});

test("fails closed when underlying identity does not match option identity", () => {
  const out = bind({ underlying: { ...underlying, symbol: "SENSEX" } });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("MISSING_PRICE_GREEK_OBSERVATION"));
});

test("fails closed when otherwise exact evidence is stale at aggregation time", () => {
  const out = bind({ nowIso: "2026-09-03T10:00:10.000Z" });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("STALE_EVIDENCE"));
});

test("fails closed on invalid order quantity without weakening price/Greek validation", () => {
  const out = bind({ orderQuantity: 0 });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("MISSING_DEPTH_OBSERVATION"));
});
