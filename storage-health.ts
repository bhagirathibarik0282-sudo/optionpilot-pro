import type { Hono } from "hono";
import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { mountSourceHealthRoutes } from "./source-health-api.js";

type CountRow = { count: string | number };
type LatestRow = { symbol: string; minute_bucket: string | Date | null; spot_ltp: number | null };

function n(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
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

  // Phase 41 owner-facing source/evidence health. Read-only and shadow-only.
  mountSourceHealthRoutes(app);
}
