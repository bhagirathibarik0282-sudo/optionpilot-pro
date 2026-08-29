import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { decideH1PilotStatus, rowsToCountMap, type H1PilotAuditSummary } from "./h1-pilot-audit-core.js";

const DAY_EXPR = `(minute_bucket AT TIME ZONE 'Asia/Kolkata')::date = $1::date`;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await dbQuerySafe<T>(sql, params);
  if (!result) throw new Error("H1_PILOT_DB_QUERY_FAILED");
  return result.rows;
}

function keyedCounts<T extends Record<string, unknown>>(input: T[], key: keyof T, count: keyof T): Record<string, number> {
  return Object.fromEntries(input.map((row) => [String(row[key] ?? "UNKNOWN"), Number(row[count] ?? 0) || 0]));
}

export async function runH1PilotHttpAudit(): Promise<{
  ok: boolean;
  mode: "READ_ONLY_H1_PILOT_AUDIT";
  productionImpact: "NONE";
  audit: H1PilotAuditSummary | null;
  diagnostics?: {
    marketTruthCounts: Record<string, number>;
    optionValidationCounts: Record<string, number>;
    cePeMismatchBySymbol: Record<string, number>;
    cePeMismatchBySymbolExpiry: Array<{ symbol: string; expiry: string; mismatchBuckets: number }>;
  };
  reason?: string;
}> {
  if (!dbIsConfigured()) {
    return { ok: false, mode: "READ_ONLY_H1_PILOT_AUDIT", productionImpact: "NONE", audit: null, reason: "DATABASE_URL_NOT_CONFIGURED" };
  }

  try {
    const dateRows = await rows<{ trade_date: string | null }>(`
      SELECT MAX((minute_bucket AT TIME ZONE 'Asia/Kolkata')::date)::text AS trade_date
      FROM market_snapshot_1m
    `);
    const tradeDate = dateRows[0]?.trade_date ?? null;

    if (!tradeDate) {
      const base = {
        tradeDate: null,
        marketRowsBySymbol: {}, optionRowsBySymbol: {}, chainRowsBySymbol: {},
        researchEligibleCount: 0, diagnosticCount: 0, duplicateLogicalKeys: 0,
        futureTimestampRows: 0, expiryOrDteMismatchRows: 0, cePeCountMismatch: 0,
        firstTimestamp: null, lastTimestamp: null,
      };
      const status = decideH1PilotStatus(base);
      return { ok: false, mode: "READ_ONLY_H1_PILOT_AUDIT", productionImpact: "NONE", audit: { ...base, ...status } };
    }

    const [
      marketCounts, optionCounts, chainCounts, quality, duplicate, future, dteMismatch,
      cePeMismatch, bounds, marketTruth, optionValidation, mismatchBySymbol, mismatchBySymbolExpiry,
    ] = await Promise.all([
      rows<{ symbol: string; count: string }>(`SELECT symbol, COUNT(*)::text AS count FROM market_snapshot_1m WHERE ${DAY_EXPR} GROUP BY symbol ORDER BY symbol`, [tradeDate]),
      rows<{ symbol: string; count: string }>(`SELECT symbol, COUNT(*)::text AS count FROM option_snapshot_1m WHERE ${DAY_EXPR} GROUP BY symbol ORDER BY symbol`, [tradeDate]),
      rows<{ symbol: string; count: string }>(`SELECT symbol, COUNT(*)::text AS count FROM chain_state_1m WHERE ${DAY_EXPR} GROUP BY symbol ORDER BY symbol`, [tradeDate]),
      rows<{ research: string; diagnostic: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE validation_status = 'RESEARCH_ELIGIBLE')::text AS research,
          COUNT(*) FILTER (WHERE validation_status IS DISTINCT FROM 'RESEARCH_ELIGIBLE')::text AS diagnostic
        FROM option_snapshot_1m WHERE ${DAY_EXPR}
      `, [tradeDate]),
      rows<{ count: string }>(`
        SELECT COUNT(*)::text AS count FROM (
          SELECT symbol, minute_bucket, expiry, strike, option_type, COUNT(*)
          FROM option_snapshot_1m WHERE ${DAY_EXPR}
          GROUP BY symbol, minute_bucket, expiry, strike, option_type HAVING COUNT(*) > 1
        ) d
      `, [tradeDate]),
      rows<{ count: string }>(`
        SELECT (
          (SELECT COUNT(*) FROM market_snapshot_1m WHERE ${DAY_EXPR} AND minute_bucket > now()) +
          (SELECT COUNT(*) FROM option_snapshot_1m WHERE ${DAY_EXPR} AND minute_bucket > now()) +
          (SELECT COUNT(*) FROM chain_state_1m WHERE ${DAY_EXPR} AND minute_bucket > now())
        )::text AS count
      `, [tradeDate]),
      rows<{ count: string }>(`
        SELECT COUNT(*)::text AS count FROM option_snapshot_1m
        WHERE ${DAY_EXPR}
          AND dte IS NOT NULL
          AND dte <> GREATEST(0, expiry - ((minute_bucket AT TIME ZONE 'Asia/Kolkata')::date))
      `, [tradeDate]),
      rows<{ count: string }>(`
        SELECT COUNT(*)::text AS count FROM (
          SELECT symbol, minute_bucket, expiry,
            COUNT(*) FILTER (WHERE option_type='CE') AS ce,
            COUNT(*) FILTER (WHERE option_type='PE') AS pe
          FROM option_snapshot_1m WHERE ${DAY_EXPR}
          GROUP BY symbol, minute_bucket, expiry
          HAVING COUNT(*) FILTER (WHERE option_type='CE') <> COUNT(*) FILTER (WHERE option_type='PE')
        ) x
      `, [tradeDate]),
      rows<{ first_ts: string | null; last_ts: string | null }>(`
        SELECT MIN(minute_bucket)::text AS first_ts, MAX(minute_bucket)::text AS last_ts
        FROM market_snapshot_1m WHERE ${DAY_EXPR}
      `, [tradeDate]),
      rows<{ freshness_status: string | null; count: string }>(`
        SELECT freshness_status, COUNT(*)::text AS count
        FROM market_snapshot_1m WHERE ${DAY_EXPR}
        GROUP BY freshness_status ORDER BY freshness_status
      `, [tradeDate]),
      rows<{ validation_status: string | null; count: string }>(`
        SELECT validation_status, COUNT(*)::text AS count
        FROM option_snapshot_1m WHERE ${DAY_EXPR}
        GROUP BY validation_status ORDER BY validation_status
      `, [tradeDate]),
      rows<{ symbol: string; count: string }>(`
        SELECT symbol, COUNT(*)::text AS count FROM (
          SELECT symbol, minute_bucket, expiry,
            COUNT(*) FILTER (WHERE option_type='CE') AS ce,
            COUNT(*) FILTER (WHERE option_type='PE') AS pe
          FROM option_snapshot_1m WHERE ${DAY_EXPR}
          GROUP BY symbol, minute_bucket, expiry
          HAVING COUNT(*) FILTER (WHERE option_type='CE') <> COUNT(*) FILTER (WHERE option_type='PE')
        ) x GROUP BY symbol ORDER BY symbol
      `, [tradeDate]),
      rows<{ symbol: string; expiry: string; mismatch_buckets: string }>(`
        SELECT symbol, expiry::text AS expiry, COUNT(*)::text AS mismatch_buckets FROM (
          SELECT symbol, minute_bucket, expiry,
            COUNT(*) FILTER (WHERE option_type='CE') AS ce,
            COUNT(*) FILTER (WHERE option_type='PE') AS pe
          FROM option_snapshot_1m WHERE ${DAY_EXPR}
          GROUP BY symbol, minute_bucket, expiry
          HAVING COUNT(*) FILTER (WHERE option_type='CE') <> COUNT(*) FILTER (WHERE option_type='PE')
        ) x GROUP BY symbol, expiry ORDER BY symbol, expiry
      `, [tradeDate]),
    ]);

    const base: Omit<H1PilotAuditSummary, "pilotStatus" | "blockers"> = {
      tradeDate,
      marketRowsBySymbol: rowsToCountMap(marketCounts),
      optionRowsBySymbol: rowsToCountMap(optionCounts),
      chainRowsBySymbol: rowsToCountMap(chainCounts),
      researchEligibleCount: Number(quality[0]?.research ?? 0),
      diagnosticCount: Number(quality[0]?.diagnostic ?? 0),
      duplicateLogicalKeys: Number(duplicate[0]?.count ?? 0),
      futureTimestampRows: Number(future[0]?.count ?? 0),
      expiryOrDteMismatchRows: Number(dteMismatch[0]?.count ?? 0),
      cePeCountMismatch: Number(cePeMismatch[0]?.count ?? 0),
      firstTimestamp: bounds[0]?.first_ts ?? null,
      lastTimestamp: bounds[0]?.last_ts ?? null,
    };
    const status = decideH1PilotStatus(base);
    const audit = { ...base, ...status };
    const diagnostics = {
      marketTruthCounts: keyedCounts(marketTruth, "freshness_status", "count"),
      optionValidationCounts: keyedCounts(optionValidation, "validation_status", "count"),
      cePeMismatchBySymbol: rowsToCountMap(mismatchBySymbol),
      cePeMismatchBySymbolExpiry: mismatchBySymbolExpiry.map((row) => ({
        symbol: row.symbol,
        expiry: row.expiry,
        mismatchBuckets: Number(row.mismatch_buckets) || 0,
      })),
    };
    return { ok: audit.pilotStatus === "PASS", mode: "READ_ONLY_H1_PILOT_AUDIT", productionImpact: "NONE", audit, diagnostics };
  } catch (err) {
    return {
      ok: false,
      mode: "READ_ONLY_H1_PILOT_AUDIT",
      productionImpact: "NONE",
      audit: null,
      reason: err instanceof Error ? err.message : "H1_PILOT_AUDIT_FAILED",
    };
  }
}
