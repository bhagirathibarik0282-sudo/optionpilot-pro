import test from "node:test";
import assert from "node:assert/strict";
import { validateResearchIndexBatch, validateResearchIndexRecord } from "../research-index-validator.js";
import { DefaultResearchIndexDerivedEngine } from "../research-index-derived.js";
import { evaluateResearchIndexHealth } from "../research-index-health.js";
import { classifySizeRegime } from "../research-size-regime.js";
import type {
  ResearchIndexDailyRecord,
  ResearchIndexCode,
  ResearchIndexMetrics,
} from "../research-index-types.js";

function row(
  tradeDate: string,
  close: number,
  indexCode: ResearchIndexCode = "NIFTY50",
): ResearchIndexDailyRecord {
  return {
    tradeDate,
    indexCode,
    indexName: indexCode,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    triClose: null,
    source: "TEST",
    sourceTimestamp: `${tradeDate}T12:00:00.000Z`,
    freshnessStatus: "FRESH",
    validationStatus: "VALID",
  };
}

function metric(
  indexCode: ResearchIndexCode,
  rs5: number,
  rs20: number,
  rs60 = rs20,
): ResearchIndexMetrics {
  return {
    tradeDate: "2026-08-21",
    indexCode,
    return1d: null,
    return5d: null,
    return20d: null,
    return60d: null,
    return120d: null,
    return252d: null,
    rsVsNifty50_5d: rs5,
    rsVsNifty50_20d: rs20,
    rsVsNifty50_60d: rs60,
  };
}

function isoTradingDay(offset: number): string {
  const d = new Date(Date.UTC(2025, 0, 1 + offset));
  return d.toISOString().slice(0, 10);
}

test("validator accepts internally consistent OHLC", () => {
  const result = validateResearchIndexRecord(row("2026-08-21", 100));
  assert.equal(result.valid, true);
  assert.equal(result.status, "VALID");
  assert.deepEqual(result.errors, []);
});

test("validator rejects impossible OHLC", () => {
  const bad = row("2026-08-21", 100);
  bad.high = 99;
  const result = validateResearchIndexRecord(bad);
  assert.equal(result.valid, false);
  assert.equal(result.status, "INVALID");
  assert.ok(result.errors.includes("HIGH_BELOW_OPEN"));
  assert.ok(result.errors.includes("HIGH_BELOW_CLOSE"));
});

test("validator marks missing source timestamp as partial, not fabricated valid", () => {
  const partial = row("2026-08-21", 100);
  partial.sourceTimestamp = null;
  const result = validateResearchIndexRecord(partial);
  assert.equal(result.valid, true);
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.warnings.includes("MISSING_SOURCE_TIMESTAMP"));
});

test("batch validator rejects duplicate index/date rows", () => {
  const a = row("2026-08-21", 100);
  const b = row("2026-08-21", 101);
  const result = validateResearchIndexBatch([a, b]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((x) => x.includes("DUPLICATE_RECORD")));
});

test("derived engine returns null when lookback history is insufficient", () => {
  const history = [row("2026-08-20", 100), row("2026-08-21", 101)];
  const metrics = new DefaultResearchIndexDerivedEngine().buildMetrics(history, history);
  const latest = metrics.at(-1);
  assert.ok(latest);
  assert.equal(latest.return1d, 1);
  assert.equal(latest.return5d, null);
  assert.equal(latest.return20d, null);
  assert.equal(latest.return60d, null);
});

test("5 trading-observation return is calculated from observation index, not calendar-day gap", () => {
  const history = Array.from({ length: 6 }, (_, i) => row(isoTradingDay(i), 100 + i));
  const metrics = new DefaultResearchIndexDerivedEngine().buildMetrics(history, history);
  const latest = metrics.at(-1);
  assert.ok(latest);
  assert.ok(latest.return5d !== null);
  assert.ok(Math.abs(latest.return5d - 5) < 1e-12);
});

test("relative strength is index return minus same-date NIFTY50 return", () => {
  const nifty = Array.from({ length: 6 }, (_, i) => row(isoTradingDay(i), 100 + i, "NIFTY50"));
  const midcap = Array.from({ length: 6 }, (_, i) => row(isoTradingDay(i), 100 + i * 2, "MIDCAP150"));
  const latest = new DefaultResearchIndexDerivedEngine().buildMetrics(midcap, nifty).at(-1);
  assert.ok(latest);
  assert.ok(latest.return5d !== null);
  assert.ok(latest.rsVsNifty50_5d !== null);
  assert.ok(Math.abs(latest.return5d - 10) < 1e-12);
  assert.ok(Math.abs(latest.rsVsNifty50_5d - 5) < 1e-12);
});

test("invalid historical rows are ignored by derived calculations", () => {
  const history = [row("2026-08-19", 100), row("2026-08-20", 999), row("2026-08-21", 110)];
  history[1].validationStatus = "INVALID";
  const latest = new DefaultResearchIndexDerivedEngine().buildMetrics(history, history).at(-1);
  assert.ok(latest);
  assert.ok(latest.return1d !== null);
  assert.ok(Math.abs(latest.return1d - 10) < 1e-12);
});

test("health gate is GOOD when all seven indices are valid and aligned", () => {
  const date = "2026-08-21";
  const health = evaluateResearchIndexHealth({
    NIFTY50: [row(date, 100, "NIFTY50")],
    NIFTY100: [row(date, 100, "NIFTY100")],
    NIFTY200: [row(date, 100, "NIFTY200")],
    NIFTY500: [row(date, 100, "NIFTY500")],
    NEXT50: [row(date, 100, "NEXT50")],
    MIDCAP150: [row(date, 100, "MIDCAP150")],
    SMALLCAP250: [row(date, 100, "SMALLCAP250")],
  });
  assert.equal(health.overall, "GOOD");
  assert.deepEqual(health.missing, []);
});

test("stale core NIFTY500 suppresses overall health", () => {
  const old = row("2026-08-20", 100, "NIFTY500");
  const date = "2026-08-21";
  const health = evaluateResearchIndexHealth({
    NIFTY50: [row(date, 100, "NIFTY50")],
    NIFTY100: [row(date, 100, "NIFTY100")],
    NIFTY200: [row(date, 100, "NIFTY200")],
    NIFTY500: [old],
    NEXT50: [row(date, 100, "NEXT50")],
    MIDCAP150: [row(date, 100, "MIDCAP150")],
    SMALLCAP250: [row(date, 100, "SMALLCAP250")],
  });
  assert.equal(health.overall, "INVALID");
  assert.ok(health.stale.includes("NIFTY500"));
});

test("size classifier recognizes broad risk-on only when broad, mid and small caps agree", () => {
  const result = classifySizeRegime({
    dataQuality: "GOOD",
    metrics: {
      NIFTY500: metric("NIFTY500", 1.5, 2.0, 1.2),
      MIDCAP150: metric("MIDCAP150", 2.0, 2.5, 1.8),
      SMALLCAP250: metric("SMALLCAP250", 2.5, 3.0, 2.0),
      NEXT50: metric("NEXT50", 1.0, 1.2, 1.0),
    },
  });
  assert.equal(result.state, "BROAD_RISK_ON");
});

test("size classifier recognizes narrow large-cap rally", () => {
  const result = classifySizeRegime({
    dataQuality: "GOOD",
    metrics: {
      NIFTY500: metric("NIFTY500", -1.0, -1.2, -0.5),
      MIDCAP150: metric("MIDCAP150", -1.5, -2.0, -1.0),
      SMALLCAP250: metric("SMALLCAP250", -2.0, -2.5, -1.5),
      NEXT50: metric("NEXT50", -0.2, -0.5, -0.1),
    },
  });
  assert.equal(result.state, "NARROW_LARGECAP_RALLY");
});

test("invalid data quality forces MIXED_UNCLASSIFIED instead of a strong regime", () => {
  const result = classifySizeRegime({
    dataQuality: "INVALID",
    metrics: {
      NIFTY500: metric("NIFTY500", 4, 4),
      MIDCAP150: metric("MIDCAP150", 5, 5),
      SMALLCAP250: metric("SMALLCAP250", 6, 6),
    },
  });
  assert.equal(result.state, "MIXED_UNCLASSIFIED");
  assert.equal(result.strength, "UNKNOWN");
  assert.equal(result.conflict, true);
});

test("mixed positive and negative size evidence is explicitly marked conflict", () => {
  const result = classifySizeRegime({
    dataQuality: "GOOD",
    metrics: {
      NIFTY500: metric("NIFTY500", 0.8, 0.7),
      MIDCAP150: metric("MIDCAP150", 1.4, 1.2),
      SMALLCAP250: metric("SMALLCAP250", -1.3, -1.8),
      NEXT50: metric("NEXT50", 0.2, 0.1),
    },
  });
  assert.equal(result.conflict, true);
  assert.notEqual(result.state, "BROAD_RISK_ON");
});
