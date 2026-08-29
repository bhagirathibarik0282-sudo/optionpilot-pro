import pg from "pg";
import type { NormalizedFiiDiiCash } from "./fii-dii-nse.js";

const { Pool } = pg;

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
