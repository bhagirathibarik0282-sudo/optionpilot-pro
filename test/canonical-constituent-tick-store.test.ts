import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalConstituentTickStore } from "../canonical-constituent-tick-store.js";

const registry = [
  { instrumentToken: 101, parentSymbol: "NIFTY" as const, role: "HEAVYWEIGHT" as const, tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" as const },
  { instrumentToken: 102, parentSymbol: "NIFTY" as const, role: "SECTOR_CONSTITUENT" as const, tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10, source: "KITE_INSTRUMENT_MASTER" as const },
  { instrumentToken: 201, parentSymbol: "SENSEX" as const, role: "HEAVYWEIGHT" as const, tradingsymbol: "ICICIBANK", sector: "BANK", weight: 8, source: "KITE_INSTRUMENT_MASTER" as const },
];

const receivedAt = "2026-09-05T10:00:00.100Z";
const processedAtMs = Date.parse("2026-09-05T10:00:00.120Z");
function packet(instrumentToken: number, exchangeTimestamp = "2026-09-05T10:00:00.000Z", lastPrice = 100) {
  return { mode: "full" as const, instrumentToken, exchangeTimestamp, lastPrice, isIndex: false };
}

test("records exact constituent packets with triple timestamps and monotonic sequence", () => {
  const store = new CanonicalConstituentTickStore(registry);
  assert.equal(store.ingest(packet(101), receivedAt, processedAtMs), true);
  assert.equal(store.ingest(packet(102), receivedAt, processedAtMs + 1), true);
  const ticks = store.ticks("NIFTY");
  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks.map((x) => x.ingestSeq), [1, 2]);
  assert.equal(ticks[0].exchangeTimestampMs, Date.parse("2026-09-05T10:00:00.000Z"));
  assert.equal(ticks[0].receivedAtMs, Date.parse(receivedAt));
  assert.equal(ticks[0].processedAtMs, processedAtMs);
  assert.equal(store.status("NIFTY").availableTokenCount, 2);
  assert.deepEqual(store.status("NIFTY").missingTokens, []);
});

test("fails closed for invalid, future, non-full and reverse-chronology packets", () => {
  const store = new CanonicalConstituentTickStore(registry);
  assert.equal(store.ingest(packet(101), receivedAt, processedAtMs), true);
  assert.equal(store.ingest(packet(101, "2026-09-05T09:59:59.000Z"), receivedAt, processedAtMs + 1), false);
  assert.equal(store.ingest(packet(102, "2026-09-05T10:00:01.000Z"), receivedAt, processedAtMs + 2), false);
  assert.equal(store.ingest({ ...packet(102), mode: "quote" as const }, receivedAt, processedAtMs + 3), false);
  assert.equal(store.ingest(packet(102, "2026-09-05T10:00:00.000Z", 0), receivedAt, processedAtMs + 4), false);
  assert.equal(store.status().rejectedPacketCount, 4);
  assert.deepEqual(store.status("NIFTY").missingTokens, [102]);
});

test("ignores unregistered packets without creating evidence or authority", () => {
  const store = new CanonicalConstituentTickStore(registry);
  assert.equal(store.ingest(packet(999), receivedAt, processedAtMs), false);
  const status = store.status();
  assert.equal(status.availableTokenCount, 0);
  assert.equal(status.rejectedPacketCount, 0);
  assert.equal(status.readOnly, true);
  assert.equal(status.forwardsDownstream, false);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsExecution, false);
  assert.equal(status.affectsTelegram, false);
  assert.equal(status.grantsCandidateAuthority, false);
  assert.equal(status.failClosed, true);
});

test("rejects empty or duplicate-token registries", () => {
  assert.throws(() => new CanonicalConstituentTickStore([]), /REGISTRY_REQUIRED/);
  assert.throws(() => new CanonicalConstituentTickStore([registry[0], { ...registry[0] }]), /TOKEN_DUPLICATE/);
});
