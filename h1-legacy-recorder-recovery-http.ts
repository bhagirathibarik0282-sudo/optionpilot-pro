import { dbIsConfigured, dbQuerySafe } from "./db.js";

export const H1_LEGACY_RECORDER_RECOVERY_VERSION = "H1_LEGACY_RECORDER_RECOVERY_V1" as const;
export const H1_LEGACY_RECORDER_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;
export type H1LegacyRecorderSymbol = (typeof H1_LEGACY_RECORDER_SYMBOLS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseLegacyRecorderRecoveryRequest(input: {
  symbol?: string | null;
  tradeDate?: string | null;
}): { ok: true; symbol: H1LegacyRecorderSymbol; tradeDate: string } | { ok: false; reason: string } {
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!H1_LEGACY_RECORDER_SYMBOLS.includes(symbol as H1LegacyRecorderSymbol)) {
    return { ok: false, reason: "INVALID_SYMBOL" };
  }
  const tradeDate = String(input.tradeDate ?? "").trim();
  if (!DATE_RE.test(tradeDate)) return { ok: false, reason: "INVALID_TRADE_DATE" };
  const d = new Date(`${tradeDate}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== tradeDate) {
    return { ok: false, reason: "INVALID_TRADE_DATE" };
  }
  return { ok: true, symbol: symbol as H1LegacyRecorderSymbol, tradeDate };
}

export async function runLegacyRecorderRecoveryHttp(
  symbol: H1LegacyRecorderSymbol,
  tradeDate: string,
): Promise<{
  ok: boolean;
  mode: typeof H1_LEGACY_RECORDER_RECOVERY_VERSION;
  productionImpact: "NONE";
  request: { symbol: H1LegacyRecorderSymbol; tradeDate: string };
  counts?: { recorderSnapshots: number; symbolSnapshots: number };
  firstObserved?: string | null;
  lastObserved?: string | null;
  snapshots?: Array<{
    backendTimestamp: string | null;
    snapshotStatus: string | null;
    truthVerdict: string | null;
    market: Record<string, unknown>;
  }>;
  reason?: string;
}> {
  const request = { symbol, tradeDate };
  if (!dbIsConfigured()) {
    return { ok: false, mode: H1_LEGACY_RECORDER_RECOVERY_VERSION, productionImpact: "NONE", request, reason: "DATABASE_URL_NOT_CONFIGURED" };
  }

  const result = await dbQuerySafe<{
    backend_timestamp: string | null;
    snapshot_status: string | null;
    truth_verdict: string | null;
    market: Record<string, unknown> | null;
  }>(`
    SELECT
      payload->>'backendTimestamp' AS backend_timestamp,
      payload->>'snapshotStatus' AS snapshot_status,
      payload->'truthVerdicts'->>$1 AS truth_verdict,
      payload->$1 AS market
    FROM app_state_log
    WHERE kind = 'recorder_snapshot'
      AND payload->>'backendTimestamp' IS NOT NULL
      AND (((payload->>'backendTimestamp')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $2::date)
    ORDER BY (payload->>'backendTimestamp')::timestamptz ASC
  `, [symbol, tradeDate]);

  if (!result) {
    return { ok: false, mode: H1_LEGACY_RECORDER_RECOVERY_VERSION, productionImpact: "NONE", request, reason: "LEGACY_RECORDER_QUERY_FAILED" };
  }

  const snapshots = result.rows
    .filter((row) => row.market && typeof row.market === "object")
    .map((row) => ({
      backendTimestamp: row.backend_timestamp,
      snapshotStatus: row.snapshot_status,
      truthVerdict: row.truth_verdict,
      market: row.market as Record<string, unknown>,
    }));

  return {
    ok: true,
    mode: H1_LEGACY_RECORDER_RECOVERY_VERSION,
    productionImpact: "NONE",
    request,
    counts: { recorderSnapshots: result.rows.length, symbolSnapshots: snapshots.length },
    firstObserved: snapshots[0]?.backendTimestamp ?? null,
    lastObserved: snapshots[snapshots.length - 1]?.backendTimestamp ?? null,
    snapshots,
  };
}
