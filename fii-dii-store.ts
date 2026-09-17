import pg from "pg";
import type { NormalizedFiiDiiCash } from "./fii-dii-nse.js";

const { Pool } = pg;

export type NseParticipantReportKind = "OI" | "VOLUME";
export type NseParticipantCategory = "CLIENT" | "DII" | "FII" | "PRO";

export interface NseParticipantDerivativeRow {
  tradeDate: string;
  reportKind: NseParticipantReportKind;
  participant: NseParticipantCategory;
  sourceUrl: string;
  fetchedAt: string;
  futureIndexLong: number;
  futureIndexShort: number;
  futureStockLong: number;
  futureStockShort: number;
  optionIndexCallLong: number;
  optionIndexPutLong: number;
  optionIndexCallShort: number;
  optionIndexPutShort: number;
  optionStockCallLong: number;
  optionStockPutLong: number;
  optionStockCallShort: number;
  optionStockPutShort: number;
  totalLongContracts: number;
  totalShortContracts: number;
}

const PARTICIPANT_COUNT_KEYS = [
  "futureIndexLong", "futureIndexShort", "futureStockLong", "futureStockShort",
  "optionIndexCallLong", "optionIndexPutLong", "optionIndexCallShort", "optionIndexPutShort",
  "optionStockCallLong", "optionStockPutLong", "optionStockCallShort", "optionStockPutShort",
  "totalLongContracts", "totalShortContracts",
] as const;

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validNseSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "nseindia.com" || url.hostname.endsWith(".nseindia.com"));
  } catch {
    return false;
  }
}

function assertParticipantRow(row: NseParticipantDerivativeRow): void {
  if (!validIsoDate(row.tradeDate)) throw new Error("NSE_PARTICIPANT_DERIVATIVE_DATE_INVALID");
  if (row.reportKind !== "OI" && row.reportKind !== "VOLUME") {
    throw new Error("NSE_PARTICIPANT_DERIVATIVE_REPORT_KIND_INVALID");
  }
  if (!["CLIENT", "DII", "FII", "PRO"].includes(row.participant)) {
    throw new Error("NSE_PARTICIPANT_DERIVATIVE_PARTICIPANT_INVALID");
  }
  if (!validNseSourceUrl(row.sourceUrl)) throw new Error("NSE_PARTICIPANT_DERIVATIVE_SOURCE_URL_INVALID");
  if (!Number.isFinite(Date.parse(row.fetchedAt))) throw new Error("NSE_PARTICIPANT_DERIVATIVE_FETCHED_AT_INVALID");
  for (const key of PARTICIPANT_COUNT_KEYS) {
    const value = row[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`NSE_PARTICIPANT_DERIVATIVE_COUNT_INVALID:${key}`);
    }
  }
}

function poolFromEnv(): InstanceType<typeof Pool> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_REQUIRED_FOR_FII_DII_JOB");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({ connectionString: url, max: 2, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
}

export async function withFiiDiiDb<T>(fn: (pool: InstanceType<typeof Pool>) => Promise<T>): Promise<T> {
  const pool = poolFromEnv();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

export async function ensureFiiDiiSchema(pool: InstanceType<typeof Pool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fii_dii_cash_daily (
      trade_date DATE PRIMARY KEY,
      source TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      fii_buy DOUBLE PRECISION NOT NULL,
      fii_sell DOUBLE PRECISION NOT NULL,
      fii_net DOUBLE PRECISION NOT NULL,
      dii_buy DOUBLE PRECISION NOT NULL,
      dii_sell DOUBLE PRECISION NOT NULL,
      dii_net DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_fii_dii_cash_daily_date ON fii_dii_cash_daily (trade_date DESC);

    CREATE TABLE IF NOT EXISTS nse_participant_derivatives_daily (
      trade_date DATE NOT NULL,
      report_kind TEXT NOT NULL CHECK (report_kind IN ('OI','VOLUME')),
      participant TEXT NOT NULL CHECK (participant IN ('CLIENT','DII','FII','PRO')),
      source TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      future_index_long BIGINT NOT NULL,
      future_index_short BIGINT NOT NULL,
      future_stock_long BIGINT NOT NULL,
      future_stock_short BIGINT NOT NULL,
      option_index_call_long BIGINT NOT NULL,
      option_index_put_long BIGINT NOT NULL,
      option_index_call_short BIGINT NOT NULL,
      option_index_put_short BIGINT NOT NULL,
      option_stock_call_long BIGINT NOT NULL,
      option_stock_put_long BIGINT NOT NULL,
      option_stock_call_short BIGINT NOT NULL,
      option_stock_put_short BIGINT NOT NULL,
      total_long_contracts BIGINT NOT NULL,
      total_short_contracts BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (trade_date, report_kind, participant)
    );
  `);
}

export async function latestRecordedMarketSessionDate(pool: InstanceType<typeof Pool>): Promise<string> {
  const result = await pool.query<{ trade_date: string | null }>(`
    SELECT MAX((minute_bucket AT TIME ZONE 'Asia/Kolkata')::date)::text AS trade_date
    FROM market_snapshot_1m
  `);
  const date = result.rows[0]?.trade_date?.trim();
  if (!date) throw new Error("NO_MARKET_SESSION_FOR_FII_DII_FRESHNESS");
  return date;
}

export async function upsertFiiDiiCashDaily(
  pool: InstanceType<typeof Pool>,
  row: NormalizedFiiDiiCash,
): Promise<void> {
  await pool.query(`
    INSERT INTO fii_dii_cash_daily (
      trade_date, source, source_url, fetched_at,
      fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
    ON CONFLICT (trade_date) DO UPDATE SET
      source=EXCLUDED.source,
      source_url=EXCLUDED.source_url,
      fetched_at=EXCLUDED.fetched_at,
      fii_buy=EXCLUDED.fii_buy,
      fii_sell=EXCLUDED.fii_sell,
      fii_net=EXCLUDED.fii_net,
      dii_buy=EXCLUDED.dii_buy,
      dii_sell=EXCLUDED.dii_sell,
      dii_net=EXCLUDED.dii_net,
      updated_at=now()
  `, [
    row.date, row.source, row.sourceUrl, row.fetchedAt,
    row.fii.buy, row.fii.sell, row.fii.net,
    row.dii.buy, row.dii.sell, row.dii.net,
  ]);
}

// Persistence-only boundary. This stores official participant-wise derivatives
// facts and intentionally grants no candidate, Telegram, verdict or execution authority.
export async function upsertNseParticipantDerivativesDaily(
  pool: InstanceType<typeof Pool>,
  rows: NseParticipantDerivativeRow[],
): Promise<void> {
  if (!rows.length) throw new Error("NSE_PARTICIPANT_DERIVATIVE_ROWS_REQUIRED");

  const identities = new Set<string>();
  for (const row of rows) {
    assertParticipantRow(row);
    const identity = `${row.tradeDate}:${row.reportKind}:${row.participant}`;
    if (identities.has(identity)) throw new Error(`NSE_PARTICIPANT_DERIVATIVE_DUPLICATE:${identity}`);
    identities.add(identity);
  }

  const values: unknown[] = [];
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * 20;
    values.push(
      row.tradeDate,
      row.reportKind,
      row.participant,
      `NSE_PARTICIPANT_${row.reportKind}`,
      row.sourceUrl,
      row.fetchedAt,
      row.futureIndexLong,
      row.futureIndexShort,
      row.futureStockLong,
      row.futureStockShort,
      row.optionIndexCallLong,
      row.optionIndexPutLong,
      row.optionIndexCallShort,
      row.optionIndexPutShort,
      row.optionStockCallLong,
      row.optionStockPutLong,
      row.optionStockCallShort,
      row.optionStockPutShort,
      row.totalLongContracts,
      row.totalShortContracts,
    );
    return `(${Array.from({ length: 20 }, (_, i) => `$${offset + i + 1}`).join(",")},now())`;
  });

  await pool.query(`
    INSERT INTO nse_participant_derivatives_daily (
      trade_date, report_kind, participant, source, source_url, fetched_at,
      future_index_long, future_index_short, future_stock_long, future_stock_short,
      option_index_call_long, option_index_put_long, option_index_call_short, option_index_put_short,
      option_stock_call_long, option_stock_put_long, option_stock_call_short, option_stock_put_short,
      total_long_contracts, total_short_contracts, updated_at
    ) VALUES ${placeholders.join(",")}
    ON CONFLICT (trade_date, report_kind, participant) DO UPDATE SET
      source=EXCLUDED.source,
      source_url=EXCLUDED.source_url,
      fetched_at=EXCLUDED.fetched_at,
      future_index_long=EXCLUDED.future_index_long,
      future_index_short=EXCLUDED.future_index_short,
      future_stock_long=EXCLUDED.future_stock_long,
      future_stock_short=EXCLUDED.future_stock_short,
      option_index_call_long=EXCLUDED.option_index_call_long,
      option_index_put_long=EXCLUDED.option_index_put_long,
      option_index_call_short=EXCLUDED.option_index_call_short,
      option_index_put_short=EXCLUDED.option_index_put_short,
      option_stock_call_long=EXCLUDED.option_stock_call_long,
      option_stock_put_long=EXCLUDED.option_stock_put_long,
      option_stock_call_short=EXCLUDED.option_stock_call_short,
      option_stock_put_short=EXCLUDED.option_stock_put_short,
      total_long_contracts=EXCLUDED.total_long_contracts,
      total_short_contracts=EXCLUDED.total_short_contracts,
      updated_at=now()
  `, values);
}
