import type { Hono } from "hono";
import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { indiaDateFromIso, resolveRetentionDays, retentionCutoffDate } from "./eod-retention-core.js";

type CountRow = { count: string | number };
type LatestRow = { symbol: string; minute_bucket: string | Date | null; spot_ltp: number | null };
type RetentionProofTarget = {
  table: string;
  dateExpr: string;
  whereExtra?: string;
  params?: unknown[];
};

const RETENTION_PROOF_TARGETS: RetentionProofTarget[] = [
  { table: "market_snapshot_1m", dateExpr: "(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date" },
  { table: "option_snapshot_1m", dateExpr: "(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date" },
  { table: "chain_state_1m", dateExpr: "(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date" },
  { table: "timeframe_state", dateExpr: "(block_end AT TIME ZONE 'Asia/Kolkata')::date" },
  { table: "candidate_history", dateExpr: "(observed_at AT TIME ZONE 'Asia/Kolkata')::date" },
  { table: "trade_plan_history", dateExpr: "(created_at AT TIME ZONE 'Asia/Kolkata')::date" },
  { table: "trade_event_history", dateExpr: "(event_at AT TIME ZONE 'Asia/Kolkata')::date" },
  {
    table: "app_state_log",
    dateExpr: "(created_at AT TIME ZONE 'Asia/Kolkata')::date",
    whereExtra: "kind = $2",
    params: ["meaningful_narrative_event"],
  },
  { table: "eod_archive_payloads", dateExpr: "trading_date" },
];

function n(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function retentionProofCount(target: RetentionProofTarget, cutoffDate: string): Promise<{ exists: boolean; eligible: number }> {
  const exists = await dbQuerySafe<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${target.table}`]);
  if (!exists || !exists.rows[0]?.exists) return { exists: false, eligible: 0 };
  const extra = target.whereExtra ? ` AND ${target.whereExtra}` : "";
  const params = [cutoffDate, ...(target.params || [])];
  const result = await dbQuerySafe<CountRow>(
    `SELECT COUNT(*)::bigint AS count FROM ${target.table} WHERE ${target.dateExpr} < $1::date${extra}`,
    params,
  );
  if (!result) throw new Error(`RETENTION_PROOF_QUERY_FAILED:${target.table}`);
  return { exists: true, eligible: n(result.rows[0]?.count) };
}

export function mountStorageHealthRoutes(app: Hono): void {
  app.get("/api/storage/health", async (c) => {
    c.header("Cache-Control", "no-store");
    const generatedAt = new Date().toISOString();

    if (!dbIsConfigured()) {
      return c.json({
        status: "DB_NOT_CONFIGURED",
        dbConnected: false,
        generatedAt,
        counts: { market: 0, option: 0, chain: 0 },
        latest: {},
        note: "DATABASE_URL is not configured for this service.",
      });
    }

    const [marketCount, optionCount, chainCount, latest] = await Promise.all([
      dbQuerySafe<CountRow>("SELECT COUNT(*)::bigint AS count FROM market_snapshot_1m"),
      dbQuerySafe<CountRow>("SELECT COUNT(*)::bigint AS count FROM option_snapshot_1m"),
      dbQuerySafe<CountRow>("SELECT COUNT(*)::bigint AS count FROM chain_state_1m"),
      dbQuerySafe<LatestRow>(`
        SELECT DISTINCT ON (symbol) symbol, minute_bucket, spot_ltp
        FROM market_snapshot_1m
        WHERE symbol IN ('NIFTY','BANKNIFTY','SENSEX')
        ORDER BY symbol, minute_bucket DESC
      `),
    ]);

    if (!marketCount || !optionCount || !chainCount || !latest) {
      return c.json({
        status: "DB_QUERY_FAILED",
        dbConnected: false,
        generatedAt,
        counts: { market: null, option: null, chain: null },
        latest: {},
        note: "Database query failed. Live trading logic is unaffected.",
      }, 503);
    }

    const counts = {
      market: n(marketCount.rows[0]?.count),
      option: n(optionCount.rows[0]?.count),
      chain: n(chainCount.rows[0]?.count),
    };

    const latestBySymbol: Record<string, { minuteBucket: string | null; spotLtp: number | null }> = {};
    for (const row of latest.rows) {
      latestBySymbol[row.symbol] = {
        minuteBucket: iso(row.minute_bucket),
        spotLtp: typeof row.spot_ltp === "number" && Number.isFinite(row.spot_ltp) ? row.spot_ltp : null,
      };
    }

    const hasRows = counts.market > 0 || counts.option > 0 || counts.chain > 0;
    const latestTimes = Object.values(latestBySymbol)
      .map((x) => x.minuteBucket ? new Date(x.minuteBucket).getTime() : NaN)
      .filter(Number.isFinite);
    const latestAgeMinutes = latestTimes.length
      ? Math.round((Date.now() - Math.max(...latestTimes)) / 60000)
      : null;

    return c.json({
      status: hasRows ? "HEALTHY_DATA_PRESENT" : "CONNECTED_NO_DATA",
      dbConnected: true,
      generatedAt,
      counts,
      latest: latestBySymbol,
      latestAgeMinutes,
      readOnly: true,
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
    });
  });

  app.get("/api/storage/retention-proof", async (c) => {
    c.header("Cache-Control", "no-store");
    const generatedAt = new Date().toISOString();
    const retentionDays = resolveRetentionDays(process.env.EOD_RETENTION_DAYS);
    const today = indiaDateFromIso(generatedAt);
    const cutoffDate = retentionCutoffDate(today, retentionDays);

    if (!dbIsConfigured()) {
      return c.json({
        ok: false,
        mode: "READ_ONLY_EOD_RETENTION_PROOF_V1",
        productionImpact: "NONE",
        reason: "DATABASE_URL_NOT_CONFIGURED",
        generatedAt,
        retentionDays,
        cutoffDate,
        deletedTotal: 0,
      }, 503);
    }

    try {
      const report: Record<string, { exists: boolean; eligible: number }> = {};
      for (const target of RETENTION_PROOF_TARGETS) {
        report[target.table] = await retentionProofCount(target, cutoffDate);
      }
      const eligibleTotal = Object.values(report).reduce((sum, item) => sum + item.eligible, 0);
      return c.json({
        ok: true,
        mode: "READ_ONLY_EOD_RETENTION_PROOF_V1",
        productionImpact: "NONE",
        generatedAt,
        retentionDays,
        today,
        cutoffDate,
        eligibleTotal,
        deletedTotal: 0,
        report,
        safety: {
          readOnly: true,
          deleteStatementPresent: false,
          applyEnvironmentIgnored: true,
          auditTablePreserved: "eod_archive_runs",
        },
        affectsVerdict: false,
        affectsTelegram: false,
        affectsExecution: false,
      });
    } catch (err) {
      return c.json({
        ok: false,
        mode: "READ_ONLY_EOD_RETENTION_PROOF_V1",
        productionImpact: "NONE",
        generatedAt,
        retentionDays,
        cutoffDate,
        deletedTotal: 0,
        reason: err instanceof Error ? err.message : "RETENTION_PROOF_FAILED",
      }, 503);
    }
  });
}
