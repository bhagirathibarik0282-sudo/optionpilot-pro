import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";

const asOfMs = Date.parse("2026-09-05T10:30:00.000Z");
const families: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

const freshnessBudgetsMs = Object.fromEntries(
  families.map((family) => [family, 30_000]),
) as Record<CanonicalMarketFamily, number>;

function verifiedComponents(): CanonicalMarketComponent[] {
  return families.map((family, index) => ({
    family,
    status: "VERIFIED" as const,
    exchangeTimestampMs: asOfMs - 5_000,
    receivedAtMs: asOfMs - 4_500,
    processedAtMs: asOfMs - 4_000,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" as const : "LOCAL_DERIVED" as const,
    source: `verified:${family}`,
    sourceTimeRange: { fromMs: asOfMs - 60_000, toMs: asOfMs - 5_000 },
    payload: { family },
  }));
}

function baseInput(components = verifiedComponents()) {
  return {
    snapshotId: "NIFTY-20260905-103000",
    symbol: "NIFTY" as const,
    asOfMs,
    minuteClosed: false,
    connectionId: "kite-ws-connection-1",
    instrumentMasterVersion: "kite-instruments-2026-09-05",
    components,
    freshnessBudgetsMs,
    ingestTelemetry: {
      queueDepth: 0,
      queueLagMs: 3,
      droppedPacketCount: 0,
      backpressureActive: false,
    },
  };
}

test("all required verified families share one roof and become filter-ready", () => {
  const result = buildCanonicalOneRoofMarketSnapshot(baseInput());
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, true);
  assert.equal(result.qualityState, "VERIFIED");
  assert.equal(result.userFacingState, "READY_FOR_BUYER_SELLER_FILTER");
  assert.equal(result.newEntryGate, "ALLOW_NEW_ENTRIES");
  assert.equal(result.internalBlockers.length, 0);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.aiMayOverride, false);
});

test("heavyweight family is mandatory for strict filtering but observation remains recordable", () => {
  const components = verifiedComponents().filter((x) => x.family !== "HEAVYWEIGHTS");
  const result = buildCanonicalOneRoofMarketSnapshot({
    ...baseInput(components),
    symbol: "BANKNIFTY",
  });
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.userFacingState, "WAIT_FOR_CONFIRMATION");
  assert.equal(result.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.ok(result.internalBlockers.includes("HEAVYWEIGHTS:MISSING"));
});

test("sector breadth remains separate and mandatory from heavyweights", () => {
  const components = verifiedComponents().filter((x) => x.family !== "SECTOR_BREADTH");
  const result = buildCanonicalOneRoofMarketSnapshot(baseInput(components));
  assert.equal(result.readyForStrictFiltering, false);
  assert.ok(result.internalBlockers.includes("SECTOR_BREADTH:MISSING"));
  assert.equal(result.internalBlockers.includes("HEAVYWEIGHTS:MISSING"), false);
});

test("closed minute becomes immutable record even when a later gate blocks new entries", () => {
  const input = baseInput();
  input.minuteClosed = true;
  input.ingestTelemetry.backpressureActive = true;
  const result = buildCanonicalOneRoofMarketSnapshot(input);
  assert.equal(result.recordable, true);
  assert.equal(result.immutableRecord, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.newEntryGate, "BLOCK_NEW_ENTRIES");
});

test("pending or devil-flagged family blocks filtering without erasing the snapshot", () => {
  const components = verifiedComponents();
  components[2] = { ...components[2], status: "PENDING" };
  components[6] = { ...components[6], devilFlags: ["constituent timestamp skew"] };
  const result = buildCanonicalOneRoofMarketSnapshot(baseInput(components));
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.ok(result.internalBlockers.includes("OPTION_PREMIUMS:NOT_VERIFIED"));
  assert.ok(result.internalBlockers.includes("HEAVYWEIGHTS:DEVIL_CHECK_BLOCKED"));
});

test("each evidence family uses its own freshness budget instead of a universal 90 second rule", () => {
  const components = verifiedComponents();
  components[0] = { ...components[0], exchangeTimestampMs: asOfMs - 12_000 };
  const budgets = { ...freshnessBudgetsMs, MARKET_STRUCTURE: 10_000, MULTI_DTE: 60_000 };
  const result = buildCanonicalOneRoofMarketSnapshot({ ...baseInput(components), freshnessBudgetsMs: budgets });
  assert.equal(result.readyForStrictFiltering, false);
  assert.ok(result.internalBlockers.includes("MARKET_STRUCTURE:OUTSIDE_FRESHNESS_BUDGET"));
});

test("uncalibrated family freshness stays shadow-only and blocks new entries", () => {
  const budgets = { ...freshnessBudgetsMs } as Partial<Record<CanonicalMarketFamily, number>>;
  delete budgets.VOLATILITY;
  const result = buildCanonicalOneRoofMarketSnapshot({ ...baseInput(), freshnessBudgetsMs: budgets });
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.qualityState, "SHADOW_UNCALIBRATED");
  assert.equal(result.userFacingState, "SHADOW_UNCALIBRATED");
  assert.equal(result.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.ok(result.internalBlockers.includes("VOLATILITY:FRESHNESS_UNCALIBRATED"));
});

test("packet provenance and ingest timing are explicit and invalid lineage fails closed", () => {
  const components = verifiedComponents();
  components[1] = {
    ...components[1],
    provenance: "LOCAL_DERIVED",
    receivedAtMs: asOfMs - 1_000,
    processedAtMs: asOfMs - 2_000,
    ingestSeq: 0,
  };
  const result = buildCanonicalOneRoofMarketSnapshot(baseInput(components));
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.ok(result.internalBlockers.includes("FUTURES_CONFIRMATION:PROCESSING_TIME_REVERSED"));
  assert.ok(result.internalBlockers.includes("FUTURES_CONFIRMATION:INVALID_INGEST_SEQ"));
});

test("backpressure or dropped packets blocks new entries while preserving observed truth", () => {
  const input = baseInput();
  input.ingestTelemetry = {
    queueDepth: 23,
    queueLagMs: 450,
    droppedPacketCount: 2,
    backpressureActive: true,
  };
  const result = buildCanonicalOneRoofMarketSnapshot(input);
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.newEntryGate, "BLOCK_NEW_ENTRIES");
  assert.ok(result.internalBlockers.includes("INGEST_BACKPRESSURE_ACTIVE"));
  assert.ok(result.internalBlockers.includes("INGEST_PACKETS_DROPPED"));
});

test("instrument-master and connection identity are required for strict filtering", () => {
  const result = buildCanonicalOneRoofMarketSnapshot({
    ...baseInput(),
    connectionId: "",
    instrumentMasterVersion: "",
  });
  assert.equal(result.recordable, true);
  assert.equal(result.readyForStrictFiltering, false);
  assert.ok(result.internalBlockers.includes("CONNECTION_ID_REQUIRED"));
  assert.ok(result.internalBlockers.includes("INSTRUMENT_MASTER_VERSION_REQUIRED"));
});

test("invalid root identity is not recordable and never filter-ready", () => {
  const result = buildCanonicalOneRoofMarketSnapshot({
    ...baseInput(),
    snapshotId: "",
    asOfMs: Number.NaN,
    minuteClosed: true,
  });
  assert.equal(result.recordable, false);
  assert.equal(result.immutableRecord, false);
  assert.equal(result.readyForStrictFiltering, false);
  assert.equal(result.newEntryGate, "BLOCK_NEW_ENTRIES");
});
