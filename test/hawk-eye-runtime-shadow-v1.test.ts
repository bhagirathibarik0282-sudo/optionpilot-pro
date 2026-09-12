import test from "node:test";
import assert from "node:assert/strict";
import { buildHawkEyeRuntimeShadowV1 } from "../hawk-eye-runtime-shadow-v1.ts";
import type { CanonicalConstituentTokenEntry } from "../canonical-constituent-token-registry.ts";
import type { KiteConstituentMinuteRecord } from "../kite-constituent-runtime-bridge-v1.ts";

const minute = 60_000;
const AS_OF = 17 * minute;

const registry: CanonicalConstituentTokenEntry[] = [
  { instrumentToken: 1, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "FINANCIALS", weight: null, source: "KITE_INSTRUMENT_MASTER" },
  { instrumentToken: 2, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "BANK_A", sector: "FINANCIALS", weight: 60, source: "KITE_INSTRUMENT_MASTER" },
  { instrumentToken: 3, parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "BANK_B", sector: "FINANCIALS", weight: 40, source: "KITE_INSTRUMENT_MASTER" },
];

function minutes(): KiteConstituentMinuteRecord[] {
  return Array.from({ length: 16 }, (_, i) => {
    const minuteStartMs = (i + 1) * minute;
    const tickAt = minuteStartMs + 50_000;
    return {
      minuteStartMs,
      closedAtMs: minuteStartMs + minute,
      immutable: true,
      ticks: [
        { instrumentToken: 1, exchangeTimestampMs: tickAt, receivedAtMs: tickAt + 10, processedAtMs: tickAt + 20, ingestSeq: i * 3 + 1, ltp: 100 + i },
        { instrumentToken: 2, exchangeTimestampMs: tickAt, receivedAtMs: tickAt + 10, processedAtMs: tickAt + 20, ingestSeq: i * 3 + 2, ltp: 200 + i },
        { instrumentToken: 3, exchangeTimestampMs: tickAt, receivedAtMs: tickAt + 10, processedAtMs: tickAt + 20, ingestSeq: i * 3 + 3, ltp: 300 + (2 * i) },
      ],
    };
  });
}

test("reuses closed constituent minutes for heavyweight and weighted sector rolling features", () => {
  const report = buildHawkEyeRuntimeShadowV1({ registry, constituentMinutes: minutes(), asOfMs: AS_OF });
  assert.equal(report.opensSocket, false);
  assert.equal(report.fetchesNetworkData, false);
  assert.equal(report.affectsSelector, false);
  assert.equal(report.affectsTelegram, false);
  assert.equal(report.createsOrders, false);
  assert.equal(report.heavyweightSeriesCount, 1);
  assert.equal(report.sectorSeriesCount, 1);
  assert.ok(report.observation.features.some((x) => x.feature === "HDFCBANK_RETURN_3M"));
  assert.ok(report.observation.features.some((x) => x.feature.includes("FINANCIALS_REGISTERED_WEIGHTED_BASKET_RETURN_15M")));
});

test("sector basket fails closed when exact weights are unavailable", () => {
  const noWeights = registry.map((row) => row.role === "SECTOR_CONSTITUENT" ? { ...row, weight: null } : row);
  const report = buildHawkEyeRuntimeShadowV1({ registry: noWeights, constituentMinutes: minutes(), asOfMs: AS_OF });
  assert.equal(report.sectorSeriesCount, 0);
  assert.ok(report.skippedSectorBaskets.some((x) => x === "FINANCIALS:EXACT_WEIGHTS_REQUIRED"));
  assert.equal(report.observation.features.some((x) => x.family === "SECTORS"), false);
});

test("sister series consume only caller-supplied already-fetched canonical snapshots", () => {
  const snapshots = [0, 3, 6, 15].map((back) => ({
    observedAtMs: AS_OF - (back * minute),
    rows: [{
      indexId: "NIFTY_NEXT_50" as const,
      officialName: "Nifty Next 50",
      nseApiName: "NIFTY NEXT 50",
      sourceUrl: "https://www.nseindia.com/api/allIndices" as const,
      ltp: 1000 - back,
      change: 1,
      changePct: 0.1,
      previousClose: 999,
      advances: null,
      declines: null,
      unchanged: null,
      fetchedAt: new Date(AS_OF - (back * minute)).toISOString(),
    }],
  }));
  const report = buildHawkEyeRuntimeShadowV1({ registry, constituentMinutes: minutes(), sevenIndexSnapshots: snapshots, asOfMs: AS_OF });
  assert.equal(report.sisterSeriesCount, 1);
  assert.ok(report.observation.features.some((x) => x.feature === "NIFTY_NEXT_50_RETURN_3M"));
});

test("future closed minutes and future sister snapshots are ignored", () => {
  const futureMinute = {
    ...minutes()[0],
    minuteStartMs: AS_OF + minute,
    closedAtMs: AS_OF + (2 * minute),
  };
  const report = buildHawkEyeRuntimeShadowV1({
    registry,
    constituentMinutes: [...minutes(), futureMinute],
    sevenIndexSnapshots: [{ observedAtMs: AS_OF + minute, rows: [] }],
    asOfMs: AS_OF,
  });
  assert.equal(report.inputClosedMinuteCount, 16);
  assert.equal(report.sisterSeriesCount, 0);
});
