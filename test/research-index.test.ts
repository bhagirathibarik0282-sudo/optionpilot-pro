import test from "node:test";
import assert from "node:assert/strict";
import { validateResearchIndexBatch, validateResearchIndexRecord } from "../research-index-validator.js";
import { DefaultResearchIndexDerivedEngine } from "../research-index-derived.js";
import type { ResearchIndexDailyRecord, ResearchIndexCode } from "../research-index-types.js";

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
