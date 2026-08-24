import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResearchIndexRow } from "../research-index-importer.js";
import { validateResearchIndexRecord } from "../research-index-validator.js";
import { RESEARCH_INDEX_SCHEMA_SQL } from "../research-index-store.js";

test("official close-only historical row stays null and validates as PARTIAL", () => {
  const record = normalizeResearchIndexRow("MIDCAP150", {
    date: "2018-01-02",
    open: "-",
    high: "-",
    low: "-",
    close: "5000.25",
  }, "NSE_INDICES_PUBLIC_HISTORICAL_EXPORT");

  assert.equal(record.open, null);
  assert.equal(record.high, null);
  assert.equal(record.low, null);
  assert.equal(record.close, 5000.25);

  const result = validateResearchIndexRecord(record);
  assert.equal(result.valid, true);
  assert.equal(result.status, "PARTIAL");
  assert.ok(result.warnings.includes("PARTIAL_OHL_MISSING_3"));
});

test("missing or invalid close is never accepted as partial history", () => {
  const record = normalizeResearchIndexRow("SMALLCAP250", {
    date: "2018-01-02",
    open: "-",
    high: "-",
    low: "-",
    close: "-",
  }, "NSE_INDICES_PUBLIC_HISTORICAL_EXPORT");

  const result = validateResearchIndexRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("INVALID_CLOSE_VALUE"));
});

test("research DB schema permits nullable OHL but keeps close NOT NULL", () => {
  assert.match(RESEARCH_INDEX_SCHEMA_SQL, /open DOUBLE PRECISION NULL/);
  assert.match(RESEARCH_INDEX_SCHEMA_SQL, /high DOUBLE PRECISION NULL/);
  assert.match(RESEARCH_INDEX_SCHEMA_SQL, /low DOUBLE PRECISION NULL/);
  assert.match(RESEARCH_INDEX_SCHEMA_SQL, /close DOUBLE PRECISION NOT NULL/);
  assert.match(RESEARCH_INDEX_SCHEMA_SQL, /ALTER COLUMN open DROP NOT NULL/);
});
