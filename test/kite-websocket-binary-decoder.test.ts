import test from "node:test";
import assert from "node:assert/strict";
import { decodeKiteBinaryFrame, decodeKitePacket } from "../kite-websocket-binary-decoder.js";

function packet(length: number, writes: Array<[number, number]>): Uint8Array {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of writes) view.setInt32(offset, value, false);
  return bytes;
}

function writeDepth(
  bytes: Uint8Array,
  index: number,
  quantity: number,
  pricePaise: number,
  orders: number,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = 64 + index * 12;
  view.setInt32(offset, quantity, false);
  view.setInt32(offset + 4, pricePaise, false);
  view.setUint16(offset + 8, orders, false);
}

function frame(...packets: Uint8Array[]): Uint8Array {
  const length = 2 + packets.reduce((n, p) => n + 2 + p.byteLength, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint16(0, packets.length, false);
  let offset = 2;
  for (const p of packets) {
    view.setUint16(offset, p.byteLength, false);
    offset += 2;
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

test("decodes ltp packet", () => {
  const p = packet(8, [[0, 256265], [4, 2408050]]);
  const d = decodeKitePacket(p);
  assert.equal(d.instrumentToken, 256265);
  assert.equal(d.lastPrice, 24080.5);
  assert.equal(d.mode, "ltp");
});

test("decodes index full packet with exchange timestamp", () => {
  const p = packet(32, [[0, 256265], [4, 2408050], [8, 2410000], [12, 2399000], [16, 2400000], [20, 2395000], [28, 1_700_000_000]]);
  const d = decodeKitePacket(p);
  assert.equal(d.isIndex, true);
  assert.equal(d.mode, "full");
  assert.equal(d.exchangeTimestamp, new Date(1_700_000_000_000).toISOString());
  assert.equal(d.marketDepth, undefined);
});

test("decodes tradable full packet OI fields", () => {
  const p = packet(184, [[0, 123456], [4, 13220], [48, 987654], [52, 999999], [56, 900000], [60, 1_700_000_000]]);
  const d = decodeKitePacket(p);
  assert.equal(d.lastPrice, 132.2);
  assert.equal(d.oi, 987654);
  assert.equal(d.oiDayHigh, 999999);
  assert.equal(d.oiDayLow, 900000);
});

test("decodes all five bid and five offer depth entries from tradable full packet", () => {
  const p = packet(184, [[0, 123456], [4, 13220], [60, 1_700_000_000]]);
  for (let i = 0; i < 5; i++) writeDepth(p, i, 100 + i, 13200 - i * 5, 10 + i);
  for (let i = 5; i < 10; i++) writeDepth(p, i, 200 + i, 13225 + (i - 5) * 5, 20 + i);

  const d = decodeKitePacket(p);
  assert.equal(d.marketDepth?.buy.length, 5);
  assert.equal(d.marketDepth?.sell.length, 5);
  assert.deepEqual(d.marketDepth?.buy[0], { quantity: 100, price: 132, orders: 10 });
  assert.deepEqual(d.marketDepth?.buy[4], { quantity: 104, price: 131.8, orders: 14 });
  assert.deepEqual(d.marketDepth?.sell[0], { quantity: 205, price: 132.25, orders: 25 });
  assert.deepEqual(d.marketDepth?.sell[4], { quantity: 209, price: 132.45, orders: 29 });
});

test("does not fabricate market depth for 44-byte quote packet", () => {
  const p = packet(44, [[0, 123456], [4, 13220]]);
  const d = decodeKitePacket(p);
  assert.equal(d.mode, "quote");
  assert.equal(d.marketDepth, undefined);
});

test("splits multiple packets and ignores heartbeat", () => {
  const a = packet(8, [[0, 1], [4, 10000]]);
  const b = packet(8, [[0, 2], [4, 20000]]);
  assert.equal(decodeKiteBinaryFrame(frame(a, b)).length, 2);
  assert.deepEqual(decodeKiteBinaryFrame(new Uint8Array([0])), []);
});

test("fails closed on truncated frame", () => {
  assert.throws(() => decodeKiteBinaryFrame(new Uint8Array([0, 1, 0, 8, 0, 0])), /TRUNCATED_KITE_PACKET/);
});
