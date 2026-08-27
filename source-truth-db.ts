import { createHash } from "node:crypto";
import { dbQuerySafe } from "./db.js";
import type {
  ContractIdentity,
  EvidenceUsability,
  FreshnessState,
  IdentityState,
  QualityState,
  SourceProvider,
  SourceTruthReasonCode,
} from "./source-truth-types.js";

export type SourceTruthRecordKind = "MARKET" | "FUTURES" | "OPTION" | "CHAIN";

export interface SourceTruthPersistenceRecord {
  recordKind: SourceTruthRecordKind;
  symbol: string;
  minuteBucket: string;
  expiry?: string | null;
  strike?: number | null;
  optionType?: "CE" | "PE" | null;
  sourceProvider: SourceProvider;
  sourceTimestamp: string | null;
  receivedAt: string;
  computedAt?: string | null;
  dataAgeMs: number | null;
  freshnessState: FreshnessState;
  identityState: IdentityState;
  qualityState: QualityState;
  usability: EvidenceUsability;
  reasonCodes: SourceTruthReasonCode[];
  identity?: ContractIdentity | null;
  sourceVersion?: string | null;
  calculationVersion?: string | null;
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${k}:${canonical(obj[k])}`).join(",")}}`;
  }
  return String(value);
}

/** Stable event id for de-duplicating the same known-then observation without overwriting it. */
export function sourceTruthObservationId(row: SourceTruthPersistenceRecord): string {
  const key = {
    kind: row.recordKind,
    symbol: row.symbol,
    minuteBucket: row.minuteBucket,
    expiry: row.expiry ?? null,
    strike: row.strike ?? null,
    optionType: row.optionType ?? null,
    sourceProvider: row.sourceProvider,
    sourceTimestamp: row.sourceTimestamp,
    receivedAt: row.sourceTimestamp ? null : row.receivedAt,
    identity: row.identity ?? null,
  };
  return createHash("sha256").update(canonical(key)).digest("hex");
}

export function sourceTruthSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS source_truth_observation_1m (
      observation_id TEXT PRIMARY KEY,
      record_kind TEXT NOT NULL,
      symbol TEXT NOT NULL,
      minute_bucket TIMESTAMPTZ NOT NULL,
      expiry DATE,
      strike INTEGER,
      option_type CHAR(2),
      source_provider TEXT NOT NULL,
      source_timestamp TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL,
      computed_at TIMESTAMPTZ,
      data_age_ms BIGINT,
      freshness_state TEXT NOT NULL,
      identity_state TEXT NOT NULL,
      quality_state TEXT NOT NULL,
      usability TEXT NOT NULL,
      reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      identity JSONB,
      source_version TEXT,
      calculation_version TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_source_truth_symbol_time
      ON source_truth_observation_1m (symbol, minute_bucket DESC);
    CREATE INDEX IF NOT EXISTS idx_source_truth_contract_time
      ON source_truth_observation_1m (symbol, expiry, strike, option_type, minute_bucket DESC);

    CREATE TABLE IF NOT EXISTS source_truth_revision_log (
      id BIGSERIAL PRIMARY KEY,
      observation_id TEXT NOT NULL,
      supersedes_observation_id TEXT,
      reason_code TEXT NOT NULL,
      old_payload_hash TEXT,
      new_payload_hash TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_source_truth_revision_observation
      ON source_truth_revision_log (observation_id, created_at DESC);
  `;
}

let schemaReady = false;
let schemaAttempt: Promise<boolean> | null = null;

export async function ensureSourceTruthSchema(): Promise<boolean> {
  if (schemaReady) return true;
  if (schemaAttempt) return schemaAttempt;
  schemaAttempt = (async () => {
    const result = await dbQuerySafe(sourceTruthSchemaSql());
    schemaReady = result !== null;
    if (!schemaReady) schemaAttempt = null;
    return schemaReady;
  })();
  return schemaAttempt;
}

export async function persistSourceTruthRecords(rows: SourceTruthPersistenceRecord[]): Promise<number> {
  if (!rows.length) return 0;
  if (!(await ensureSourceTruthSchema())) return 0;

  let writes = 0;
  for (const row of rows) {
    const observationId = sourceTruthObservationId(row);
    const result = await dbQuerySafe<{ observation_id: string }>(`
      INSERT INTO source_truth_observation_1m (
        observation_id, record_kind, symbol, minute_bucket, expiry, strike, option_type,
        source_provider, source_timestamp, received_at, computed_at, data_age_ms,
        freshness_state, identity_state, quality_state, usability, reason_codes,
        identity, source_version, calculation_version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20
      )
      ON CONFLICT (observation_id) DO NOTHING
      RETURNING observation_id
    `, [
      observationId,
      row.recordKind,
      row.symbol,
      row.minuteBucket,
      row.expiry ?? null,
      row.strike ?? null,
      row.optionType ?? null,
      row.sourceProvider,
      row.sourceTimestamp,
      row.receivedAt,
      row.computedAt ?? null,
      row.dataAgeMs,
      row.freshnessState,
      row.identityState,
      row.qualityState,
      row.usability,
      JSON.stringify(row.reasonCodes),
      JSON.stringify(row.identity ?? null),
      row.sourceVersion ?? null,
      row.calculationVersion ?? null,
    ]);
    if (result?.rows?.length) writes += 1;
  }
  return writes;
}

export function sourceTruthShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.SOURCE_TRUTH_SHADOW ?? ""));
}
