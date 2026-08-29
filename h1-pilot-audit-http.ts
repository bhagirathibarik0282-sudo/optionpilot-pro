import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { decideH1PilotStatus, rowsToCountMap, type H1PilotAuditSummary } from "./h1-pilot-audit-core.js";

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await dbQuerySafe<T>(sql, params);
  if (!result) throw new Error("H1_PILOT_DB_QUERY_FAILED");
  return result.rows;
}

function keyedCounts<T extends Record<string, unknown>>(input: T[], key: keyof T, count: keyof T): Record<string, number> {
  return Object.fromEntries(input.map((row) => [String(row[key] ?? "UNKNOWN"), Number(row[count] ?? 0) || 0]));
}

function markerCte(dayParam = "$1"): string {
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
      AND (((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date = ${dayParam}::date)
    ORDER BY payload->>'symbol', date_trunc('minute', (payload->>'minuteBucket')::timestamptz), created_at DESC
  )`;
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
    truthMarkerSource: "APP_STATE_LOG_H1_TRUTH_MARKER";
    cePeRule: "ATM_OFFSET_MINUS7_TO_PLUS7";
  };
  reason?: string;
}> {
  if (!dbIsConfigured()) {
    return { ok: false, mode: "READ_ONLY_H1_PILOT_AUDIT", productionImpact: "NONE", audit: null, reason: "DATABASE_URL_NOT_CONFIGURED" };
  }

  try {
    const dateRows = await rows<{ trade_date: string | null }>(`
      SELECT MAX((((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date))::text AS trade_date
      FROM app_state_log
      WHERE kind = 'H1_TRUTH_MARKER' AND payload->>'minuteBucket' IS NOT NULL
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
      return {
        ok: false,
        mode: "READ_ONLY_H1_PILOT_AUDIT",
        productionImpact: "NONE",
        audit: { ...base, ...status },
        diagnostics: {
          marketTruthCounts: {}, optionValidationCounts: {}, cePeMismatchBySymbol: {}, cePeMismatchBySymbolExpiry: [],
          truthMarkerSource: "APP_STATE_LOG_H1_TRUTH_MARKER",
          cePeRule: "ATM_OFFSET_MINUS7_TO_PLUS7",
        },
      };
    }

    const cte = markerCte();
    const [
      marketCounts, optionCounts, chainCounts, quality, duplicate, future, dteMismatch,
      cePeMismatch, bounds, marketTruth, optionValidation, mismatchBySymbol, mismatchBySymbolExpiry,
    ] = await Promise.all([
      rows<{ symbol: string; count: string }>(`${cte}
        SELECT m.symbol, COUNT(*)::text AS count FROM market_snapshot_1m m
        JOIN markers h ON h.symbol=m.symbol AND h.minute_bucket=m.minute_bucket
        GROUP BY m.symbol ORDER BY m.symbol`, [tradeDate]),
      rows<{ symbol: string; count: string }>(`${cte}
        SELECT o.symbol, COUNT(*)::text AS count FROM option_snapshot_1m o
        JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
        GROUP BY o.symbol ORDER BY o.symbol`, [tradeDate]),
      rows<{ symbol: string; count: string }>(`${cte}
        SELECT c.symbol, COUNT(*)::text AS count FROM chain_state_1m c
        JOIN markers h ON h.symbol=c.symbol AND h.minute_bucket=c.minute_bucket
        GROUP BY c.symbol ORDER BY c.symbol`, [tradeDate]),
      rows<{ research: string; diagnostic: string }>(`${cte}
        SELECT
          COUNT(*) FILTER (WHERE h.truth_verdict = 'TRUE')::text AS research,
          COUNT(*) FILTER (WHERE h.truth_verdict IS DISTINCT FROM 'TRUE')::text AS diagnostic
        FROM option_snapshot_1m o
        JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket`, [tradeDate]),
      rows<{ count: string }>(`${cte}
        SELECT COUNT(*)::text AS count FROM (
          SELECT o.symbol, o.minute_bucket, o.expiry, o.strike, o.option_type, COUNT(*)
          FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
          GROUP BY o.symbol, o.minute_bucket, o.expiry, o.strike, o.option_type HAVING COUNT(*) > 1
        ) d`, [tradeDate]),
      rows<{ count: string }>(`${cte}
        SELECT (
          (SELECT COUNT(*) FROM market_snapshot_1m m JOIN markers h ON h.symbol=m.symbol AND h.minute_bucket=m.minute_bucket WHERE m.minute_bucket > now()) +
          (SELECT COUNT(*) FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket WHERE o.minute_bucket > now()) +
          (SELECT COUNT(*) FROM chain_state_1m c JOIN markers h ON h.symbol=c.symbol AND h.minute_bucket=c.minute_bucket WHERE c.minute_bucket > now())
        )::text AS count`, [tradeDate]),
      rows<{ count: string }>(`${cte}
        SELECT COUNT(*)::text AS count FROM option_snapshot_1m o
        JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
        WHERE o.dte IS NOT NULL
          AND o.dte <> GREATEST(0, o.expiry - ((o.minute_bucket AT TIME ZONE 'Asia/Kolkata')::date))`, [tradeDate]),
      rows<{ count: string }>(`${cte}
        SELECT COUNT(*)::text AS count FROM (
          SELECT o.symbol, o.minute_bucket, o.expiry,
            COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7) AS ce,
            COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7) AS pe
          FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
          GROUP BY o.symbol, o.minute_bucket, o.expiry
          HAVING COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7)
              <> COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7)
        ) x`, [tradeDate]),
      rows<{ first_ts: string | null; last_ts: string | null }>(`${cte}
        SELECT MIN(m.minute_bucket)::text AS first_ts, MAX(m.minute_bucket)::text AS last_ts
        FROM market_snapshot_1m m JOIN markers h ON h.symbol=m.symbol AND h.minute_bucket=m.minute_bucket`, [tradeDate]),
      rows<{ truth_verdict: string | null; count: string }>(`${cte}
        SELECT truth_verdict, COUNT(*)::text AS count FROM markers GROUP BY truth_verdict ORDER BY truth_verdict`, [tradeDate]),
      rows<{ validation_status: string | null; count: string }>(`${cte}
        SELECT o.validation_status, COUNT(*)::text AS count FROM option_snapshot_1m o
        JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
        GROUP BY o.validation_status ORDER BY o.validation_status`, [tradeDate]),
      rows<{ symbol: string; count: string }>(`${cte}
        SELECT symbol, COUNT(*)::text AS count FROM (
          SELECT o.symbol, o.minute_bucket, o.expiry,
            COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7) AS ce,
            COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7) AS pe
          FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
          GROUP BY o.symbol, o.minute_bucket, o.expiry
          HAVING COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7)
              <> COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7)
        ) x GROUP BY symbol ORDER BY symbol`, [tradeDate]),
      rows<{ symbol: string; expiry: string; mismatch_buckets: string }>(`${cte}
        SELECT symbol, expiry::text AS expiry, COUNT(*)::text AS mismatch_buckets FROM (
          SELECT o.symbol, o.minute_bucket, o.expiry,
            COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7) AS ce,
            COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7) AS pe
          FROM option_snapshot_1m o JOIN markers h ON h.symbol=o.symbol AND h.minute_bucket=o.minute_bucket
          GROUP BY o.symbol, o.minute_bucket, o.expiry
          HAVING COUNT(*) FILTER (WHERE o.option_type='CE' AND o.atm_offset BETWEEN -7 AND 7)
              <> COUNT(*) FILTER (WHERE o.option_type='PE' AND o.atm_offset BETWEEN -7 AND 7)
        ) x GROUP BY symbol, expiry ORDER BY symbol, expiry`, [tradeDate]),
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
      marketTruthCounts: keyedCounts(marketTruth, "truth_verdict", "count"),
      optionValidationCounts: keyedCounts(optionValidation, "validation_status", "count"),
      cePeMismatchBySymbol: rowsToCountMap(mismatchBySymbol),
      cePeMismatchBySymbolExpiry: mismatchBySymbolExpiry.map((row) => ({
        symbol: row.symbol,
        expiry: row.expiry,
        mismatchBuckets: Number(row.mismatch_buckets) || 0,
      })),
      truthMarkerSource: "APP_STATE_LOG_H1_TRUTH_MARKER" as const,
      cePeRule: "ATM_OFFSET_MINUS7_TO_PLUS7" as const,
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
