import test from "node:test";
import assert from "node:assert/strict";
import { loadMarketDnaHistoricalMemoryFromDb } from "../canonical-market-dna-historical-memory-runtime.ts";
import { RESEARCH_INDEX_CODES } from "../research-index-health.ts";
import type { SqlClient, SqlQueryResult } from "../research-index-store.ts";

function fakeDb(count = 2636): SqlClient {
  return {
    async query<T = Record<string, unknown>>(): Promise<SqlQueryResult<T>> {
      const rows: unknown[] = [];
      for (const [offset, code] of RESEARCH_INDEX_CODES.entries()) {
        for (let i = 0; i < count; i += 1) {
          rows.push({
            trade_date: new Date(Date.UTC(2016, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
            index_code: code,
            close: 100 + offset + i * 0.1,
            validation_status: "VALID",
          });
        }
      }
      return { rows: rows as T[] };
    },
  };
}

test("runtime loader reads the full archive into Market DNA historical memory", async () => {
  const memory = await loadMarketDnaHistoricalMemoryFromDb(fakeDb());
  assert.equal(memory.ready, true);
  assert.equal(memory.minimumObservations, 2636);
  assert.equal(memory.tenYearWindowReady, true);
  assert.equal(memory.archiveBeyond320Ready, true);
  assert.equal(memory.rows.length, 7);
  assert.equal(memory.readOnly, true);
  assert.equal(memory.mutatesData, false);
  assert.equal(memory.affectsVerdict, false);
  assert.equal(memory.affectsExecution, false);
});

test("runtime loader fails closed on database error", async () => {
  const db: SqlClient = { async query() { throw new Error("DB_DOWN"); } };
  const memory = await loadMarketDnaHistoricalMemoryFromDb(db);
  assert.equal(memory.ready, false);
  assert.equal(memory.rows.length, 0);
  assert.match(memory.blockers[0], /DB_DOWN/);
});
