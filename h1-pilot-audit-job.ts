import pg from "pg";
import { decideH1PilotStatus, rowsToCountMap, type H1PilotAuditSummary } from "./h1-pilot-audit-core.js";

const { Pool } = pg;

function poolFromEnv(): InstanceType<typeof Pool> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_REQUIRED_FOR_H1_PILOT_AUDIT");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({ connectionString: url, max: 1, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
}

function markerCte(): string {
  return `WITH markers AS (
    SELECT DISTINCT ON (payload->>'symbol', date_trunc('minute', (payload->>'minuteBucket')::timestamptz))
      payload->>'symbol' AS symbol,
      date_trunc('minute', (payload->>'minuteBucket')::timestamptz) AS minute_bucket,
      payload->>'truthVerdict' AS truth_verdict,
      created_at
    FROM app_state_log
    WHERE kind = 'H1_TRUTH_MARKER'
      AND payload->>'symbol' IS NOT NULL
      AND payload->>'minuteBucket' IS NOT NULL
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = $1::date)
    ORDER BY payload->>'symbol', date_trunc('minute', (payload->>'minuteBucket')::timestamptz), created_at DESC
  )`;
}

async function main(): Promise<void> {
  const pool = poolFromEnv();
  try {
    await pool.query("BEGIN READ ONLY");

    const dateRes = await pool.query<{ trade_date: string | null }>(`
      SELECT MAX((((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date))::text AS trade_date
      FROM app_state_log
      WHERE kind = 'H1_TRUTH_MARKER' AND payload->>'minuteBucket' IS NOT NULL
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
      console.log("[H1_PILOT_AUDIT]", JSON.stringify({ ...base, ...status, truthMarkerSource: "APP_STATE_LOG_H1_TRUTH_MARKER" }));
      await pool.query("ROLLBACK");
      return;
    }

    const cte = markerCte();
    const marketCounts = await pool.query<{ symbol: string; count: string }>(`${cte}
      SELECT m.symbol, COUNT(*)::text AS count FROM market_snapshot_1m m
      JOIN markers h ON h.symbol=m.symbol AND h.minute_bucket=m.minute_bucket
      GROUP BY m.symbol ORDER BY m.symbol`, [tradeDate]);
    const optionCounts = await pool.query<{ symbol: string; count: string }>(`${cte}
      SELECT o.symbol, COUNT(*)::text AS count FROM option_snapshot_1m o
      JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
      GROUP BY o.symbol ORDER BY o.symbol`, [tradeDate]);
    const chainCounts = await pool.query<{ symbol: string; count: string }>(`${cte}
      SELECT c.symbol, COUNT(*)::text AS count FROM chain_state_1m c
      JOIN markers h ON h.symbol=c.symbol AND h.minute_bucket=c.minute_bucket
      GROUP BY c.symbol ORDER BY c.symbol`, [tradeDate]);

    const quality = await pool.query<{ research: string; diagnostic: string }>(`${cte}
      SELECT
        COUNT(*) FILTER (WHERE h.truth_verdict = 'TRUE')::text AS research,
        COUNT(*) FILTER (WHERE h.truth_verdict IS DISTINCT FROM 'TRUE')::text AS diagnostic
      FROM option_snapshot_1m o
      JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket`, [tradeDate]);

    const duplicate = await pool.query<{ count: string }>(`${cte}
      SELECT COUNT(*)::text AS count FROM (
        SELECT o.symbol, o.minute_bucket, o.expiry, o.strike, o.option_type, COUNT(*)
        FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
        GROUP BY o.symbol, o.minute_bucket, o.expiry, o.strike, o.option_type HAVING COUNT(*) > 1
      ) d`, [tradeDate]);

    const future = await pool.query<{ count: string }>(`${cte}
      SELECT (
        (SELECT COUNT(*) FROM market_snapshot_1m m JOIN markers h ON h.symbol=m.symbol AND h.minute_bucket=m.minute_bucket WHERE m.minute_bucket > now()) +
        (SELECT COUNT(*) FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket WHERE o.minute_bucket > now()) +
        (SELECT COUNT(*) FROM chain_state_1m c JOIN markers h ON h.symbol=c.symbol AND h.minute_bucket=c.minute_bucket WHERE c.minute_bucket > now())
      )::text AS count`, [tradeDate]);

    const dteMismatch = await pool.query<{ count: string }>(`${cte}
      SELECT COUNT(*)::text AS count FROM option_snapshot_1m o
      JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
      WHERE o.dte IS NOT NULL
        AND o.dte <> GREATEST(0, o.expiry - ((o.minute_bucket AT TIME ZONE 'Asia/Kolkata')::date))`, [tradeDate]);

    const cePeMismatch = await pool.query<{ count: string }>(`${cte}
      SELECT COUNT(*)::text AS count FROM (
        SELECT o.symbol, o.minute_bucket, o.expiry,
          COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7) AS ce,
          COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7) AS pe
        FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
        GROUP BY o.symbol, o.minute_bucket, o.expiry
        HAVING COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7)
            <> COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7)
      ) x`, [tradeDate]);

    const bounds = await pool.query<{ first_ts: string | null; last_ts: string | null }>(`${cte}
      SELECT MIN(m.minute_bucket)::text AS first_ts, MAX(m.minute_bucket)::text AS last_ts
      FROM market_snapshot_1m m JOIN markers h ON h.symbol=m.symbol AND h.minute_bucket=m.minute_bucket`, [tradeDate]);

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
    console.log("[H1_PILOT_AUDIT]", JSON.stringify({
      ...base,
      ...status,
      truthMarkerSource: "APP_STATE_LOG_H1_TRUTH_MARKER",
      cePeRule: "ATM_OFFSET_MINUS7_TO_PLUS7",
    }));
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
