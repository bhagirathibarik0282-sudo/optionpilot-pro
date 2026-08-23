import test from "node:test";
import assert from "node:assert/strict";
import { parseOfficialHistoricalIndexCsv } from "../research-index-historical-csv.js";

test("historical CSV parser reads OHLC rows and preserves raw dates", () => {
  const csv = [
    "Index Name,Date,Open,High,Low,Close",
    'NIFTY 50,"01 Jan 2026","25,000.00","25,100.00","24,900.00","25,050.00"',
    'NIFTY 50,"02 Jan 2026","25,050.00","25,200.00","25,000.00","25,150.00"',
  ].join("\n");

  const result = parseOfficialHistoricalIndexCsv("NIFTY50", csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].open, "25,000.00");
  assert.equal(result.rows[1].close, "25,150.00");
  assert.equal(result.audit.parsedRows, 2);
  assert.equal(result.audit.skippedRows, 0);
  assert.equal(result.audit.partialOhlRows, 0);
});

test("historical CSV parser preserves official close-only rows without fabricating OHL", () => {
  const csv = [
    "Index Name,Date,Open,High,Low,Close",
    "NIFTY MIDCAP 150,01 Jan 2018,-,-,-,5000",
    "NIFTY MIDCAP 150,02 Jan 2018,5010,,4990,5020",
  ].join("\n");

  const result = parseOfficialHistoricalIndexCsv("MIDCAP150", csv);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].open, null);
  assert.equal(result.rows[0].high, null);
  assert.equal(result.rows[0].low, null);
  assert.equal(result.rows[0].close, "5000");
  assert.equal(result.rows[1].high, null);
  assert.equal(result.audit.skippedRows, 0);
  assert.equal(result.audit.partialOhlRows, 2);
  assert.ok(result.audit.warnings.includes("PARTIAL_OHL_ROWS_2"));
});

test("historical CSV parser skips rows with missing close", () => {
  const csv = [
    "Index Name,Date,Open,High,Low,Close",
    "NIFTY 50,01 Jan 2026,25000,25100,24900,25050",
    "NIFTY 50,02 Jan 2026,25050,25200,25000,-",
  ].join("\n");

  const result = parseOfficialHistoricalIndexCsv("NIFTY50", csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.audit.skippedRows, 1);
  assert.ok(result.audit.warnings.includes("SKIPPED_ROWS_1"));
});

test("historical CSV parser reports header-only CSV as empty", () => {
  const result = parseOfficialHistoricalIndexCsv("NIFTY50", "Index Name,Date,Open,High,Low,Close\n");
  assert.equal(result.rows.length, 0);
  assert.ok(result.audit.warnings.includes("EMPTY_OR_HEADER_ONLY_CSV"));
});
