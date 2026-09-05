import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalConstituentLiveComponent } from "../canonical-constituent-live-component.ts";
import type { CanonicalConstituentTokenEntry } from "../canonical-constituent-token-registry.ts";

const registry: CanonicalConstituentTokenEntry[] = [
  { instrumentToken: 101, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 9, source: "KITE_INSTRUMENT_MASTER" },
  { instrumentToken: 102, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANKING", weight: 12, source: "KITE_INSTRUMENT_MASTER" },
  { instrumentToken: 201, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "SBIN", sector: "BANKING", weight: 4, source: "KITE_INSTRUMENT_MASTER" },
];

const tick = (instrumentToken: number, exchangeTimestampMs = 9_950) => ({
  instrumentToken,
  exchangeTimestampMs,
  receivedAtMs: exchangeTimestampMs + 5,
  processedAtMs: exchangeTimestampMs + 10,
  ingestSeq: instrumentToken,
  ltp: 100 + instrumentToken,
});

test("all expected heavyweight ticks create one verified HEAVYWEIGHTS component", () => {
  const out = buildCanonicalConstituentLiveComponent({
    parentSymbol: "NIFTY",
    role: "HEAVYWEIGHT",
    registry,
    ticks: [tick(101), tick(102)],
    asOfMs: 10_000,
    maxTickAgeMs: 100,
  });
  assert.equal(out.family, "HEAVYWEIGHTS");
  assert.equal(out.status, "VERIFIED");
  assert.equal(out.provenance, "KITE_WS");
  assert.equal(out.payload.expectedCount, 2);
  assert.equal(out.payload.verifiedCount, 2);
  assert.deepEqual(out.devilFlags, []);
});

test("sector breadth is separate from heavyweight evidence", () => {
  const out = buildCanonicalConstituentLiveComponent({
    parentSymbol: "NIFTY",
    role: "SECTOR_CONSTITUENT",
    registry,
    ticks: [tick(201)],
    asOfMs: 10_000,
    maxTickAgeMs: 100,
  });
  assert.equal(out.family, "SECTOR_BREADTH");
  assert.equal(out.status, "VERIFIED");
  assert.equal(out.payload.rows[0].sector, "BANKING");
});

test("missing constituent tick fails closed and is never verified", () => {
  const out = buildCanonicalConstituentLiveComponent({
    parentSymbol: "NIFTY",
    role: "HEAVYWEIGHT",
    registry,
    ticks: [tick(101)],
    asOfMs: 10_000,
    maxTickAgeMs: 100,
  });
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.payload.verifiedCount, 1);
  assert.ok(out.devilFlags?.includes("MISSING_TICK:102"));
});

test("stale or future tick fails closed", () => {
  const stale = buildCanonicalConstituentLiveComponent({
    parentSymbol: "NIFTY",
    role: "HEAVYWEIGHT",
    registry,
    ticks: [tick(101, 9_000), tick(102)],
    asOfMs: 10_000,
    maxTickAgeMs: 100,
  });
  assert.equal(stale.status, "BLOCKED");
  assert.ok(stale.devilFlags?.includes("STALE_TICK:101"));

  const future = buildCanonicalConstituentLiveComponent({
    parentSymbol: "NIFTY",
    role: "HEAVYWEIGHT",
    registry,
    ticks: [tick(101, 10_050), tick(102)],
    asOfMs: 10_000,
    maxTickAgeMs: 100,
  });
  assert.equal(future.status, "BLOCKED");
  assert.ok(future.devilFlags?.includes("STALE_TICK:101"));
});

test("duplicate tick fails closed", () => {
  const out = buildCanonicalConstituentLiveComponent({
    parentSymbol: "NIFTY",
    role: "HEAVYWEIGHT",
    registry,
    ticks: [tick(101), tick(101), tick(102)],
    asOfMs: 10_000,
    maxTickAgeMs: 100,
  });
  assert.equal(out.status, "BLOCKED");
  assert.ok(out.devilFlags?.includes("DUPLICATE_TICK:101"));
});
