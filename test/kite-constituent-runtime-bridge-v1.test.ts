import test from "node:test";
import assert from "node:assert/strict";
import { KiteConstituentRuntimeBridgeV1 } from "../kite-constituent-runtime-bridge-v1.js";
import type { CanonicalConstituentTokenEntry } from "../canonical-constituent-token-registry.js";

const registry: CanonicalConstituentTokenEntry[] = [
  { instrumentToken: 101, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "FINANCIAL SERVICES", weight: 11, source: "KITE_INSTRUMENT_MASTER" },
  { instrumentToken: 202, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "OIL GAS & CONSUMABLE FUELS", weight: 9, source: "KITE_INSTRUMENT_MASTER" },
];

function tick(instrumentToken: number, exchangeTimestampMs: number, ltp = 100) {
  return { instrumentToken, exchangeTimestampMs, receivedAtMs: exchangeTimestampMs + 10, ltp };
}

test("accepts only exact authorized registry tokens and preserves provenance fields", () => {
  const bridge = new KiteConstituentRuntimeBridgeV1(registry);
  const t = 1_800_000_000_000;
  assert.deepEqual(bridge.publishTick(tick(101, t), t + 20), { accepted: true, reason: "CONSTITUENT_TICK_ACCEPTED" });
  assert.deepEqual(bridge.publishTick(tick(999, t + 1), t + 30), { accepted: false, reason: "UNAUTHORIZED_CONSTITUENT_TOKEN" });
  const latest = bridge.getLatestTicks();
  assert.equal(latest.length, 1);
  assert.equal(latest[0].instrumentToken, 101);
  assert.equal(latest[0].exchangeTimestampMs, t);
  assert.equal(latest[0].receivedAtMs, t + 10);
  assert.equal(latest[0].processedAtMs, t + 20);
  assert.equal(latest[0].ingestSeq, 1);
});

test("fails closed for duplicate, out-of-order and invalid timestamp-order ticks", () => {
  const bridge = new KiteConstituentRuntimeBridgeV1(registry);
  const t = 1_800_000_000_000;
  assert.equal(bridge.publishTick(tick(101, t), t + 20).accepted, true);
  assert.equal(bridge.publishTick(tick(101, t), t + 21).reason, "DUPLICATE_CONSTITUENT_TICK");
  assert.equal(bridge.publishTick(tick(101, t - 1), t + 22).reason, "OUT_OF_ORDER_CONSTITUENT_TICK");
  assert.equal(bridge.publishTick({ instrumentToken: 202, exchangeTimestampMs: t + 100, receivedAtMs: t + 99, ltp: 100 }, t + 110).reason, "INVALID_CONSTITUENT_TIMESTAMP_ORDER");
});

test("closed minute is immutable and later ticks for that minute are rejected", () => {
  const bridge = new KiteConstituentRuntimeBridgeV1(registry);
  const minute = 1_800_000_000_000;
  assert.equal(minute % 60_000, 0);
  bridge.publishTick(tick(101, minute + 5_000, 101), minute + 5_020);
  bridge.publishTick(tick(202, minute + 20_000, 202), minute + 20_020);
  const first = bridge.closeMinute(minute, minute + 60_000);
  assert.equal(first.immutable, true);
  assert.equal(first.ticks.length, 2);
  assert.equal(bridge.publishTick(tick(101, minute + 50_000, 110), minute + 61_000).reason, "CLOSED_MINUTE_IMMUTABLE");
  const second = bridge.closeMinute(minute, minute + 120_000);
  assert.deepEqual(second, first);
});

test("audit proves bridge has no socket, direction, candidate, Telegram or execution authority", () => {
  const bridge = new KiteConstituentRuntimeBridgeV1(registry);
  const audit = bridge.audit();
  assert.equal(audit.readOnly, true);
  assert.equal(audit.opensSocket, false);
  assert.equal(audit.infersMembership, false);
  assert.equal(audit.calculatesDirection, false);
  assert.equal(audit.ranksCandidates, false);
  assert.equal(audit.affectsVerdict, false);
  assert.equal(audit.affectsTelegram, false);
  assert.equal(audit.affectsExecution, false);
  assert.equal(audit.createsOrders, false);
  assert.equal(audit.failClosed, true);
});
