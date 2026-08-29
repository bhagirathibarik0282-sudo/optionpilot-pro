import pg from "pg";
import { decideH1PilotStatus, rowsToCountMap, type H1PilotAuditSummary } from "./h1-pilot-audit-core.js";

const { Pool } = pg;
const IST_OFFSET = "5 hours 30 minutes";

function poolFromEnv(): InstanceType<typeof Pool> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_REQUIRED_FOR_H1_PILOT_AUDIT");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({ connectionString: url, max: 1, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
}

async function main(): Promise<void> {
  const pool = poolFromEnv();
  try {
    await pool.query("BEGIN READ ONLY");

    const dateRes = await pool.query<{ trade_date: string | null }>(`
      SELECT MAX((minute_bucket + interval '${IST_OFFSET}')::date)::text AS trade_date
      FROM market_snapshot_1m
    `);
    const tradeDate = dateRes.rows[0]?.trade_date ?? null;

    if (!tradeDate) {
      const base = {
        tradeDate: null,
        marketRowsBySymbol: {}, optionRowsBySymbol: {}, chainRowsBySymbol: {},
        researchEligibleCount: 0, diagnosticCount: 0, duplicateLogicalKeys: 0,
        futureTimestampRows: 0, expiryOrDteMismatchRows: 0, cePeCountMismatch: 0,
        firstTimestamp: null, lastTimestamp: null,
      };
      const status = decideH1PilotStatus(base);
      console.log("[H1_PILOT_AUDIT]", JSON.stringify({ ...base, ...status }));
      await pool.query("ROLLBACK");
      return;
    }

    const dayExpr = `(minute_bucket + interval '${IST_OFFSET}')::date = $1::date`;
    const marketCounts = await pool.query<{ symbol: string; count: string }>(`
      SELECT symbol, COUNT(*)::text AS count FROM market_snapshot_1m WHERE ${dayExpr} GROUP BY symbol ORDER BY symbol
    `, [tradeDate]);
    const optionCounts = await pool.query<{ symbol: string; count: string }>(`
      SELECT symbol, COUNT(*)::text AS count FROM option_snapshot_1m WHERE ${dayExpr} GROUP BY symbol ORDER BY symbol
    `, [tradeDate]);
    const chainCounts = await pool.query<{ symbol: string; count: string }>(`
      SELECT symbol, COUNT(*)::text AS count FROM chain_state_1m WHERE ${dayExpr} GROUP BY symbol ORDER BY symbol
    `, [tradeDate]);

    const quality = await pool.query<{ research: string; diagnostic: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE validation_status = 'RESEARCH_ELIGIBLE')::text AS research,
        COUNT(*) FILTER (WHERE validation_status IS DISTINCT FROM 'RESEARCH_ELIGIBLE')::text AS diagnostic
      FROM option_snapshot_1m WHERE ${dayExpr}
    `, [tradeDate]);

    const duplicate = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM (
        SELECT symbol, minute_bucket, expiry, strike, option_type, COUNT(*)
        FROM option_snapshot_1m WHERE ${dayExpr}
        GROUP BY symbol, minute_bucket, expiry, strike, option_type HAVING COUNT(*) > 1
      ) d
    `, [tradeDate]);

    const future = await pool.query<{ count: string }>(`
      SELECT (
        (SELECT COUNT(*) FROM market_snapshot_1m WHERE ${dayExpr} AND minute_bucket > now()) +
        (SELECT COUNT(*) FROM option_snapshot_1m WHERE ${dayExpr} AND minute_bucket > now()) +
        (SELECT COUNT(*) FROM chain_state_1m WHERE ${dayExpr} AND minute_bucket > now())
      )::text AS count
    `, [tradeDate]);

    const dteMismatch = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM option_snapshot_1m
      WHERE ${dayExpr}
        AND dte IS NOT NULL
        AND dte <> GREATEST(0, expiry - ((minute_bucket + interval '${IST_OFFSET}')::date))
    `, [tradeDate]);

    const cePeMismatch = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM (
        SELECT symbol, minute_bucket, expiry,
          COUNT(*) FILTER (WHERE option_type='CE') AS ce,
          COUNT(*) FILTER (WHERE option_type='PE') AS pe
        FROM option_snapshot_1m WHERE ${dayExpr}
        GROUP BY symbol, minute_bucket, expiry
        HAVING COUNT(*) FILTER (WHERE option_type='CE') <> COUNT(*) FILTER (WHERE option_type='PE')
      ) x
    `, [tradeDate]);

    const bounds = await pool.query<{ first_ts: string | null; last_ts: string | null }>(`
      SELECT MIN(minute_bucket)::text AS first_ts, MAX(minute_bucket)::text AS last_ts
      FROM market_snapshot_1m WHERE ${dayExpr}
    `, [tradeDate]);

    const base: Omit<H1PilotAuditSummary, "pilotStatus" | "blockers"> = {
      tradeDate,
      marketRowsBySymbol: rowsToCountMap(marketCounts.rows),
      optionRowsBySymbol: rowsToCountMap(optionCounts.rows),
      chainRowsBySymbol: rowsToCountMap(chainCounts.rows),
      researchEligibleCount: Number(quality.rows[0]?.research ?? 0),
      diagnosticCount: Number(quality.rows[0]?.diagnostic ?? 0),
      duplicateLogicalKeys: Number(duplicate.rows[0]?.count ?? 0),
      futureTimestampRows: Number(future.rows[0]?.count ?? 0),
      expiryOrDteMismatchRows: Number(dteMismatch.rows[0]?.count ?? 0),
      cePeCountMismatch: Number(cePeMismatch.rows[0]?.count ?? 0),
      firstTimestamp: bounds.rows[0]?.first_ts ?? null,
      lastTimestamp: bounds.rows[0]?.last_ts ?? null,
    };

    const status = decideH1PilotStatus(base);
    console.log("[H1_PILOT_AUDIT]", JSON.stringify({ ...base, ...status }));
    await pool.query("ROLLBACK");
    if (status.pilotStatus !== "PASS") process.exitCode = 2;
  } catch (err) {
    try { await pool.query("ROLLBACK"); } catch {}
    console.error("[H1_PILOT_AUDIT]", JSON.stringify({ pilotStatus: "ERROR", error: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
