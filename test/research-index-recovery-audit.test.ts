import test from "node:test";
import assert from "node:assert/strict";
import { auditResearchIndexArchiveRecovery, CURRENT_RUNTIME_WINDOW_ROWS } from "../research-index-recovery-audit.ts";
import { RESEARCH_INDEX_CODES } from "../research-index-health.ts";
import type { SqlClient, SqlQueryResult } from "../research-index-store.ts";

function fakeDb(years = 10.2, rows = 2550): SqlClient {
  return {
    async query<T = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<T>> {
      if (sql.includes("FROM research_index_daily")) {
        return {
          rows: RESEARCH_INDEX_CODES.map((index_code) => ({
            index_code,
            total_daily_rows: rows,
            earliest_trade_date: "2016-06-01",
            latest_trade_date: years >= 9.5 ? "2026-08-31" : "2022-08-31",
          })) as T[],
        };
      }
      if (sql.includes("FROM research_index_metrics")) {
        return {
          rows: RESEARCH_INDEX_CODES.map((index_code) => ({ index_code, total_metric_rows: Math.max(1, rows - 252) })) as T[],
        };
      }
      throw new Error("UNEXPECTED_QUERY");
    },
  };
}

test("proves a ten-year seven-index archive can exist while current runtime uses only 320 rows", async () => {
  const audit = await auditResearchIndexArchiveRecovery(fakeDb());
  assert.equal(audit.ready, true);
  assert.equal(audit.exactSevenCoverage, true);
  assert.equal(audit.allHaveApproxTenCalendarYears, true);
  assert.equal(audit.runtimeCurrentlyTruncatesHistory, true);
  assert.equal(audit.currentRuntimeWindowRows, CURRENT_RUNTIME_WINDOW_ROWS);
  assert.equal(audit.rows.length, 7);
  assert.ok(audit.rows.every((row) => row.totalDailyRows > CURRENT_RUNTIME_WINDOW_ROWS));
  assert.ok(audit.rows.every((row) => row.rowsOutsideRuntimeWindow > 2000));
  assert.equal(audit.readOnly, true);
  assert.equal(audit.mutatesData, false);
  assert.equal(audit.affectsVerdict, false);
  assert.equal(audit.affectsCandidate, false);
  assert.equal(audit.affectsTelegram, false);
  assert.equal(audit.affectsExecution, false);
});

test("does not fabricate ten-year coverage when archive is short", async () => {
  const audit = await auditResearchIndexArchiveRecovery(fakeDb(6, 1500));
  assert.equal(audit.ready, true);
  assert.equal(audit.allHaveApproxTenCalendarYears, false);
  assert.ok(audit.warnings.some((warning) => warning.includes("LESS_THAN_APPROX_10_CALENDAR_YEARS")));
});

test("fails closed when one canonical index is missing", async () => {
  const db = fakeDb();
  const original = db.query.bind(db);
  db.query = async <T = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<T>> => {
    const result = await original<T>(sql);
    if (sql.includes("FROM research_index_daily")) result.rows = result.rows.slice(0, 6);
    return result;
  };
  const audit = await auditResearchIndexArchiveRecovery(db);
  assert.equal(audit.ready, false);
  assert.equal(audit.rows.length, 0);
  assert.ok(audit.blockers.some((blocker) => blocker.includes("NO_ARCHIVE_ROWS")));
});

test("fails closed on database error and never grants authority", async () => {
  const db: SqlClient = { async query() { throw new Error("DB_DOWN"); } };
  const audit = await auditResearchIndexArchiveRecovery(db);
  assert.equal(audit.ready, false);
  assert.match(audit.blockers[0], /DB_DOWN/);
  assert.equal(audit.contextOnly, true);
  assert.equal(audit.failClosed, true);
  assert.equal(audit.affectsVerdict, false);
  assert.equal(audit.affectsExecution, false);
});
