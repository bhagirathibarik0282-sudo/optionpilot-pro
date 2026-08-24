import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;
let poolInitAttempted = false;

function getPool(): InstanceType<typeof Pool> | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (pool) return pool;
  if (poolInitAttempted) return null;
  poolInitAttempted = true;
  try {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
    pool.on("error", (err: Error) => {
      console.error("[DB] idle client error (pool stays usable):", err.message);
    });
  } catch (err) {
    console.error("[DB] failed to construct connection pool -- persistence disabled for this run:", err instanceof Error ? err.message : err);
    pool = null;
  }
  return pool;
}

export interface MarketSnapshot1mRow {
  symbol: string;
  minuteBucket: string;
  snapshotId?: string | null;
  exchangeTimestamp?: string | null;
  backendTimestamp?: string | null;
  freshnessStatus?: string | null;
  spotLtp?: number | null;
  spotOpen?: number | null;
  spotHigh?: number | null;
  spotLow?: number | null;
  spotPrevClose?: number | null;
  vwap?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  gapPercent?: number | null;
  futureLtp?: number | null;
  futureVwap?: number | null;
  futureOi?: number | null;
  futureOiChange?: number | null;
  futureVolume?: number | null;
  futureBasis?: number | null;
  indiaVix?: number | null;
  indiaVixChange?: number | null;
  calculationVersion?: string | null;
}

export interface OptionSnapshot1mRow {
  symbol: string;
  minuteBucket: string;
  snapshotId?: string | null;
  expiry: string;
  expiryBucket?: string | null;
  dte?: number | null;
  strike: number;
  optionType: "CE" | "PE";
  atmOffset?: number | null;
  isCandidate?: boolean;
  isWall?: boolean;
  ltp?: number | null;
  bid?: number | null;
  ask?: number | null;
  spread?: number | null;
  volume?: number | null;
  oi?: number | null;
  oiChange?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  vega?: number | null;
  theta?: number | null;
  intrinsic?: number | null;
  extrinsic?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  quoteTimestamp?: string | null;
  quoteAgeSeconds?: number | null;
  liquidityStatus?: string | null;
  validationStatus?: string | null;
  calculationVersion?: string | null;
}

export interface ChainState1mRow {
  symbol: string;
  minuteBucket: string;
  expiry: string;
  expiryBucket?: string | null;
  atmStrike?: number | null;
  fullChainOiPcr?: number | null;
  band7OiPcr?: number | null;
  volumePcr?: number | null;
  maxPain?: number | null;
  callWallStrike?: number | null;
  callWallOi?: number | null;
  callWallStrength?: number | null;
  callWallDistance?: number | null;
  callWallMigration?: number | null;
  putWallStrike?: number | null;
  putWallOi?: number | null;
  putWallStrength?: number | null;
  putWallDistance?: number | null;
  putWallMigration?: number | null;
  atmIv?: number | null;
  straddleLtp?: number | null;
  straddleChange?: number | null;
  validationStatus?: string | null;
  calculationVersion?: string | null;
}

export async function dbInit(): Promise<void> {
  const p = getPool();
  if (!p) {
    console.log("[DB] DATABASE_URL not set -- persistence disabled, running in-memory only (same behavior as before this file existed)");
    return;
  }
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS app_state_log (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_app_state_log_kind_created ON app_state_log (kind, created_at DESC);

      CREATE TABLE IF NOT EXISTS market_snapshot_1m (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        minute_bucket TIMESTAMPTZ NOT NULL,
        snapshot_id TEXT,
        exchange_timestamp TIMESTAMPTZ,
        backend_timestamp TIMESTAMPTZ,
        freshness_status TEXT,
        spot_ltp DOUBLE PRECISION,
        spot_open DOUBLE PRECISION,
        spot_high DOUBLE PRECISION,
        spot_low DOUBLE PRECISION,
        spot_prev_close DOUBLE PRECISION,
        vwap DOUBLE PRECISION,
        pdh DOUBLE PRECISION,
        pdl DOUBLE PRECISION,
        gap_percent DOUBLE PRECISION,
        future_ltp DOUBLE PRECISION,
        future_vwap DOUBLE PRECISION,
        future_oi BIGINT,
        future_oi_change BIGINT,
        future_volume BIGINT,
        future_basis DOUBLE PRECISION,
        india_vix DOUBLE PRECISION,
        india_vix_change DOUBLE PRECISION,
        calculation_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(symbol, minute_bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_market_snapshot_1m_symbol_time ON market_snapshot_1m (symbol, minute_bucket DESC);

      CREATE TABLE IF NOT EXISTS option_snapshot_1m (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        minute_bucket TIMESTAMPTZ NOT NULL,
        snapshot_id TEXT,
        expiry DATE NOT NULL,
        expiry_bucket TEXT,
        dte SMALLINT,
        strike INTEGER NOT NULL,
        option_type CHAR(2) NOT NULL,
        atm_offset SMALLINT,
        is_candidate BOOLEAN NOT NULL DEFAULT false,
        is_wall BOOLEAN NOT NULL DEFAULT false,
        ltp DOUBLE PRECISION,
        bid DOUBLE PRECISION,
        ask DOUBLE PRECISION,
        spread DOUBLE PRECISION,
        volume BIGINT,
        oi BIGINT,
        oi_change BIGINT,
        iv DOUBLE PRECISION,
        delta DOUBLE PRECISION,
        gamma DOUBLE PRECISION,
        vega DOUBLE PRECISION,
        theta DOUBLE PRECISION,
        intrinsic DOUBLE PRECISION,
        extrinsic DOUBLE PRECISION,
        day_high DOUBLE PRECISION,
        day_low DOUBLE PRECISION,
        pdh DOUBLE PRECISION,
        pdl DOUBLE PRECISION,
        quote_timestamp TIMESTAMPTZ,
        quote_age_seconds INTEGER,
        liquidity_status TEXT,
        validation_status TEXT,
        calculation_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(symbol, minute_bucket, expiry, strike, option_type)
      );
      CREATE INDEX IF NOT EXISTS idx_option_snapshot_1m_contract_time ON option_snapshot_1m (symbol, expiry, strike, option_type, minute_bucket DESC);
      CREATE INDEX IF NOT EXISTS idx_option_snapshot_1m_symbol_time ON option_snapshot_1m (symbol, minute_bucket DESC);

      CREATE TABLE IF NOT EXISTS chain_state_1m (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        minute_bucket TIMESTAMPTZ NOT NULL,
        expiry DATE NOT NULL,
        expiry_bucket TEXT,
        atm_strike INTEGER,
        full_chain_oi_pcr DOUBLE PRECISION,
        band7_oi_pcr DOUBLE PRECISION,
        volume_pcr DOUBLE PRECISION,
        max_pain INTEGER,
        call_wall_strike INTEGER,
        call_wall_oi BIGINT,
        call_wall_strength DOUBLE PRECISION,
        call_wall_distance DOUBLE PRECISION,
        call_wall_migration INTEGER,
        put_wall_strike INTEGER,
        put_wall_oi BIGINT,
        put_wall_strength DOUBLE PRECISION,
        put_wall_distance DOUBLE PRECISION,
        put_wall_migration INTEGER,
        atm_iv DOUBLE PRECISION,
        straddle_ltp DOUBLE PRECISION,
        straddle_change DOUBLE PRECISION,
        validation_status TEXT,
        calculation_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(symbol, expiry, minute_bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_chain_state_1m_symbol_expiry_time ON chain_state_1m (symbol, expiry, minute_bucket DESC);

      CREATE TABLE IF NOT EXISTS timeframe_state (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        block_start TIMESTAMPTZ NOT NULL,
        block_end TIMESTAMPTZ NOT NULL,
        direction TEXT,
        strength TEXT,
        transition TEXT,
        regime TEXT,
        data_quality TEXT,
        state_code TEXT,
        evidence_compact JSONB,
        conflict_compact JSONB,
        rule_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(symbol, timeframe, block_end)
      );
      CREATE INDEX IF NOT EXISTS idx_timeframe_state_symbol_tf_time ON timeframe_state (symbol, timeframe, block_end DESC);

      CREATE TABLE IF NOT EXISTS candidate_history (
        id BIGSERIAL PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        side CHAR(2),
        expiry DATE,
        strike INTEGER,
        dte SMALLINT,
        ltp DOUBLE PRECISION,
        iv DOUBLE PRECISION,
        delta DOUBLE PRECISION,
        gamma DOUBLE PRECISION,
        vega DOUBLE PRECISION,
        theta DOUBLE PRECISION,
        intrinsic DOUBLE PRECISION,
        extrinsic DOUBLE PRECISION,
        spread DOUBLE PRECISION,
        volume BIGINT,
        oi BIGINT,
        grade TEXT,
        status TEXT,
        reason_code TEXT,
        selection_version TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_history_symbol_time ON candidate_history (symbol, observed_at DESC);

      CREATE TABLE IF NOT EXISTS trade_plan_history (
        id BIGSERIAL PRIMARY KEY,
        plan_id TEXT NOT NULL UNIQUE,
        candidate_id TEXT,
        symbol TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        tm_version TEXT,
        entry DOUBLE PRECISION,
        sl DOUBLE PRECISION,
        t1 DOUBLE PRECISION,
        t2 DOUBLE PRECISION,
        t3 DOUBLE PRECISION,
        estimated_lot_loss DOUBLE PRECISION,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS trade_event_history (
        id BIGSERIAL PRIMARY KEY,
        plan_id TEXT NOT NULL,
        event_at TIMESTAMPTZ NOT NULL,
        event_type TEXT NOT NULL,
        premium_ltp DOUBLE PRECISION,
        note_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_trade_event_history_plan_time ON trade_event_history (plan_id, event_at DESC);
    `);
    console.log("[DB] connected, schema ready");
  } catch (err) {
    console.error("[DB] schema init failed -- persistence disabled for this run:", err instanceof Error ? err.message : err);
    pool = null;
  }
}

export async function dbInsert(kind: string, payload: unknown): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query("INSERT INTO app_state_log (kind, payload) VALUES ($1, $2::jsonb)", [kind, JSON.stringify(payload)]);
  } catch (err) {
    console.error(`[DB] insert failed for kind="${kind}" (in-memory state is unaffected, only this DB write was lost):`, err instanceof Error ? err.message : err);
  }
}

export async function dbLoadRecent<T>(kind: string, limit: number): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query("SELECT payload FROM app_state_log WHERE kind = $1 ORDER BY created_at DESC LIMIT $2", [kind, limit]);
    return res.rows.map((r: { payload: T }) => r.payload).reverse();
  } catch (err) {
    console.error(`[DB] load failed for kind="${kind}" (falling back to empty -- app starts as if no history existed):`, err instanceof Error ? err.message : err);
    return [];
  }
}

export async function dbUpsertMarketSnapshot1m(row: MarketSnapshot1mRow): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      INSERT INTO market_snapshot_1m (
        symbol, minute_bucket, snapshot_id, exchange_timestamp, backend_timestamp, freshness_status,
        spot_ltp, spot_open, spot_high, spot_low, spot_prev_close, vwap, pdh, pdl, gap_percent,
        future_ltp, future_vwap, future_oi, future_oi_change, future_volume, future_basis,
        india_vix, india_vix_change, calculation_version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      ) ON CONFLICT (symbol, minute_bucket) DO UPDATE SET
        snapshot_id=EXCLUDED.snapshot_id, exchange_timestamp=EXCLUDED.exchange_timestamp,
        backend_timestamp=EXCLUDED.backend_timestamp, freshness_status=EXCLUDED.freshness_status,
        spot_ltp=EXCLUDED.spot_ltp, spot_open=EXCLUDED.spot_open, spot_high=EXCLUDED.spot_high,
        spot_low=EXCLUDED.spot_low, spot_prev_close=EXCLUDED.spot_prev_close, vwap=EXCLUDED.vwap,
        pdh=EXCLUDED.pdh, pdl=EXCLUDED.pdl, gap_percent=EXCLUDED.gap_percent,
        future_ltp=EXCLUDED.future_ltp, future_vwap=EXCLUDED.future_vwap, future_oi=EXCLUDED.future_oi,
        future_oi_change=EXCLUDED.future_oi_change, future_volume=EXCLUDED.future_volume,
        future_basis=EXCLUDED.future_basis, india_vix=EXCLUDED.india_vix,
        india_vix_change=EXCLUDED.india_vix_change, calculation_version=EXCLUDED.calculation_version
    `, [
      row.symbol,row.minuteBucket,row.snapshotId ?? null,row.exchangeTimestamp ?? null,row.backendTimestamp ?? null,row.freshnessStatus ?? null,
      row.spotLtp ?? null,row.spotOpen ?? null,row.spotHigh ?? null,row.spotLow ?? null,row.spotPrevClose ?? null,row.vwap ?? null,row.pdh ?? null,row.pdl ?? null,row.gapPercent ?? null,
      row.futureLtp ?? null,row.futureVwap ?? null,row.futureOi ?? null,row.futureOiChange ?? null,row.futureVolume ?? null,row.futureBasis ?? null,
      row.indiaVix ?? null,row.indiaVixChange ?? null,row.calculationVersion ?? null,
    ]);
  } catch (err) {
    console.error("[DB] market_snapshot_1m upsert failed:", err instanceof Error ? err.message : err);
  }
}

export async function dbUpsertOptionSnapshot1m(row: OptionSnapshot1mRow): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      INSERT INTO option_snapshot_1m (
        symbol, minute_bucket, snapshot_id, expiry, expiry_bucket, dte, strike, option_type, atm_offset,
        is_candidate, is_wall, ltp, bid, ask, spread, volume, oi, oi_change, iv, delta, gamma, vega, theta,
        intrinsic, extrinsic, day_high, day_low, pdh, pdl, quote_timestamp, quote_age_seconds,
        liquidity_status, validation_status, calculation_version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
      ) ON CONFLICT (symbol, minute_bucket, expiry, strike, option_type) DO UPDATE SET
        snapshot_id=EXCLUDED.snapshot_id, expiry_bucket=EXCLUDED.expiry_bucket, dte=EXCLUDED.dte,
        atm_offset=EXCLUDED.atm_offset, is_candidate=EXCLUDED.is_candidate, is_wall=EXCLUDED.is_wall,
        ltp=EXCLUDED.ltp, bid=EXCLUDED.bid, ask=EXCLUDED.ask, spread=EXCLUDED.spread, volume=EXCLUDED.volume,
        oi=EXCLUDED.oi, oi_change=EXCLUDED.oi_change, iv=EXCLUDED.iv, delta=EXCLUDED.delta, gamma=EXCLUDED.gamma,
        vega=EXCLUDED.vega, theta=EXCLUDED.theta, intrinsic=EXCLUDED.intrinsic, extrinsic=EXCLUDED.extrinsic,
        day_high=EXCLUDED.day_high, day_low=EXCLUDED.day_low, pdh=EXCLUDED.pdh, pdl=EXCLUDED.pdl,
        quote_timestamp=EXCLUDED.quote_timestamp, quote_age_seconds=EXCLUDED.quote_age_seconds,
        liquidity_status=EXCLUDED.liquidity_status, validation_status=EXCLUDED.validation_status,
        calculation_version=EXCLUDED.calculation_version
    `, [
      row.symbol,row.minuteBucket,row.snapshotId ?? null,row.expiry,row.expiryBucket ?? null,row.dte ?? null,row.strike,row.optionType,row.atmOffset ?? null,
      row.isCandidate ?? false,row.isWall ?? false,row.ltp ?? null,row.bid ?? null,row.ask ?? null,row.spread ?? null,row.volume ?? null,row.oi ?? null,row.oiChange ?? null,
      row.iv ?? null,row.delta ?? null,row.gamma ?? null,row.vega ?? null,row.theta ?? null,row.intrinsic ?? null,row.extrinsic ?? null,row.dayHigh ?? null,row.dayLow ?? null,
      row.pdh ?? null,row.pdl ?? null,row.quoteTimestamp ?? null,row.quoteAgeSeconds ?? null,row.liquidityStatus ?? null,row.validationStatus ?? null,row.calculationVersion ?? null,
    ]);
  } catch (err) {
    console.error("[DB] option_snapshot_1m upsert failed:", err instanceof Error ? err.message : err);
  }
}

export async function dbUpsertChainState1m(row: ChainState1mRow): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      INSERT INTO chain_state_1m (
        symbol, minute_bucket, expiry, expiry_bucket, atm_strike, full_chain_oi_pcr, band7_oi_pcr,
        volume_pcr, max_pain, call_wall_strike, call_wall_oi, call_wall_strength, call_wall_distance,
        call_wall_migration, put_wall_strike, put_wall_oi, put_wall_strength, put_wall_distance,
        put_wall_migration, atm_iv, straddle_ltp, straddle_change, validation_status, calculation_version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      ) ON CONFLICT (symbol, expiry, minute_bucket) DO UPDATE SET
        expiry_bucket=EXCLUDED.expiry_bucket, atm_strike=EXCLUDED.atm_strike,
        full_chain_oi_pcr=EXCLUDED.full_chain_oi_pcr, band7_oi_pcr=EXCLUDED.band7_oi_pcr,
        volume_pcr=EXCLUDED.volume_pcr, max_pain=EXCLUDED.max_pain,
        call_wall_strike=EXCLUDED.call_wall_strike, call_wall_oi=EXCLUDED.call_wall_oi,
        call_wall_strength=EXCLUDED.call_wall_strength, call_wall_distance=EXCLUDED.call_wall_distance,
        call_wall_migration=EXCLUDED.call_wall_migration, put_wall_strike=EXCLUDED.put_wall_strike,
        put_wall_oi=EXCLUDED.put_wall_oi, put_wall_strength=EXCLUDED.put_wall_strength,
        put_wall_distance=EXCLUDED.put_wall_distance, put_wall_migration=EXCLUDED.put_wall_migration,
        atm_iv=EXCLUDED.atm_iv, straddle_ltp=EXCLUDED.straddle_ltp, straddle_change=EXCLUDED.straddle_change,
        validation_status=EXCLUDED.validation_status, calculation_version=EXCLUDED.calculation_version
    `, [
      row.symbol,row.minuteBucket,row.expiry,row.expiryBucket ?? null,row.atmStrike ?? null,row.fullChainOiPcr ?? null,row.band7OiPcr ?? null,
      row.volumePcr ?? null,row.maxPain ?? null,row.callWallStrike ?? null,row.callWallOi ?? null,row.callWallStrength ?? null,row.callWallDistance ?? null,
      row.callWallMigration ?? null,row.putWallStrike ?? null,row.putWallOi ?? null,row.putWallStrength ?? null,row.putWallDistance ?? null,row.putWallMigration ?? null,
      row.atmIv ?? null,row.straddleLtp ?? null,row.straddleChange ?? null,row.validationStatus ?? null,row.calculationVersion ?? null,
    ]);
  } catch (err) {
    console.error("[DB] chain_state_1m upsert failed:", err instanceof Error ? err.message : err);
  }
}

export async function dbQuerySafe<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[] } | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(sql, params);
    return { rows: res.rows as T[] };
  } catch (err) {
    console.error("[DB] normalized research query failed (caller must degrade safely):", err instanceof Error ? err.message : err);
    return null;
  }
}

export function dbIsConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}
