import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ensureFiiDiiSchema,
  upsertNseParticipantDerivativesDaily,
  type NseParticipantDerivativeRow,
} from "../fii-dii-store.js";

type QueryCall = { text: string; values?: unknown[] };

function fakePool(calls: QueryCall[]) {
  return {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Parameters<typeof ensureFiiDiiSchema>[0];
}

function row(overrides: Partial<NseParticipantDerivativeRow> = {}): NseParticipantDerivativeRow {
  return {
    tradeDate: "2026-09-17",
    reportKind: "OI",
    participant: "FII",
    sourceUrl: "https://www.nseindia.com/all-reports-derivatives",
    fetchedAt: "2026-09-17T13:00:00.000Z",
    futureIndexLong: 101,
    futureIndexShort: 102,
    futureStockLong: 103,
    futureStockShort: 104,
    optionIndexCallLong: 105,
    optionIndexPutLong: 106,
    optionIndexCallShort: 107,
    optionIndexPutShort: 108,
    optionStockCallLong: 109,
    optionStockPutLong: 110,
    optionStockCallShort: 111,
    optionStockPutShort: 112,
    totalLongContracts: 113,
    totalShortContracts: 114,
    ...overrides,
  };
}

test("extends the existing FII/DII schema with participant-wise NSE OI/volume persistence", async () => {
  const calls: QueryCall[] = [];
  await ensureFiiDiiSchema(fakePool(calls));
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /CREATE TABLE IF NOT EXISTS fii_dii_cash_daily/);
  assert.match(calls[0].text, /CREATE TABLE IF NOT EXISTS nse_participant_derivatives_daily/);
  assert.match(calls[0].text, /report_kind IN \('OI','VOLUME'\)/);
  assert.match(calls[0].text, /participant IN \('CLIENT','DII','FII','PRO'\)/);
  assert.match(calls[0].text, /PRIMARY KEY \(trade_date, report_kind, participant\)/);
});

test("persists OI and volume participant rows in one atomic multi-row upsert", async () => {
  const calls: QueryCall[] = [];
  const pool = fakePool(calls);
  await upsertNseParticipantDerivativesDaily(pool, [
    row(),
    row({ reportKind: "VOLUME", participant: "CLIENT", futureIndexLong: 201 }),
  ]);

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO nse_participant_derivatives_daily/);
  assert.match(calls[0].text, /ON CONFLICT \(trade_date, report_kind, participant\) DO UPDATE/);
  assert.equal(calls[0].values?.length, 40);
  assert.deepEqual(calls[0].values?.slice(0, 6), [
    "2026-09-17",
    "OI",
    "FII",
    "NSE_PARTICIPANT_OI",
    "https://www.nseindia.com/all-reports-derivatives",
    "2026-09-17T13:00:00.000Z",
  ]);
  assert.deepEqual(calls[0].values?.slice(20, 26), [
    "2026-09-17",
    "VOLUME",
    "CLIENT",
    "NSE_PARTICIPANT_VOLUME",
    "https://www.nseindia.com/all-reports-derivatives",
    "2026-09-17T13:00:00.000Z",
  ]);
});

test("rejects invalid counts before touching PostgreSQL", async () => {
  const calls: QueryCall[] = [];
  const pool = fakePool(calls);
  await assert.rejects(
    () => upsertNseParticipantDerivativesDaily(pool, [row({ futureIndexLong: -1 })]),
    /NSE_PARTICIPANT_DERIVATIVE_COUNT_INVALID:futureIndexLong/,
  );
  assert.equal(calls.length, 0);
});

test("rejects non-NSE source URLs before touching PostgreSQL", async () => {
  const calls: QueryCall[] = [];
  const pool = fakePool(calls);
  await assert.rejects(
    () => upsertNseParticipantDerivativesDaily(pool, [row({ sourceUrl: "https://example.com/report.csv" })]),
    /NSE_PARTICIPANT_DERIVATIVE_SOURCE_URL_INVALID/,
  );
  assert.equal(calls.length, 0);
});

test("rejects duplicate participant identity in the same batch", async () => {
  const calls: QueryCall[] = [];
  const pool = fakePool(calls);
  await assert.rejects(
    () => upsertNseParticipantDerivativesDaily(pool, [row(), row()]),
    /NSE_PARTICIPANT_DERIVATIVE_DUPLICATE:2026-09-17:OI:FII/,
  );
  assert.equal(calls.length, 0);
});

test("rejects empty participant batches", async () => {
  const calls: QueryCall[] = [];
  const pool = fakePool(calls);
  await assert.rejects(
    () => upsertNseParticipantDerivativesDaily(pool, []),
    /NSE_PARTICIPANT_DERIVATIVE_ROWS_REQUIRED/,
  );
  assert.equal(calls.length, 0);
});


test("central DB bootstrap initializes existing FII/DII schema without coupling failure to core persistence", async () => {
  const source = await readFile(new URL("../db.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ ensureFiiDiiSchema \} from "\.\/fii-dii-store\.js";/);
  assert.match(source, /await ensureFiiDiiSchema\(p\);/);
  assert.match(source, /\[DB\] FII\/DII schema ready/);
  assert.match(source, /FII\/DII schema init failed -- core persistence remains available/);
});
