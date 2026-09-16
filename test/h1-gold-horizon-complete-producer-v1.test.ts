import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import {
  buildH1GoldClosedHorizonCapture,
  type H1GoldClosedHorizonCaptureEvent,
} from "../h1-gold-horizon-closed-block-capture-v1.js";
import {
  buildH1GoldHorizonComplete,
  H1_GOLD_HORIZON_COMPLETE_SOURCE,
  loadAndBuildH1GoldHorizonComplete,
  loadH1GoldHorizonCaptureStore,
} from "../h1-gold-horizon-complete-producer-v1.js";
import type { H1GoldHorizon, H1GoldHorizonCapturedWindow } from "../h1-gold-horizon-provenance-contract-v1.js";

const T = "2026-09-16T06:30:05.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = "NIFTY-20260916-063005";
const HORIZONS: H1GoldHorizon[] = ["3M", "6M", "15M", "30M"];
const FAMILIES: CanonicalMarketFamily[] = [
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

function root(symbol: "NIFTY" | "SENSEX" = "NIFTY") {
  const components: CanonicalMarketComponent[] = FAMILIES.map((family, index) => ({
    family,
    status: "VERIFIED",
    exchangeTimestampMs: T_MS - 5_000,
    receivedAtMs: T_MS - 4_000,
    processedAtMs: T_MS - 3_000,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" : "LOCAL_DERIVED",
    source: `verified:${family}`,
    payload: { family },
  }));
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: symbol === "NIFTY" ? SNAPSHOT_ID : "SENSEX-20260916-063005",
    symbol,
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-horizon-test",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs: Object.fromEntries(FAMILIES.map((family) => [family, 30_000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 1, droppedPacketCount: 0, backpressureActive: false },
  });
}

function marketOpenUtcMsFor(timestampMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), 3, 45, 0, 0);
}

function window(horizon: H1GoldHorizon, overrides: Partial<H1GoldHorizonCapturedWindow> = {}): H1GoldHorizonCapturedWindow {
  const minutes = Number.parseInt(horizon, 10);
  const tfMs = minutes * 60_000;
  const openMs = marketOpenUtcMsFor(T_MS);
  const endMs = openMs + Math.floor((T_MS - openMs) / tfMs) * tfMs;
  return {
    horizon,
    symbol: "NIFTY",
    blockStart: new Date(endMs - tfMs).toISOString(),
    blockEnd: new Date(endMs).toISOString(),
    capturedAt: new Date(endMs).toISOString(),
    persistedAt: new Date(endMs + 1_000).toISOString(),
    dataQuality: "COMPLETE_1M",
    stateCode: "RAW_BLOCK_ARCHIVE_ONLY",
    source: "market_snapshot_1m",
    semantics: "RAW_BLOCK_ARCHIVE_ONLY",
    ruleVersion: "STORAGE_V3_TF_PHASE1",
    sampleCount: minutes,
    expected1mCount: minutes,
    immutable: true,
    immutableCaptureId: `capture:${horizon}:${new Date(endMs).toISOString()}`,
    ...overrides,
  };
}

function event(horizon: H1GoldHorizon): H1GoldClosedHorizonCaptureEvent {
  const w = window(horizon);
  const out = buildH1GoldClosedHorizonCapture({
    symbol: w.symbol,
    timeframeMinutes: Number.parseInt(horizon, 10),
    blockStart: w.blockStart,
    blockEnd: w.blockEnd,
    dataQuality: w.dataQuality,
    stateCode: w.stateCode,
    source: w.source,
    semantics: w.semantics,
    ruleVersion: w.ruleVersion,
    sampleCount: w.sampleCount,
    expected1mCount: w.expected1mCount,
  });
  assert.ok(out);
  return out;
}

test("PASS requires all immutable latest horizons plus valid canonical T0 binding", () => {
  const out = buildH1GoldHorizonComplete({
    symbol: "NIFTY",
    observedAt: T,
    canonicalSnapshot: root(),
    windows: HORIZONS.map((h) => window(h)),
  });
  assert.equal(out.ready, true);
  assert.equal(out.state, "PASS");
  assert.deepEqual(out.validatedHorizons, HORIZONS);
  assert.equal(out.signal.state, "PASS");
  assert.equal(out.signal.source, H1_GOLD_HORIZON_COMPLETE_SOURCE);
  assert.equal(out.signal.snapshotId, SNAPSHOT_ID);
  assert.equal(out.signal.observedAt, T);
  assert.equal(out.signal.provenance, "LIVE_RUNTIME_EXACT");
  assert.equal(out.calculatesThresholds, false);
  assert.equal(out.usesFutureOutcome, false);
  assert.equal(out.readsMutableTimeframeStateDirectly, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("missing 30M remains MISSING rather than inferred from other horizons", () => {
  const out = buildH1GoldHorizonComplete({
    symbol: "NIFTY",
    observedAt: T,
    canonicalSnapshot: root(),
    windows: HORIZONS.filter((h) => h !== "30M").map((h) => window(h)),
  });
  assert.equal(out.ready, false);
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("30M:MISSING_REQUIRED_HORIZON"));
});

test("late-persisted capture is MISSING and cannot leak future-known evidence", () => {
  const out = buildH1GoldHorizonComplete({
    symbol: "NIFTY",
    observedAt: T,
    canonicalSnapshot: root(),
    windows: HORIZONS.map((h) => h === "15M" ? window(h, { persistedAt: new Date(T_MS + 1_000).toISOString() }) : window(h)),
  });
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("15M:PERSISTED_AFTER_DECISION_T0"));
  assert.equal(out.usesFutureOutcome, false);
});

test("canonical timestamp mismatch fails closed", () => {
  const out = buildH1GoldHorizonComplete({
    symbol: "NIFTY",
    observedAt: new Date(T_MS + 1_000).toISOString(),
    canonicalSnapshot: root(),
    windows: HORIZONS.map((h) => window(h)),
  });
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("CANONICAL_DECISION_TIMESTAMP_MISMATCH"));
});

test("capture store loader accepts only latest-boundary append events and dedupes identical retries", async () => {
  const rows = HORIZONS.flatMap((h) => {
    const e = event(h);
    const persisted = new Date(Date.parse(e.blockEnd) + 1_000).toISOString();
    return h === "3M"
      ? [{ payload: e, created_at: persisted }, { payload: e, created_at: new Date(Date.parse(persisted) + 500).toISOString() }]
      : [{ payload: e, created_at: persisted }];
  });
  const old = event("30M");
  rows.push({
    payload: { ...old, blockStart: "2026-09-16T05:30:00.000Z", blockEnd: "2026-09-16T06:00:00.000Z", capturedAt: "2026-09-16T06:00:00.000Z", captureId: "old-30m" },
    created_at: "2026-09-16T06:00:01.000Z",
  });
  const query = async <T>() => ({ rows: rows as T[] });
  const loaded = await loadH1GoldHorizonCaptureStore("NIFTY", T, query);
  assert.deepEqual(loaded.blockers, []);
  assert.equal(loaded.windows.length, 4);
  assert.equal(loaded.windows.filter((w) => w.horizon === "3M").length, 1);
});

test("divergent duplicate capture id is blocked", async () => {
  const e = event("3M");
  const rows = [
    { payload: e, created_at: new Date(Date.parse(e.blockEnd) + 1_000).toISOString() },
    { payload: { ...e, sampleCount: 2 }, created_at: new Date(Date.parse(e.blockEnd) + 2_000).toISOString() },
    ...HORIZONS.filter((h) => h !== "3M").map((h) => {
      const other = event(h);
      return { payload: other, created_at: new Date(Date.parse(other.blockEnd) + 1_000).toISOString() };
    }),
  ];
  const query = async <T>() => ({ rows: rows as T[] });
  const loaded = await loadH1GoldHorizonCaptureStore("NIFTY", T, query);
  assert.ok(loaded.blockers.some((b) => b.startsWith("DIVERGENT_DUPLICATE_CAPTURE_ID:")));
  const out = buildH1GoldHorizonComplete({
    symbol: "NIFTY",
    observedAt: T,
    canonicalSnapshot: root(),
    windows: loaded.windows,
    captureStoreBlockers: loaded.blockers,
  });
  assert.equal(out.state, "MISSING");
});

test("unavailable append store fails closed instead of falling back to mutable timeframe_state", async () => {
  const query = async <T>() => null as { rows: T[] } | null;
  const out = await loadAndBuildH1GoldHorizonComplete({
    symbol: "NIFTY",
    observedAt: T,
    canonicalSnapshot: root(),
  }, query);
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("HORIZON_CAPTURE_STORE_UNAVAILABLE"));
  assert.equal(out.readsMutableTimeframeStateDirectly, false);
});
