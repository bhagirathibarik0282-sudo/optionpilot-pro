import type { Hono } from "hono";
import { dbIsConfigured, dbQuerySafe } from "./db.js";

export type OwnerHealthState = "HEALTHY" | "DEGRADED" | "BLOCKED" | "UNKNOWN" | "NO_DATA";

export interface SourceHealthRow {
  symbol: string;
  record_kind: "MARKET" | "FUTURES" | "OPTION" | "CHAIN";
  minute_bucket: string | Date;
  freshness_state: string;
  identity_state: string;
  quality_state: string;
  usability: string;
  data_age_ms: number | string | null;
  reason_codes: unknown;
  row_count: number | string;
  usable_count: number | string;
  blocked_count: number | string;
}

export interface ReconstructionHealthRow {
  symbol: string;
  minute_bucket: string | Date;
  metric: string;
  state: string;
  derived_value: number | null;
}

export interface ModelHealthRow {
  symbol: string;
  minute_bucket: string | Date;
  iv_permission_count: number | string;
  greek_permission_count: number | string;
  total_count: number | string;
}

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function reasons(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map(String))];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return [...new Set(parsed.map(String))];
    } catch {}
  }
  return [];
}

export function classifyOwnerHealth(row: Pick<SourceHealthRow, "freshness_state" | "identity_state" | "quality_state" | "usability" | "row_count" | "usable_count" | "blocked_count">): OwnerHealthState {
  const total = num(row.row_count);
  const usable = num(row.usable_count);
  const blocked = num(row.blocked_count);
  if (total <= 0) return "NO_DATA";
  if (row.usability === "BLOCKED" || row.freshness_state === "STALE" || row.identity_state === "MISMATCH" || row.identity_state === "AMBIGUOUS" || row.quality_state === "INVALID" || blocked > 0) return "BLOCKED";
  if (row.freshness_state === "UNKNOWN" || row.identity_state === "UNKNOWN" || row.quality_state === "UNKNOWN") return "UNKNOWN";
  if (row.usability === "CONTEXT_ONLY" || row.freshness_state === "AGING" || row.identity_state === "PARTIAL" || row.quality_state === "PARTIAL" || usable < total) return "DEGRADED";
  return usable === total ? "HEALTHY" : "UNKNOWN";
}

export function sourceHealthSql(): string {
  return `
    WITH latest_minute AS (
      SELECT symbol, record_kind, MAX(minute_bucket) AS minute_bucket
      FROM source_truth_observation_1m
      WHERE symbol IN ('NIFTY','BANKNIFTY','SENSEX')
      GROUP BY symbol, record_kind
    ), latest_rows AS (
      SELECT st.*
      FROM source_truth_observation_1m st
      JOIN latest_minute lm
        ON lm.symbol = st.symbol AND lm.record_kind = st.record_kind AND lm.minute_bucket = st.minute_bucket
    ), base AS (
      SELECT
        symbol, record_kind, minute_bucket,
        CASE
          WHEN BOOL_OR(freshness_state = 'STALE') THEN 'STALE'
          WHEN BOOL_OR(freshness_state = 'UNKNOWN') THEN 'UNKNOWN'
          WHEN BOOL_OR(freshness_state = 'AGING') THEN 'AGING'
          ELSE 'FRESH'
        END AS freshness_state,
        CASE
          WHEN BOOL_OR(identity_state IN ('MISMATCH','AMBIGUOUS')) THEN 'MISMATCH'
          WHEN BOOL_OR(identity_state = 'UNKNOWN') THEN 'UNKNOWN'
          WHEN BOOL_OR(identity_state = 'PARTIAL') THEN 'PARTIAL'
          ELSE 'VALID'
        END AS identity_state,
        CASE
          WHEN BOOL_OR(quality_state = 'INVALID') THEN 'INVALID'
          WHEN BOOL_OR(quality_state = 'UNKNOWN') THEN 'UNKNOWN'
          WHEN BOOL_OR(quality_state = 'PARTIAL') THEN 'PARTIAL'
          ELSE 'VALID'
        END AS quality_state,
        CASE
          WHEN BOOL_OR(usability = 'BLOCKED') THEN 'BLOCKED'
          WHEN BOOL_OR(usability = 'CONTEXT_ONLY') THEN 'CONTEXT_ONLY'
          ELSE 'USABLE'
        END AS usability,
        MAX(data_age_ms) AS data_age_ms,
        COUNT(*)::bigint AS row_count,
        COUNT(*) FILTER (WHERE usability = 'USABLE')::bigint AS usable_count,
        COUNT(*) FILTER (WHERE usability = 'BLOCKED')::bigint AS blocked_count
      FROM latest_rows
      GROUP BY symbol, record_kind, minute_bucket
    ), reason_agg AS (
      SELECT lr.symbol, lr.record_kind, lr.minute_bucket,
        COALESCE(jsonb_agg(DISTINCT reason.value) FILTER (WHERE reason.value IS NOT NULL), '[]'::jsonb) AS reason_codes
      FROM latest_rows lr
      LEFT JOIN LATERAL jsonb_array_elements_text(lr.reason_codes) reason(value) ON TRUE
      GROUP BY lr.symbol, lr.record_kind, lr.minute_bucket
    )
    SELECT b.*, r.reason_codes
    FROM base b
    JOIN reason_agg r USING (symbol, record_kind, minute_bucket)
    ORDER BY b.symbol, b.record_kind
  `;
}

export function reconstructionHealthSql(): string {
  return `
    SELECT DISTINCT ON (symbol, metric)
      symbol, minute_bucket, metric, state, derived_value
    FROM derivative_reconstruction_truth_1m
    WHERE symbol IN ('NIFTY','BANKNIFTY','SENSEX')
    ORDER BY symbol, metric, minute_bucket DESC, created_at DESC
  `;
}

export function modelHealthSql(): string {
  return `
    WITH latest AS (
      SELECT symbol, MAX(minute_bucket) AS minute_bucket
      FROM option_model_truth_1m
      WHERE symbol IN ('NIFTY','BANKNIFTY','SENSEX')
      GROUP BY symbol
    )
    SELECT omt.symbol, omt.minute_bucket,
      COUNT(*) FILTER (WHERE omt.iv_permission)::bigint AS iv_permission_count,
      COUNT(*) FILTER (WHERE omt.greek_permission)::bigint AS greek_permission_count,
      COUNT(*)::bigint AS total_count
    FROM option_model_truth_1m omt
    JOIN latest l ON l.symbol = omt.symbol AND l.minute_bucket = omt.minute_bucket
    GROUP BY omt.symbol, omt.minute_bucket
    ORDER BY omt.symbol
  `;
}

export function mountSourceHealthRoutes(app: Hono): void {
  app.get("/api/source-truth/health", async (c) => {
    c.header("Cache-Control", "no-store");
    const generatedAt = new Date().toISOString();
    if (!dbIsConfigured()) {
      return c.json({
        status: "DB_NOT_CONFIGURED",
        dbConnected: false,
        generatedAt,
        symbols: {},
        readOnly: true,
        shadowOnly: true,
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      });
    }

    const [source, reconstruction, model] = await Promise.all([
      dbQuerySafe<SourceHealthRow>(sourceHealthSql()),
      dbQuerySafe<ReconstructionHealthRow>(reconstructionHealthSql()),
      dbQuerySafe<ModelHealthRow>(modelHealthSql()),
    ]);
    if (!source || !reconstruction || !model) {
      return c.json({
        status: "DB_QUERY_FAILED",
        dbConnected: false,
        generatedAt,
        symbols: {},
        readOnly: true,
        shadowOnly: true,
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      }, 503);
    }

    const symbols: Record<string, unknown> = {};
    for (const symbol of ["NIFTY","BANKNIFTY","SENSEX"]) {
      const families = source.rows.filter((r) => r.symbol === symbol).map((r) => {
        const state = classifyOwnerHealth(r);
        return {
          family: r.record_kind,
          state,
          minuteBucket: iso(r.minute_bucket),
          freshness: r.freshness_state,
          identity: r.identity_state,
          quality: r.quality_state,
          usability: r.usability,
          dataAgeMs: r.data_age_ms == null ? null : num(r.data_age_ms),
          reasons: reasons(r.reason_codes),
          counts: { total: num(r.row_count), usable: num(r.usable_count), blocked: num(r.blocked_count) },
          newEvidenceAllowed: state === "HEALTHY",
        };
      });
      const reconstructionRows = reconstruction.rows.filter((r) => r.symbol === symbol).map((r) => ({
        metric: r.metric,
        state: r.state,
        minuteBucket: iso(r.minute_bucket),
        derived: r.derived_value,
        available: r.state === "DERIVED",
      }));
      const modelRow = model.rows.find((r) => r.symbol === symbol);
      const familyStates = families.map((f) => f.state);
      const overall: OwnerHealthState = !families.length ? "NO_DATA"
        : familyStates.includes("BLOCKED") ? "BLOCKED"
        : familyStates.includes("UNKNOWN") ? "UNKNOWN"
        : familyStates.includes("DEGRADED") ? "DEGRADED"
        : familyStates.every((x) => x === "HEALTHY") ? "HEALTHY" : "UNKNOWN";
      symbols[symbol] = {
        overall,
        families,
        reconstruction: reconstructionRows,
        modelTruth: modelRow ? {
          minuteBucket: iso(modelRow.minute_bucket),
          totalContracts: num(modelRow.total_count),
          ivPermissionContracts: num(modelRow.iv_permission_count),
          greekPermissionContracts: num(modelRow.greek_permission_count),
        } : null,
      };
    }

    return c.json({
      status: "SOURCE_HEALTH_AVAILABLE",
      dbConnected: true,
      generatedAt,
      symbols,
      interpretation: {
        HEALTHY: "Exact usable truth; new shadow evidence may be formed.",
        DEGRADED: "Context only; do not promote to strong new evidence.",
        BLOCKED: "Do not form new evidence from this family.",
        UNKNOWN: "Truth is incomplete; never treat as neutral.",
        NO_DATA: "No stored source-truth observation is available.",
      },
      readOnly: true,
      shadowOnly: true,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
      apiVersion: "SOURCE_HEALTH_OWNER_V1",
    });
  });
}
