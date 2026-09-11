import pg, { type PoolClient } from "pg";
import { indiaDateFromIso, resolveRetentionDays, resolveRetentionMode, retentionCutoffDate } from "./eod-retention-core.js";

const { Pool } = pg;
const MEANINGFUL_NARRATIVE_KIND = "meaningful_narrative_event";

type RetentionTarget = {
  table: string;
  dateExpr: string;
  whereExtra?: string;
  params?: unknown[];
};

const TARGETS: RetentionTarget[] = [
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
    params: [MEANINGFUL_NARRATIVE_KIND],
  },
  { table: "eod_archive_payloads", dateExpr: "trading_date" },
];

function getPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_NOT_SET");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({ connectionString: url, max: 2, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const q = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${table}`]);
  return Boolean(q.rows[0]?.exists);
}

async function countTarget(client: PoolClient, target: RetentionTarget, cutoffDate: string): Promise<number> {
  const extra = target.whereExtra ? ` AND ${target.whereExtra}` : "";
  const params = [cutoffDate, ...(target.params || [])];
  const q = await client.query(`SELECT count(*)::bigint AS n FROM ${target.table} WHERE ${target.dateExpr} < $1::date${extra}`, params);
  return Number(q.rows[0]?.n || 0);
}

async function deleteTarget(client: PoolClient, target: RetentionTarget, cutoffDate: string): Promise<number> {
  const extra = target.whereExtra ? ` AND ${target.whereExtra}` : "";
  const params = [cutoffDate, ...(target.params || [])];
  const q = await client.query(`DELETE FROM ${target.table} WHERE ${target.dateExpr} < $1::date${extra}` , params);
  return Number(q.rowCount || 0);
}

export async function runEodRetention(nowIso = new Date().toISOString()) {
  const retentionDays = resolveRetentionDays(process.env.EOD_RETENTION_DAYS);
  const today = indiaDateFromIso(nowIso);
  const cutoffDate = retentionCutoffDate(today, retentionDays);
  const mode = resolveRetentionMode();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", ["EOD_RETENTION_V1"]);
    const report: Record<string, { exists: boolean; eligible: number; deleted: number }> = {};

    for (const target of TARGETS) {
      const exists = await tableExists(client, target.table);
      if (!exists) {
        report[target.table] = { exists: false, eligible: 0, deleted: 0 };
        continue;
      }
      const eligible = await countTarget(client, target, cutoffDate);
      report[target.table] = { exists: true, eligible, deleted: 0 };
    }

    if (mode === "APPLY") {
      await client.query("BEGIN");
      try {
        for (const target of TARGETS) {
          if (!report[target.table]?.exists || report[target.table].eligible <= 0) continue;
          report[target.table].deleted = await deleteTarget(client, target, cutoffDate);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const eligibleTotal = Object.values(report).reduce((sum, item) => sum + item.eligible, 0);
    const deletedTotal = Object.values(report).reduce((sum, item) => sum + item.deleted, 0);
    const result = {
      ok: true,
      mode,
      retentionDays,
      today,
      cutoffDate,
      eligibleTotal,
      deletedTotal,
      report,
      safety: {
        defaultMode: "DRY_RUN",
        applyRequires: "EOD_RETENTION_APPLY=true",
        auditTablePreserved: "eod_archive_runs",
        appStateScope: MEANINGFUL_NARRATIVE_KIND,
      },
    };
    console.log(`[EOD_RETENTION] mode=${mode} days=${retentionDays} cutoff=${cutoffDate} eligible=${eligibleTotal} deleted=${deletedTotal}`);
    return result;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["EOD_RETENTION_V1"]); } catch {}
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEodRetention().then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  }).catch((err) => {
    console.error(`[EOD_RETENTION] fatal ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
