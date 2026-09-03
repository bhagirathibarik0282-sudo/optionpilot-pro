import test from "node:test";
import assert from "node:assert/strict";
import { mapKiteFullPacketToH1ExactDepth } from "../h1-kite-exact-depth-adapter.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const registry = new KiteImmediateTokenRegistry([
  {
    instrumentToken: 111,
    symbol: "NIFTY",
    role: "OPTION",
    instrumentLabel: "NIFTY-TEST-CE",
    expiry: "2026-09-08",
    strike: 24000,
    optionSide: "CE",
  },
  {
    instrumentToken: 222,
    symbol: "NIFTY",
    role: "FUTURE",
    instrumentLabel: "NIFTY-FUT",
    expiry: "2026-09-24",
  },
]);

function fullPacket(overrides: Partial<KiteDecodedPacket> = {}): KiteDecodedPacket {
  return {
    mode: "full",
    instrumentToken: 111,
    lastPrice: 120,
    exchangeTimestamp: "2026-09-03T10:00:00.000Z",
    isIndex: false,
    marketDepth: {
      buy: [{ quantity: 300, price: 119.5, orders: 12 }],
      sell: [{ quantity: 250, price: 120.5, orders: 10 }],
    },
    ...overrides,
  };
}

test("maps exact FULL OPTION depth with canonical identity and total order quantity", () => {
  const out = mapKiteFullPacketToH1ExactDepth(
    fullPacket(),
    registry,
    "2026-09-03T10:00:00.500Z",
    150,
  );

  assert.ok(out);
  assert.equal(out.source, "LIVE_RUNTIME_EXACT");
  assert.equal(out.symbol, "NIFTY");
  assert.equal(out.expiryDate, "2026-09-08");
  assert.equal(out.strike, 24000);
  assert.equal(out.side, "CE");
  assert.equal(out.dte, 5);
  assert.equal(out.bid, 119.5);
  assert.equal(out.ask, 120.5);
  assert.equal(out.bidQty, 300);
  assert.equal(out.askQty, 250);
  assert.equal(out.lotQuantity, 150);
});

test("DTE uses India trade date at UTC-to-IST midnight boundary", () => {
  const out = mapKiteFullPacketToH1ExactDepth(
    fullPacket({ exchangeTimestamp: "2026-09-03T19:00:00.000Z" }),
    registry,
    "2026-09-03T19:00:00.500Z",
    75,
  );
  assert.ok(out);
  assert.equal(out.dte, 4);
});

test("blocks non-full and index packets", () => {
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ mode: "quote" }), registry, "2026-09-03T10:00:00.500Z", 75), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ isIndex: true }), registry, "2026-09-03T10:00:00.500Z", 75), null);
});

test("blocks missing depth and invalid executable top of book", () => {
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ marketDepth: undefined }), registry, "2026-09-03T10:00:00.500Z", 75), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ marketDepth: { buy: [{ quantity: 10, price: 0, orders: 1 }], sell: [{ quantity: 10, price: 1, orders: 1 }] } }), registry, "2026-09-03T10:00:00.500Z", 75), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ marketDepth: { buy: [{ quantity: 10, price: 121, orders: 1 }], sell: [{ quantity: 10, price: 120, orders: 1 }] } }), registry, "2026-09-03T10:00:00.500Z", 75), null);
});

test("allows exact zero depth quantity as evidence; downstream liquidity gate decides usability", () => {
  const out = mapKiteFullPacketToH1ExactDepth(
    fullPacket({ marketDepth: { buy: [{ quantity: 0, price: 119.5, orders: 0 }], sell: [{ quantity: 0, price: 120.5, orders: 0 }] } }),
    registry,
    "2026-09-03T10:00:00.500Z",
    75,
  );
  assert.ok(out);
  assert.equal(out.bidQty, 0);
  assert.equal(out.askQty, 0);
});

test("blocks unknown token and non-option registry identity", () => {
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ instrumentToken: 999 }), registry, "2026-09-03T10:00:00.500Z", 75), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ instrumentToken: 222 }), registry, "2026-09-03T10:00:00.500Z", 75), null);
});

test("blocks missing/invalid/future exchange timestamp without backend substitution", () => {
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ exchangeTimestamp: null }), registry, "2026-09-03T10:00:00.500Z", 75), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ exchangeTimestamp: "not-a-date" }), registry, "2026-09-03T10:00:00.500Z", 75), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket({ exchangeTimestamp: "2026-09-03T10:00:01.000Z" }), registry, "2026-09-03T10:00:00.500Z", 75), null);
});

test("blocks invalid order quantity", () => {
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket(), registry, "2026-09-03T10:00:00.500Z", 0), null);
  assert.equal(mapKiteFullPacketToH1ExactDepth(fullPacket(), registry, "2026-09-03T10:00:00.500Z", 1.5), null);
});
