import { createHash } from "node:crypto";
import { dbQuerySafe, type MarketSnapshot1mRow, type OptionSnapshot1mRow, type ChainState1mRow } from "./db.js";
import type { SourceTruthPersistenceRecord } from "./source-truth-db.js";
import { deriveCompatibleDelta, deriveWallMigration, type DeltaResult } from "./source-truth-storage.js";

export type RestartMetric =
  | "FUTURE_OI_CHANGE"
  | "OPTION_OI_CHANGE"
  | "CALL_WALL_MIGRATION"
  | "PUT_WALL_MIGRATION"
  | "STRADDLE_CHANGE";

export type RestartReconstructionState =
  | "DERIVED"
  | "POLICY_UNCONFIGURED"
  | "CURRENT_TRUTH_BLOCKED"
  | "NO_PREVIOUS_VALID"
  | "IDENTITY_MISMATCH"
  | "SESSION_GAP"
  | "CADENCE_GAP"
  | "NON_NUMERIC"
  | "DB_UNAVAILABLE";

export interface RestartReconstructionAudit {
  symbol: string;
  minuteBucket: string;
  metric: RestartMetric;
  expiry: string | null;
  strike: number | null;
  optionType: "CE" | "PE" | null;
  currentValue: number | null;
  previousValue: number | null;
  previousMinuteBucket: string | null;
  derivedValue: number | null;
  state: RestartReconstructionState;
  maxCadenceMs: number | null;
  calculationVersion: "RESTART_SAFE_DERIVATIVES_V1";
}

export interface RestartSafeReconstructionResult {
  market: MarketSnapshot1mRow;
  options: OptionSnapshot1mRow[];
  chains: ChainState1mRow[];
  audits: RestartReconstructionAudit[];
}

const INDIA_TIME_ZONE = "Asia/Kolkata";

function sessionDateIst(timestamp: string): string | null {
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return y && m && day ? `${y}-${m}-${day}` : null;
}

export function restartDerivativeCadenceMs(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = Number(env.SOURCE_TRUTH_DERIVATIVE_MAX_CADENCE_MS);
  // No hidden production threshold. The cadence must be explicitly configured.
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function exactTruthUsable(row: SourceTruthPersistenceRecord | null | undefined): boolean {
  return !!row && row.freshnessState === "FRESH" && row.identityState === "VALID" &&
    row.qualityState === "VALID" && row.usability === "USABLE";
}

function mapDeltaState(delta: DeltaResult): RestartReconstructionState {
  if (delta.usable && delta.reason === "OK") return "DERIVED";
  if (delta.reason === "NO_PREVIOUS_VALID") return "NO_PREVIOUS_VALID";
  if (delta.reason === "IDENTITY_MISMATCH") return "IDENTITY_MISMATCH";
  if (delta.reason === "SESSION_GAP") return "SESSION_GAP";
  if (delta.reason === "CADENCE_GAP") return "CADENCE_GAP";
  if (delta.reason === "NON_NUMERIC") return "NON_NUMERIC";
  return "CURRENT_TRUTH_BLOCKED";
}

export function reconstructCompatibleMetric(args: {
  symbol: string;
  currentMinuteBucket: string;
  currentValue: number | null;
  currentTruthUsable: boolean;
  previousMinuteBucket?: string | null;
  previousValue?: number | null;
  previousTruthUsable?: boolean;
  expiry?: string | null;
  strike?: number | null;
  optionType?: "CE" | "PE" | null;
  maxCadenceMs: number | null;
}): { delta: DeltaResult | null; state: RestartReconstructionState } {
  if (args.maxCadenceMs == null) return { delta: null, state: "POLICY_UNCONFIGURED" };
  if (!args.currentTruthUsable) return { delta: null, state: "CURRENT_TRUTH_BLOCKED" };
  const currentSession = sessionDateIst(args.currentMinuteBucket);
  const previousSession = args.previousMinuteBucket ? sessionDateIst(args.previousMinuteBucket) : null;
  const current = {
    symbol: args.symbol,
    observedAt: args.currentMinuteBucket,
    sessionDate: currentSession ?? "INVALID",
    expiry: args.expiry ?? null,
    strike: args.strike ?? null,
    optionType: args.optionType ?? null,
    value: args.currentValue,
    usability: "USABLE" as const,
  };
  const previous = args.previousMinuteBucket ? {
    symbol: args.symbol,
    observedAt: args.previousMinuteBucket,
    sessionDate: previousSession ?? "INVALID",
    expiry: args.expiry ?? null,
    strike: args.strike ?? null,
    optionType: args.optionType ?? null,
    value: args.previousValue ?? null,
    usability: args.previousTruthUsable ? "USABLE" as const : "BLOCKED" as const,
  } : null;
  const delta = deriveCompatibleDelta(current, previous, args.maxCadenceMs);
  return { delta, state: mapDeltaState(delta) };
}

type PreviousValueRow = { minute_bucket: string | Date; value: number | null };

async function previousFutureOi(symbol: string, minuteBucket: string, expiry: string): Promise<PreviousValueRow | null | "DB_UNAVAILABLE"> {
  const q = await dbQuerySafe<PreviousValueRow>(`
    SELECT ms.minute_bucket, ms.future_oi AS value
    FROM market_snapshot_1m ms
    JOIN source_truth_observation_1m st
      ON st.symbol = ms.symbol AND st.minute_bucket = ms.minute_bucket
    WHERE ms.symbol = $1
      AND ms.minute_bucket < $2::timestamptz
      AND st.record_kind = 'FUTURES'
      AND st.identity->>'expiry' = $3
      AND st.freshness_state = 'FRESH'
      AND st.identity_state = 'VALID'
      AND st.quality_state = 'VALID'
      AND st.usability = 'USABLE'
      AND ms.future_oi IS NOT NULL
    ORDER BY ms.minute_bucket DESC
    LIMIT 1
  `, [symbol, minuteBucket, expiry]);
  if (q === null) return "DB_UNAVAILABLE";
  return q.rows[0] ?? null;
}

async function previousOptionOi(row: OptionSnapshot1mRow): Promise<PreviousValueRow | null | "DB_UNAVAILABLE"> {
  const q = await dbQuerySafe<PreviousValueRow>(`
    SELECT os.minute_bucket, os.oi AS value
    FROM option_snapshot_1m os
    JOIN source_truth_observation_1m st
      ON st.symbol = os.symbol
     AND st.minute_bucket = os.minute_bucket
     AND st.expiry = os.expiry
     AND st.strike = os.strike
     AND st.option_type = os.option_type
    WHERE os.symbol = $1
      AND os.minute_bucket < $2::timestamptz
      AND os.expiry = $3::date
      AND os.strike = $4
      AND os.option_type = $5
      AND st.record_kind = 'OPTION'
      AND st.freshness_state = 'FRESH'
      AND st.identity_state = 'VALID'
      AND st.quality_state = 'VALID'
      AND st.usability = 'USABLE'
      AND os.oi IS NOT NULL
    ORDER BY os.minute_bucket DESC
    LIMIT 1
  `, [row.symbol, row.minuteBucket, row.expiry, row.strike, row.optionType]);
  if (q === null) return "DB_UNAVAILABLE";
  return q.rows[0] ?? null;
}

async function previousChainValue(row: ChainState1mRow, column: "call_wall_strike" | "put_wall_strike" | "straddle_ltp"): Promise<PreviousValueRow | null | "DB_UNAVAILABLE"> {
  const q = await dbQuerySafe<PreviousValueRow>(`
    SELECT cs.minute_bucket, cs.${column} AS value
    FROM chain_state_1m cs
    JOIN source_truth_observation_1m st
      ON st.symbol = cs.symbol AND st.minute_bucket = cs.minute_bucket AND st.expiry = cs.expiry
    WHERE cs.symbol = $1
      AND cs.minute_bucket < $2::timestamptz
      AND cs.expiry = $3::date
      AND st.record_kind = 'CHAIN'
      AND st.freshness_state = 'FRESH'
      AND st.identity_state = 'VALID'
      AND st.quality_state = 'VALID'
      AND st.usability = 'USABLE'
      AND cs.${column} IS NOT NULL
    ORDER BY cs.minute_bucket DESC
    LIMIT 1
  `, [row.symbol, row.minuteBucket, row.expiry]);
  if (q === null) return "DB_UNAVAILABLE";
  return q.rows[0] ?? null;
}

function truthFor(truth: SourceTruthPersistenceRecord[], args: { kind: "FUTURES" | "OPTION" | "CHAIN"; expiry?: string | null; strike?: number | null; optionType?: "CE" | "PE" | null }): SourceTruthPersistenceRecord | undefined {
  return truth.find((t) => t.recordKind === args.kind &&
    (args.expiry == null || (t.expiry ?? null) === args.expiry) &&
    (args.strike == null || (t.strike ?? null) === args.strike) &&
    (args.optionType == null || (t.optionType ?? null) === args.optionType));
}

function audit(args: Omit<RestartReconstructionAudit, "calculationVersion">): RestartReconstructionAudit {
  return { ...args, calculationVersion: "RESTART_SAFE_DERIVATIVES_V1" };
}

/**
 * Shadow-only restart-safe reconstruction. It never bridges sessions, expiries,
 * strikes, sides or an explicitly configured cadence. Missing history stays null.
 */
export async function reconstructRestartSafeDerivatives(
  marketInput: MarketSnapshot1mRow,
  optionInputs: OptionSnapshot1mRow[],
  chainInputs: ChainState1mRow[],
  promotedTruth: SourceTruthPersistenceRecord[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestartSafeReconstructionResult> {
  const maxCadenceMs = restartDerivativeCadenceMs(env);
  const market = { ...marketInput };
  const options = optionInputs.map((row) => ({ ...row }));
  const chains = chainInputs.map((row) => ({ ...row }));
  const audits: RestartReconstructionAudit[] = [];

  const futureTruth = truthFor(promotedTruth, { kind: "FUTURES" });
  const futureExpiry = futureTruth?.identity?.expiry ?? futureTruth?.expiry ?? null;
  if (market.futureOi != null && futureExpiry) {
    const prev = maxCadenceMs == null ? null : await previousFutureOi(market.symbol, market.minuteBucket, futureExpiry);
    if (prev === "DB_UNAVAILABLE") {
      audits.push(audit({ symbol: market.symbol, minuteBucket: market.minuteBucket, metric: "FUTURE_OI_CHANGE", expiry: futureExpiry, strike: null, optionType: null, currentValue: market.futureOi, previousValue: null, previousMinuteBucket: null, derivedValue: null, state: "DB_UNAVAILABLE", maxCadenceMs }));
    } else {
      const r = reconstructCompatibleMetric({ symbol: market.symbol, currentMinuteBucket: market.minuteBucket, currentValue: market.futureOi, currentTruthUsable: exactTruthUsable(futureTruth), previousMinuteBucket: prev ? new Date(prev.minute_bucket).toISOString() : null, previousValue: prev?.value ?? null, previousTruthUsable: !!prev, expiry: futureExpiry, maxCadenceMs });
      market.futureOiChange = r.delta?.usable ? r.delta.value : null;
      audits.push(audit({ symbol: market.symbol, minuteBucket: market.minuteBucket, metric: "FUTURE_OI_CHANGE", expiry: futureExpiry, strike: null, optionType: null, currentValue: market.futureOi, previousValue: prev?.value ?? null, previousMinuteBucket: prev ? new Date(prev.minute_bucket).toISOString() : null, derivedValue: market.futureOiChange ?? null, state: r.state, maxCadenceMs }));
    }
  }

  for (const row of options) {
    if (row.oi == null) continue;
    const currentTruth = truthFor(promotedTruth, { kind: "OPTION", expiry: row.expiry, strike: row.strike, optionType: row.optionType });
    const prev = maxCadenceMs == null ? null : await previousOptionOi(row);
    if (prev === "DB_UNAVAILABLE") {
      audits.push(audit({ symbol: row.symbol, minuteBucket: row.minuteBucket, metric: "OPTION_OI_CHANGE", expiry: row.expiry, strike: row.strike, optionType: row.optionType, currentValue: row.oi, previousValue: null, previousMinuteBucket: null, derivedValue: null, state: "DB_UNAVAILABLE", maxCadenceMs }));
      continue;
    }
    const r = reconstructCompatibleMetric({ symbol: row.symbol, currentMinuteBucket: row.minuteBucket, currentValue: row.oi, currentTruthUsable: exactTruthUsable(currentTruth), previousMinuteBucket: prev ? new Date(prev.minute_bucket).toISOString() : null, previousValue: prev?.value ?? null, previousTruthUsable: !!prev, expiry: row.expiry, strike: row.strike, optionType: row.optionType, maxCadenceMs });
    row.oiChange = r.delta?.usable ? r.delta.value : null;
    audits.push(audit({ symbol: row.symbol, minuteBucket: row.minuteBucket, metric: "OPTION_OI_CHANGE", expiry: row.expiry, strike: row.strike, optionType: row.optionType, currentValue: row.oi, previousValue: prev?.value ?? null, previousMinuteBucket: prev ? new Date(prev.minute_bucket).toISOString() : null, derivedValue: row.oiChange ?? null, state: r.state, maxCadenceMs }));
  }

  for (const row of chains) {
    const currentTruth = truthFor(promotedTruth, { kind: "CHAIN", expiry: row.expiry });
    const specs: Array<{ metric: RestartMetric; column: "call_wall_strike" | "put_wall_strike" | "straddle_ltp"; current: number | null | undefined; set: (v: number | null) => void }> = [
      { metric: "CALL_WALL_MIGRATION", column: "call_wall_strike", current: row.callWallStrike, set: (v) => { row.callWallMigration = v; } },
      { metric: "PUT_WALL_MIGRATION", column: "put_wall_strike", current: row.putWallStrike, set: (v) => { row.putWallMigration = v; } },
      { metric: "STRADDLE_CHANGE", column: "straddle_ltp", current: row.straddleLtp, set: (v) => { row.straddleChange = v; } },
    ];
    for (const spec of specs) {
      if (spec.current == null) continue;
      const prev = maxCadenceMs == null ? null : await previousChainValue(row, spec.column);
      if (prev === "DB_UNAVAILABLE") {
        audits.push(audit({ symbol: row.symbol, minuteBucket: row.minuteBucket, metric: spec.metric, expiry: row.expiry, strike: null, optionType: null, currentValue: spec.current, previousValue: null, previousMinuteBucket: null, derivedValue: null, state: "DB_UNAVAILABLE", maxCadenceMs }));
        continue;
      }
      const r = reconstructCompatibleMetric({ symbol: row.symbol, currentMinuteBucket: row.minuteBucket, currentValue: spec.current, currentTruthUsable: exactTruthUsable(currentTruth), previousMinuteBucket: prev ? new Date(prev.minute_bucket).toISOString() : null, previousValue: prev?.value ?? null, previousTruthUsable: !!prev, expiry: row.expiry, maxCadenceMs });
      spec.set(r.delta?.usable ? r.delta.value : null);
      audits.push(audit({ symbol: row.symbol, minuteBucket: row.minuteBucket, metric: spec.metric, expiry: row.expiry, strike: null, optionType: null, currentValue: spec.current, previousValue: prev?.value ?? null, previousMinuteBucket: prev ? new Date(prev.minute_bucket).toISOString() : null, derivedValue: r.delta?.usable ? r.delta.value : null, state: r.state, maxCadenceMs }));
    }
  }

  return { market, options, chains, audits };
}

export function restartReconstructionSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS derivative_reconstruction_truth_1m (
      observation_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      minute_bucket TIMESTAMPTZ NOT NULL,
      metric TEXT NOT NULL,
      expiry DATE,
      strike INTEGER,
      option_type CHAR(2),
      current_value DOUBLE PRECISION,
      previous_value DOUBLE PRECISION,
      previous_minute_bucket TIMESTAMPTZ,
      derived_value DOUBLE PRECISION,
      state TEXT NOT NULL,
      max_cadence_ms BIGINT,
      calculation_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_derivative_reconstruction_lookup
      ON derivative_reconstruction_truth_1m (symbol, minute_bucket DESC, metric, expiry, strike, option_type);
  `;
}

function auditId(row: RestartReconstructionAudit): string {
  return createHash("sha256").update(JSON.stringify([
    row.symbol,row.minuteBucket,row.metric,row.expiry,row.strike,row.optionType,
    row.currentValue,row.previousValue,row.previousMinuteBucket,row.derivedValue,row.state,row.maxCadenceMs,row.calculationVersion,
  ])).digest("hex");
}

let schemaReady = false;
export async function persistRestartReconstructionAudits(rows: RestartReconstructionAudit[]): Promise<number> {
  if (!rows.length) return 0;
  if (!schemaReady) {
    const schema = await dbQuerySafe(restartReconstructionSchemaSql());
    schemaReady = schema !== null;
    if (!schemaReady) return 0;
  }
  let writes = 0;
  for (const row of rows) {
    const q = await dbQuerySafe(`
      INSERT INTO derivative_reconstruction_truth_1m (
        observation_id,symbol,minute_bucket,metric,expiry,strike,option_type,current_value,
        previous_value,previous_minute_bucket,derived_value,state,max_cadence_ms,calculation_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (observation_id) DO NOTHING
      RETURNING observation_id
    `, [auditId(row),row.symbol,row.minuteBucket,row.metric,row.expiry,row.strike,row.optionType,row.currentValue,row.previousValue,row.previousMinuteBucket,row.derivedValue,row.state,row.maxCadenceMs,row.calculationVersion]);
    if (q?.rows?.length) writes += 1;
  }
  return writes;
}
