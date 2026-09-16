import assert from "node:assert/strict";
import test from "node:test";
import {
  validateH1GoldHorizonProvenance,
  type H1GoldHorizon,
  type H1GoldHorizonCapturedWindow,
} from "../h1-gold-horizon-provenance-contract-v1.js";

const T = "2026-09-16T06:30:05.000Z"; // 12:00:05 IST
const T_MS = Date.parse(T);
const HORIZONS: H1GoldHorizon[] = ["3M", "6M", "15M", "30M"];

function marketOpenUtcMsFor(timestampMs: number): number {
  const d = new Date(timestampMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
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
    immutableCaptureId: `NIFTY:CLOSE:${horizon}:${new Date(endMs).toISOString()}`,
    ...overrides,
  };
}

function input(windows = HORIZONS.map((horizon) => window(horizon))) {
  return {
    symbol: "NIFTY" as const,
    observedAt: T,
    snapshotId: "NIFTY-20260916-063005",
    windows,
  };
}

test("structurally valid requires one immutable complete capture for all latest 3/6/15/30 horizons persisted before T0", () => {
  const out = validateH1GoldHorizonProvenance(input());
  assert.equal(out.state, "STRUCTURALLY_VALID");
  assert.equal(out.readyForExactProducer, true);
  assert.deepEqual(out.validatedHorizons, HORIZONS);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.directMutableTimeframeStateEligible, false);
  assert.equal(out.registersGoldFamily, false);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("missing 30M fails closed", () => {
  const out = validateH1GoldHorizonProvenance(input(HORIZONS.filter((h) => h !== "30M").map((h) => window(h))));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("30M:MISSING_REQUIRED_HORIZON"));
  assert.ok(out.blockers.includes("EXACT_REQUIRED_HORIZON_SET_NOT_SATISFIED"));
});

test("duplicate 15M fails closed", () => {
  const rows = HORIZONS.map((h) => window(h));
  rows.push(window("15M", { immutableCaptureId: "duplicate-15m" }));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("15M:DUPLICATE_REQUIRED_HORIZON"));
});

test("future block end cannot be used at T0", () => {
  const rows = HORIZONS.map((h) => h === "3M"
    ? window(h, {
        blockStart: new Date(T_MS).toISOString(),
        blockEnd: new Date(T_MS + 3 * 60_000).toISOString(),
        capturedAt: new Date(T_MS + 3 * 60_000).toISOString(),
        persistedAt: new Date(T_MS + 3 * 60_000 + 1_000).toISOString(),
      })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("3M:FUTURE_BLOCK_END"));
  assert.ok(out.blockers.includes("3M:PERSISTED_AFTER_DECISION_T0"));
  assert.ok(out.blockers.includes("3M:LATEST_CLOSED_BOUNDARY_MISMATCH"));
});

test("a close event persisted after decision T0 is rejected even if its block ended before T0", () => {
  const rows = HORIZONS.map((h) => h === "30M"
    ? window(h, { persistedAt: new Date(T_MS + 1_000).toISOString() })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("30M:PERSISTED_AFTER_DECISION_T0"));
});

test("capture timestamp must equal the formal block close instead of being stamped later at decision time", () => {
  const rows = HORIZONS.map((h) => h === "6M"
    ? window(h, { capturedAt: new Date(T_MS - 1_000).toISOString() })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("6M:CAPTURE_NOT_AT_FORMAL_BLOCK_CLOSE"));
});

test("persisted-before-capture chronology is rejected", () => {
  const current = window("15M");
  const rows = HORIZONS.map((h) => h === "15M"
    ? window(h, { persistedAt: new Date(Date.parse(current.capturedAt) - 1).toISOString() })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("15M:PERSISTED_BEFORE_CAPTURE"));
});

test("wrong symbol, partial sampling and wrong sample count fail closed", () => {
  const rows = HORIZONS.map((h) => {
    if (h === "3M") return window(h, { symbol: "SENSEX" });
    if (h === "6M") return window(h, { dataQuality: "PARTIAL_SAMPLING" });
    if (h === "15M") return window(h, { sampleCount: 14 });
    return window(h);
  });
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("3M:SYMBOL_MISMATCH"));
  assert.ok(out.blockers.includes("6M:DATA_QUALITY_NOT_COMPLETE_1M"));
  assert.ok(out.blockers.includes("15M:SAMPLE_COUNT_NOT_EXACT"));
});

test("mutable timeframe_state-style evidence cannot satisfy the immutable contract", () => {
  const rows = HORIZONS.map((h) => h === "15M"
    ? window(h, { immutable: false, immutableCaptureId: null })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("15M:MUTABLE_SOURCE_NOT_ALLOWED"));
  assert.ok(out.blockers.includes("15M:IMMUTABLE_CAPTURE_ID_REQUIRED"));
  assert.equal(out.directMutableTimeframeStateEligible, false);
});

test("stale closed block cannot masquerade as latest complete horizon", () => {
  const current = window("30M");
  const oldEnd = Date.parse(current.blockEnd) - 30 * 60_000;
  const rows = HORIZONS.map((h) => h === "30M"
    ? window(h, {
        blockStart: new Date(oldEnd - 30 * 60_000).toISOString(),
        blockEnd: new Date(oldEnd).toISOString(),
        capturedAt: new Date(oldEnd).toISOString(),
        persistedAt: new Date(oldEnd + 1_000).toISOString(),
      })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("30M:LATEST_CLOSED_BOUNDARY_MISMATCH"));
});

test("fake completeness flags cannot replace exact archive provenance", () => {
  const rows = HORIZONS.map((h) => h === "3M"
    ? window(h, { source: "derived:allComplete", stateCode: "COMPLETE", semantics: "ALL_COMPLETE", ruleVersion: "FAKE" })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("3M:INVALID_SOURCE"));
  assert.ok(out.blockers.includes("3M:INVALID_STATE_CODE"));
  assert.ok(out.blockers.includes("3M:INVALID_ARCHIVE_SEMANTICS"));
  assert.ok(out.blockers.includes("3M:INVALID_RULE_VERSION"));
});

test("wrong block duration fails closed", () => {
  const current = window("6M");
  const rows = HORIZONS.map((h) => h === "6M"
    ? window(h, { blockStart: new Date(Date.parse(current.blockEnd) - 5 * 60_000).toISOString() })
    : window(h));
  const out = validateH1GoldHorizonProvenance(input(rows));
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("6M:BLOCK_DURATION_MISMATCH"));
});
