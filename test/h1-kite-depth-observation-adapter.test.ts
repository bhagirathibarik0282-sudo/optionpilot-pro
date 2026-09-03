import test from "node:test";
import assert from "node:assert/strict";
import { adaptKiteFullPacketToH1DepthObservation } from "../h1-kite-depth-observation-adapter.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

function fullPacket(): KiteDecodedPacket {
  return {
    mode: "full",
    instrumentToken: 12345,
    lastPrice: 100,
    exchangeTimestamp: "2026-09-03T10:00:00.000Z",
    marketDepth: {
      buy: [{ price: 99.9, quantity: 200, orders: 2 }],
      sell: [{ price: 100.1, quantity: 150, orders: 3 }],
    },
    isIndex: false,
  };
}

const identity = { symbol: "NIFTY" as const, expiryDate: "2026-09-10", strike: 24000, side: "CE" as const, dte: 7 };

function adapt(packet = fullPacket()) {
  return adaptKiteFullPacketToH1DepthObservation({
    packet,
    expectedInstrumentToken: 12345,
    identity,
    lotQuantity: 75,
    receivedAt: "2026-09-03T10:00:00.100Z",
  });
}

test("creates exact top-of-book depth observation from matching full option packet", () => {
  const result = adapt();
  assert.equal(result.ready, true);
  assert.equal(result.observation?.source, "LIVE_RUNTIME_EXACT");
  assert.equal(result.observation?.bid, 99.9);
  assert.equal(result.observation?.ask, 100.1);
  assert.equal(result.observation?.bidQty, 200);
  assert.equal(result.observation?.askQty, 150);
  assert.deepEqual(result.blockers, []);
});

test("fails closed on token mismatch", () => {
  const packet = fullPacket();
  packet.instrumentToken = 99999;
  const result = adapt(packet);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("INSTRUMENT_TOKEN_MISMATCH"));
  assert.equal(result.observation, null);
});

test("fails closed when exact exchange timestamp is absent", () => {
  const packet = fullPacket();
  packet.exchangeTimestamp = null;
  const result = adapt(packet);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("MISSING_EXACT_EXCHANGE_TIMESTAMP"));
});

test("fails closed for quote packets without full depth", () => {
  const packet = fullPacket();
  packet.mode = "quote";
  packet.marketDepth = undefined;
  const result = adapt(packet);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("KITE_FULL_OPTION_PACKET_REQUIRED"));
  assert.ok(result.blockers.includes("MISSING_MARKET_DEPTH"));
});

test("fails closed on crossed or locked book", () => {
  const packet = fullPacket();
  packet.marketDepth!.sell[0].price = 99.9;
  const result = adapt(packet);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("NON_POSITIVE_SPREAD"));
});

test("fails closed when receive time predates exchange observation", () => {
  const result = adaptKiteFullPacketToH1DepthObservation({
    packet: fullPacket(),
    expectedInstrumentToken: 12345,
    identity,
    lotQuantity: 75,
    receivedAt: "2026-09-03T09:59:59.999Z",
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("RECEIVED_BEFORE_EXCHANGE_TIMESTAMP"));
});
