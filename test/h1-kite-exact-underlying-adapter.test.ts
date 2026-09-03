import test from "node:test";
import assert from "node:assert/strict";
import { mapKiteIndexFullPacketToH1ExactUnderlying } from "../h1-kite-exact-underlying-adapter.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const registry = new KiteImmediateTokenRegistry([
  { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
  { instrumentToken: 999, symbol: "NIFTY", role: "FUTURE", instrumentLabel: "NIFTY FUT", expiry: "2026-09-29" },
]);

const packet: KiteDecodedPacket = {
  mode: "full",
  instrumentToken: 256265,
  lastPrice: 24025.5,
  exchangeTimestamp: "2026-09-03T10:00:00.000Z",
  isIndex: true,
};

test("maps exact fresh Kite SPOT index FULL packet", () => {
  const out = mapKiteIndexFullPacketToH1ExactUnderlying(packet, registry, "2026-09-03T10:00:00.500Z");
  assert.deepEqual(out, {
    source: "LIVE_RUNTIME_EXACT",
    symbol: "NIFTY",
    observedAt: "2026-09-03T10:00:00.000Z",
    receivedAt: "2026-09-03T10:00:00.500Z",
    price: 24025.5,
  });
});

test("blocks quote/non-index packets and unregistered tokens", () => {
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, mode: "quote" }, registry, "2026-09-03T10:00:00.500Z"), null);
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, isIndex: false }, registry, "2026-09-03T10:00:00.500Z"), null);
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, instrumentToken: 123 }, registry, "2026-09-03T10:00:00.500Z"), null);
});

test("blocks FUTURE identity instead of substituting it for spot", () => {
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, instrumentToken: 999 }, registry, "2026-09-03T10:00:00.500Z"), null);
});

test("blocks missing, future and stale exchange timestamps", () => {
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, exchangeTimestamp: null }, registry, "2026-09-03T10:00:00.500Z"), null);
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, exchangeTimestamp: "not-a-time" }, registry, "2026-09-03T10:00:00.500Z"), null);
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, exchangeTimestamp: "2026-09-03T10:00:01.000Z" }, registry, "2026-09-03T10:00:00.500Z"), null);
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, exchangeTimestamp: "2026-09-03T09:59:50.000Z" }, registry, "2026-09-03T10:00:00.500Z"), null);
});

test("blocks invalid price and freshness policy", () => {
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying({ ...packet, lastPrice: 0 }, registry, "2026-09-03T10:00:00.500Z"), null);
  assert.equal(mapKiteIndexFullPacketToH1ExactUnderlying(packet, registry, "2026-09-03T10:00:00.500Z", 0), null);
});
