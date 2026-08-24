import type {
  ResearchIndexCode,
  ResearchIndexDailyRecord,
  ResearchIndexMetrics,
  ResearchIndexStore,
} from "./research-index-types";
import { validateResearchIndexRecord } from "./research-index-validator";

export const RESEARCH_INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS research_index_daily (
  id BIGSERIAL PRIMARY KEY,
  trade_date DATE NOT NULL,
  index_code TEXT NOT NULL,
  index_name TEXT NOT NULL,
  open DOUBLE PRECISION NULL CHECK (open IS NULL OR open > 0),
  high DOUBLE PRECISION NULL CHECK (high IS NULL OR high > 0),
  low DOUBLE PRECISION NULL CHECK (low IS NULL OR low > 0),
  close DOUBLE PRECISION NOT NULL CHECK (close > 0),
  tri_close DOUBLE PRECISION NULL CHECK (tri_close IS NULL OR tri_close > 0),
  source TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ NULL,
  freshness_status TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT research_index_daily_ohlc_check CHECK (
    (high IS NULL OR low IS NULL OR high >= low) AND
    (high IS NULL OR open IS NULL OR high >= open) AND
    (high IS NULL OR high >= close) AND
    (low IS NULL OR open IS NULL OR low <= open) AND
    (low IS NULL OR low <= close)
  ),
  CONSTRAINT research_index_daily_unique UNIQUE (trade_date, index_code)
);

ALTER TABLE research_index_daily ALTER COLUMN open DROP NOT NULL;
ALTER TABLE research_index_daily ALTER COLUMN high DROP NOT NULL;
ALTER TABLE research_index_daily ALTER COLUMN low DROP NOT NULL;

CREATE INDEX IF NOT EXISTS research_index_daily_code_date_idx
  ON research_index_daily (index_code, trade_date DESC);

CREATE TABLE IF NOT EXISTS research_index_metrics (
  id BIGSERIAL PRIMARY KEY,
  trade_date DATE NOT NULL,
  index_code TEXT NOT NULL,
  return_1d DOUBLE PRECISION NULL,
  return_5d DOUBLE PRECISION NULL,
  return_20d DOUBLE PRECISION NULL,
  return_60d DOUBLE PRECISION NULL,
  return_120d DOUBLE PRECISION NULL,
  return_252d DOUBLE PRECISION NULL,
  rs_vs_nifty50_5d DOUBLE PRECISION NULL,
  rs_vs_nifty50_20d DOUBLE PRECISION NULL,
  rs_vs_nifty50_60d DOUBLE PRECISION NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT research_index_metrics_unique UNIQUE (trade_date, index_code)
);

CREATE INDEX IF NOT EXISTS research_index_metrics_code_date_idx
  ON research_index_metrics (index_code, trade_date DESC);
`;

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlQueryResult<T>>;
}

type DailyRow = {
  trade_date: string | Date;
  index_code: ResearchIndexCode;
  index_name: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  tri_close: number | null;
  source: string;
  source_timestamp: string | Date | null;
  freshness_status: ResearchIndexDailyRecord["freshnessStatus"];
  validation_status: ResearchIndexDailyRecord["validationStatus"];
};

type MetricsRow = {
  trade_date: string | Date;
  index_code: ResearchIndexCode;
  return_1d: number | null;
  return_5d: number | null;
  return_20d: number | null;
  return_60d: number | null;
  return_120d: number | null;
  return_252d: number | null;
  rs_vs_nifty50_5d: number | null;
  rs_vs_nifty50_20d: number | null;
  rs_vs_nifty50_60d: number | null;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isoOrNull(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function numberOrNull(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function mapDaily(row: DailyRow): ResearchIndexDailyRecord {
  return {
    tradeDate: dateOnly(row.trade_date),
    indexCode: row.index_code,
    indexName: row.index_name,
    open: numberOrNull(row.open),
    high: numberOrNull(row.high),
    low: numberOrNull(row.low),
    close: Number(row.close),
    triClose: row.tri_close === null ? null : Number(row.tri_close),
    source: row.source,
    sourceTimestamp: isoOrNull(row.source_timestamp),
    freshnessStatus: row.freshness_status,
    validationStatus: row.validation_status,
  };
}

function mapMetrics(row: MetricsRow): ResearchIndexMetrics {
  return {
    tradeDate: dateOnly(row.trade_date),
    indexCode: row.index_code,
    return1d: row.return_1d === null ? null : Number(row.return_1d),
    return5d: row.return_5d === null ? null : Number(row.return_5d),
    return20d: row.return_20d === null ? null : Number(row.return_20d),
    return60d: row.return_60d === null ? null : Number(row.return_60d),
    return120d: row.return_120d === null ? null : Number(row.return_120d),
    return252d: row.return_252d === null ? null : Number(row.return_252d),
    rsVsNifty50_5d: row.rs_vs_nifty50_5d === null ? null : Number(row.rs_vs_nifty50_5d),
    rsVsNifty50_20d: row.rs_vs_nifty50_20d === null ? null : Number(row.rs_vs_nifty50_20d),
    rsVsNifty50_60d: row.rs_vs_nifty50_60d === null ? null : Number(row.rs_vs_nifty50_60d),
  };
}

export class PostgresResearchIndexStore implements ResearchIndexStore {
  constructor(private readonly db: SqlClient | null | undefined) {}

  async ensureSchema(): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.query(RESEARCH_INDEX_SCHEMA_SQL);
      return true;
    } catch (error) {
      console.error("[research-index-store] schema init failed", error);
      return false;
    }
  }

  async upsertDaily(record: ResearchIndexDailyRecord): Promise<boolean> {
    if (!this.db) return false;
    const validation = validateResearchIndexRecord(record);
    if (!validation.valid) {
      console.warn("[research-index-store] rejected invalid daily record", {
        indexCode: record.indexCode,
        tradeDate: record.tradeDate,
        errors: validation.errors,
      });
      return false;
    }

    try {
      await this.db.query(
        `INSERT INTO research_index_daily (
          trade_date, index_code, index_name, open, high, low, close, tri_close,
          source, source_timestamp, freshness_status, validation_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (trade_date, index_code) DO UPDATE SET
          index_name = EXCLUDED.index_name,
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          tri_close = EXCLUDED.tri_close,
          source = EXCLUDED.source,
          source_timestamp = EXCLUDED.source_timestamp,
          freshness_status = EXCLUDED.freshness_status,
          validation_status = EXCLUDED.validation_status,
          updated_at = NOW()`,
        [
          record.tradeDate,
          record.indexCode,
          record.indexName,
          record.open,
          record.high,
          record.low,
          record.close,
          record.triClose,
          record.source,
          record.sourceTimestamp,
          record.freshnessStatus,
          validation.status,
        ],
      );
      return true;
    } catch (error) {
      console.error("[research-index-store] daily upsert failed", error);
      return false;
    }
  }

  async upsertMetrics(metrics: ResearchIndexMetrics): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.query(
        `INSERT INTO research_index_metrics (
          trade_date, index_code, return_1d, return_5d, return_20d, return_60d,
          return_120d, return_252d, rs_vs_nifty50_5d, rs_vs_nifty50_20d, rs_vs_nifty50_60d
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (trade_date, index_code) DO UPDATE SET
          return_1d = EXCLUDED.return_1d,
          return_5d = EXCLUDED.return_5d,
          return_20d = EXCLUDED.return_20d,
          return_60d = EXCLUDED.return_60d,
          return_120d = EXCLUDED.return_120d,
          return_252d = EXCLUDED.return_252d,
          rs_vs_nifty50_5d = EXCLUDED.rs_vs_nifty50_5d,
          rs_vs_nifty50_20d = EXCLUDED.rs_vs_nifty50_20d,
          rs_vs_nifty50_60d = EXCLUDED.rs_vs_nifty50_60d,
          updated_at = NOW()`,
        [
          metrics.tradeDate,
          metrics.indexCode,
          metrics.return1d,
          metrics.return5d,
          metrics.return20d,
          metrics.return60d,
          metrics.return120d,
          metrics.return252d,
          metrics.rsVsNifty50_5d,
          metrics.rsVsNifty50_20d,
          metrics.rsVsNifty50_60d,
        ],
      );
      return true;
    } catch (error) {
      console.error("[research-index-store] metrics upsert failed", error);
      return false;
    }
  }

  async getHistory(indexCode: ResearchIndexCode, limit = 300): Promise<ResearchIndexDailyRecord[]> {
    if (!this.db) return [];
    try {
      const result = await this.db.query<DailyRow>(
        `SELECT trade_date,index_code,index_name,open,high,low,close,tri_close,source,
                source_timestamp,freshness_status,validation_status
         FROM research_index_daily
         WHERE index_code = $1
         ORDER BY trade_date DESC
         LIMIT $2`,
        [indexCode, limit],
      );
      return result.rows.map(mapDaily).reverse();
    } catch (error) {
      console.error("[research-index-store] history read failed", error);
      return [];
    }
  }

  async getHistoryRange(indexCode: ResearchIndexCode, from: string, to: string): Promise<ResearchIndexDailyRecord[]> {
    if (!this.db) return [];
    try {
      const result = await this.db.query<DailyRow>(
        `SELECT trade_date,index_code,index_name,open,high,low,close,tri_close,source,
                source_timestamp,freshness_status,validation_status
         FROM research_index_daily
         WHERE index_code = $1 AND trade_date BETWEEN $2 AND $3
         ORDER BY trade_date ASC`,
        [indexCode, from, to],
      );
      return result.rows.map(mapDaily);
    } catch (error) {
      console.error("[research-index-store] history range read failed", error);
      return [];
    }
  }

  async getLatest(indexCode: ResearchIndexCode): Promise<ResearchIndexDailyRecord | null> {
    if (!this.db) return null;
    try {
      const result = await this.db.query<DailyRow>(
        `SELECT trade_date,index_code,index_name,open,high,low,close,tri_close,source,
                source_timestamp,freshness_status,validation_status
         FROM research_index_daily
         WHERE index_code = $1
         ORDER BY trade_date DESC
         LIMIT 1`,
        [indexCode],
      );
      return result.rows[0] ? mapDaily(result.rows[0]) : null;
    } catch (error) {
      console.error("[research-index-store] latest read failed", error);
      return null;
    }
  }

  async getMetrics(indexCode: ResearchIndexCode, limit = 300): Promise<ResearchIndexMetrics[]> {
    if (!this.db) return [];
    try {
      const result = await this.db.query<MetricsRow>(
        `SELECT trade_date,index_code,return_1d,return_5d,return_20d,return_60d,return_120d,
                return_252d,rs_vs_nifty50_5d,rs_vs_nifty50_20d,rs_vs_nifty50_60d
         FROM research_index_metrics
         WHERE index_code = $1
         ORDER BY trade_date DESC
         LIMIT $2`,
        [indexCode, limit],
      );
      return result.rows.map(mapMetrics).reverse();
    } catch (error) {
      console.error("[research-index-store] metrics read failed", error);
      return [];
    }
  }
}
