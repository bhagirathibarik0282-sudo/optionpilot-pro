import { createHash } from "node:crypto";
import { dbQuerySafe } from "./db.js";
import { auditOptionModelTruth, type OptionModelTruthAudit } from "./iv-greeks-provenance.js";
import type { OptionSnapshot1mRow } from "./db.js";

export interface OptionModelTruthRecord {
  symbol: string;
  minuteBucket: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  audit: OptionModelTruthAudit;
  payload: Record<string, unknown>;
}

function id(row: OptionModelTruthRecord): string {
  return createHash("sha256")
    .update([row.symbol,row.minuteBucket,row.expiry,row.strike,row.optionType,row.audit.provenanceVersion,JSON.stringify(row.payload)].join("|"))
    .digest("hex");
}

export function optionModelTruthSchemaSql(): string {
  return `
    CREATE TABLE IF NOT EXISTS option_model_truth_1m (
      observation_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      minute_bucket TIMESTAMPTZ NOT NULL,
      expiry DATE NOT NULL,
      strike INTEGER NOT NULL,
      option_type CHAR(2) NOT NULL,
      iv_state TEXT NOT NULL,
      greeks_state TEXT NOT NULL,
      usability TEXT NOT NULL,
      iv_permission BOOLEAN NOT NULL,
      greek_permission BOOLEAN NOT NULL,
      reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      provenance_version TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_option_model_truth_lookup
      ON option_model_truth_1m (symbol, minute_bucket DESC, expiry, strike, option_type);
  `;
}

let schemaReady = false;
async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return true;
  const q = await dbQuerySafe(optionModelTruthSchemaSql());
  schemaReady = q !== null;
  return schemaReady;
}

export function unknownSnapshotModelTruth(row: OptionSnapshot1mRow): OptionModelTruthRecord {
  const audit = auditOptionModelTruth({
    iv: row.iv,
    delta: row.delta,
    gamma: row.gamma,
    vega: row.vega,
    theta: row.theta,
    ivSource: "UNKNOWN",
    greeksSource: "UNKNOWN",
  });
  return {
    symbol: row.symbol,
    minuteBucket: row.minuteBucket,
    expiry: row.expiry,
    strike: row.strike,
    optionType: row.optionType,
    audit,
    payload: {
      iv: row.iv,
      delta: row.delta,
      gamma: row.gamma,
      vega: row.vega,
      theta: row.theta,
      source: "EXISTING_SNAPSHOT_WITHOUT_MODEL_PROVENANCE",
    },
  };
}

export async function persistUnknownModelTruthForOptions(rows: OptionSnapshot1mRow[]): Promise<number> {
  if (!rows.length || !(await ensureSchema())) return 0;
  let writes = 0;
  for (const option of rows) {
    const row = unknownSnapshotModelTruth(option);
    const q = await dbQuerySafe(`
      INSERT INTO option_model_truth_1m (
        observation_id,symbol,minute_bucket,expiry,strike,option_type,
        iv_state,greeks_state,usability,iv_permission,greek_permission,
        reasons,provenance_version,payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb)
      ON CONFLICT (observation_id) DO NOTHING
      RETURNING observation_id
    `, [
      id(row), row.symbol, row.minuteBucket, row.expiry, row.strike, row.optionType,
      row.audit.ivState, row.audit.greeksState, row.audit.usability,
      row.audit.ivPermission, row.audit.greekPermission,
      JSON.stringify(row.audit.reasons), row.audit.provenanceVersion, JSON.stringify(row.payload),
    ]);
    if (q?.rows?.length) writes += 1;
  }
  return writes;
}

export interface AtmModelPermission {
  ivAllowed: boolean;
  greekAllowed: boolean;
  reason: string;
}

export async function getAtmModelTruthPermission(symbol: string, minuteBucket: string | null): Promise<AtmModelPermission> {
  if (!minuteBucket) return { ivAllowed: false, greekAllowed: false, reason: "NO_MINUTE_BUCKET" };
  if (!(await ensureSchema())) return { ivAllowed: false, greekAllowed: false, reason: "MODEL_TRUTH_SCHEMA_UNAVAILABLE" };
  const q = await dbQuerySafe<{ option_type: string; iv_permission: boolean; greek_permission: boolean }>(`
    SELECT omt.option_type, omt.iv_permission, omt.greek_permission
    FROM option_model_truth_1m omt
    JOIN option_snapshot_1m os
      ON os.symbol = omt.symbol
     AND os.minute_bucket = omt.minute_bucket
     AND os.expiry = omt.expiry
     AND os.strike = omt.strike
     AND os.option_type = omt.option_type
    WHERE omt.symbol = $1
      AND omt.minute_bucket = $2::timestamptz
      AND os.atm_offset = 0
    ORDER BY omt.created_at DESC
  `, [symbol, minuteBucket]);
  const rows = q?.rows ?? [];
  const ce = rows.find((r) => r.option_type === "CE");
  const pe = rows.find((r) => r.option_type === "PE");
  if (!ce || !pe) return { ivAllowed: false, greekAllowed: false, reason: "ATM_MODEL_TRUTH_INCOMPLETE" };
  return {
    ivAllowed: Boolean(ce.iv_permission && pe.iv_permission),
    greekAllowed: Boolean(ce.greek_permission && pe.greek_permission),
    reason: ce.greek_permission && pe.greek_permission ? "MODEL_TRUTH_VALID" : "MODEL_PROVENANCE_NOT_VERIFIED",
  };
}
