import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketDnaHistoricalMemory } from "../canonical-market-dna-historical-memory.ts";
import { RESEARCH_INDEX_CODES } from "../research-index-health.ts";
import type { ResearchIndexCode, ResearchIndexDailyRecord } from "../research-index-types.ts";

function makeHistory(code: ResearchIndexCode, count = 2636): ResearchIndexDailyRecord[] {
  const start = Date.UTC(2016, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    return {
      tradeDate: date,
      indexCode: code,
      indexName: code,
      open: null,
      high: null,
      low: null,
      close: 100 + i * 0.1 + RESEARCH_INDEX_CODES.indexOf(code),
      triClose: null,
      source: "OFFICIAL_TEST",
      sourceTimestamp: null,
      freshnessStatus: "FRESH",
      validationStatus: "VALID",
    };
  });
}

function full(count = 2636): Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>> {
  return Object.fromEntries(RESEARCH_INDEX_CODES.map((code) => [code, makeHistory(code, count)]));
}

test("turns the existing long archive into read-only Market DNA historical memory", () => {
  const memory = buildMarketDnaHistoricalMemory(full());
  assert.equal(memory.ready, true);
  assert.equal(memory.exactSevenCoverage, true);
  assert.equal(memory.archiveBeyond320Ready, true);
  assert.equal(memory.tenYearWindowReady, true);
  assert.equal(memory.rows.length, 7);
  assert.ok(memory.rows.every((row) => row.observations === 2636));
  assert.ok(memory.rows.every((row) => row.returnsPct[20] !== null));
  assert.ok(memory.rows.every((row) => row.returnsPct[252] !== null));
  assert.ok(memory.rows.every((row) => row.returnsPct[1260] !== null));
  assert.ok(memory.rows.every((row) => row.returnsPct[2520] !== null));
  assert.equal(memory.contextOnly, true);
  assert.equal(memory.affectsDirection, false);
  assert.equal(memory.affectsVerdict, false);
  assert.equal(memory.affectsCandidate, false);
  assert.equal(memory.affectsTelegram, false);
  assert.equal(memory.affectsExecution, false);
  assert.equal(memory.mutatesData, false);
});

test("fails closed when history is only the old 320-row runtime window", () => {
  const memory = buildMarketDnaHistoricalMemory(full(320));
  assert.equal(memory.ready, false);
  assert.equal(memory.archiveBeyond320Ready, false);
  assert.equal(memory.tenYearWindowReady, false);
  assert.equal(memory.rows.length, 0);
  assert.ok(memory.blockers.includes("HISTORICAL_MEMORY_NOT_BEYOND_320_ROWS"));
});

test("fails closed when one canonical index is absent", () => {
  const histories = full();
  delete histories.SMALLCAP250;
  const memory = buildMarketDnaHistoricalMemory(histories);
  assert.equal(memory.ready, false);
  assert.equal(memory.exactSevenCoverage, false);
  assert.equal(memory.rows.length, 0);
});
