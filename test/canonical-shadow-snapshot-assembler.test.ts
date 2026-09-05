import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalShadowSnapshot } from "../canonical-shadow-snapshot-assembler.js";
import type { CanonicalMarketComponent, CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";

const now = 1_800_000_000_000;
const baseFamilies: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE","VOLATILITY","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY",
];
const baseComponents: CanonicalMarketComponent[] = baseFamilies.map((family, i) => ({
  family,
  status: "VERIFIED",
  exchangeTimestampMs: now - 500,
  receivedAtMs: now - 400,
  processedAtMs: now - 300,
  ingestSeq: i + 1,
  provenance: "LOCAL_DERIVED",
  source: `TEST_${family}`,
  payload: { ok: true },
  devilFlags: [],
}));
const budgets = Object.fromEntries([
  ...baseFamilies.map((family) => [family, 5_000]),
  ["HEAVYWEIGHTS", 5_000],
  ["SECTOR_BREADTH", 5_000],
]) as any;
const registry = [
  { instrumentToken: 101, parentSymbol: "NIFTY" as const, role: "HEAVYWEIGHT" as const, tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12, source: "KITE_INSTRUMENT_MASTER" as const },
  { instrumentToken: 102, parentSymbol: "NIFTY" as const, role: "SECTOR_CONSTITUENT" as const, tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10, source: "KITE_INSTRUMENT_MASTER" as const },
];
const tick = (instrumentToken: number, age = 500) => ({ instrumentToken, exchangeTimestampMs: now-age, receivedAtMs: now-age+50, processedAtMs: now-age+100, ingestSeq: instrumentToken, ltp: 100 });
function input(ticks: any[]) {
  return {
    snapshotId: "snap-1", symbol: "NIFTY" as const, asOfMs: now, minuteClosed: true,
    connectionId: "conn-1", instrumentMasterVersion: "master-v1",
    baseComponents, constituentRegistry: registry, constituentTicks: ticks, constituentFreshnessMs: 2_000,
    freshnessBudgetsMs: budgets,
    ingestTelemetry: { queueDepth: 0, queueLagMs: 0, droppedPacketCount: 0, backpressureActive: false },
  };
}

test("all canonical families ready when constituent ticks are fresh and complete", () => {
  const out = buildCanonicalShadowSnapshot(input([tick(101), tick(102)]));
  assert.equal(out.readyForStrictFiltering, true);
  assert.equal(out.newEntryGate, "ALLOW_NEW_ENTRIES");
  assert.equal(out.qualityState, "VERIFIED");
});

test("missing constituent tick blocks strict filtering", () => {
  const out = buildCanonicalShadowSnapshot(input([tick(101)]));
  assert.equal(out.readyForStrictFiltering, false);
  assert.equal(out.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.equal(out.components.find((x) => x.family === "SECTOR_BREADTH")?.status, "BLOCKED");
});

test("stale constituent tick blocks strict filtering", () => {
  const out = buildCanonicalShadowSnapshot(input([tick(101), tick(102, 10_000)]));
  assert.equal(out.readyForStrictFiltering, false);
  assert.equal(out.newEntryGate, "BLOCK_NEW_ENTRIES");
});

test("backpressure still blocks entries even when all family data is valid", () => {
  const x = input([tick(101), tick(102)]);
  x.ingestTelemetry.backpressureActive = true;
  const out = buildCanonicalShadowSnapshot(x);
  assert.equal(out.readyForStrictFiltering, false);
  assert.equal(out.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.ok(out.internalBlockers.includes("INGEST_BACKPRESSURE_ACTIVE"));
});
