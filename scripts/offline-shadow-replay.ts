import { dbIsConfigured, dbQuerySafe } from "../db.js";

const VERSION = "OFFLINE_SHADOW_REPLAY_V1" as const;
const ALLOWED_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "SENSEX"]);

type Args = {
  symbol: string;
  from: string | null;
  to: string | null;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  const symbol = String(get("symbol") ?? "NIFTY").toUpperCase();
  if (!ALLOWED_SYMBOLS.has(symbol)) throw new Error(`Invalid --symbol. Allowed: ${[...ALLOWED_SYMBOLS].join(", ")}`);

  const from = get("from");
  const to = get("to");
  for (const [label, value] of [["from", from], ["to", to]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw new Error(`Invalid --${label} date/time: ${value}`);
  }

  const rawLimit = Number(get("limit") ?? 500);
  const limit = Number.isFinite(rawLimit) ? Math.min(2000, Math.max(1, Math.floor(rawLimit))) : 500;
  return { symbol, from, to, limit };
}

function rangeClause(column: string, from: string | null, to: string | null, startIndex = 2) {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  if (from) {
    parts.push(`${column} >= $${i++}::timestamptz`);
    params.push(from);
  }
  if (to) {
    parts.push(`${column} <= $${i++}::timestamptz`);
    params.push(to);
  }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!dbIsConfigured()) {
    console.log(JSON.stringify({
      version: VERSION,
      architectureRole: "READ_ONLY_OFFLINE_REPLAY_INPUT",
      productionImpact: "NONE",
      ok: false,
      reason: "DATABASE_URL_NOT_CONFIGURED",
    }, null, 2));
    process.exit(2);
  }

  const marketRange = rangeClause("minute_bucket", args.from, args.to);
  const chainRange = rangeClause("minute_bucket", args.from, args.to);
  const optionRange = rangeClause("minute_bucket", args.from, args.to);

  const market = await dbQuerySafe<Record<string, unknown>>(
    `SELECT symbol, minute_bucket, snapshot_id, exchange_timestamp, backend_timestamp,
            freshness_status, spot_ltp, spot_open, spot_high, spot_low, spot_prev_close,
            vwap, pdh, pdl, gap_percent, future_ltp, future_vwap, future_oi,
            future_oi_change, future_volume, future_basis, india_vix, india_vix_change,
            calculation_version
       FROM market_snapshot_1m
      WHERE symbol = $1${marketRange.sql}
      ORDER BY minute_bucket ASC
      LIMIT $${2 + marketRange.params.length}`,
    [args.symbol, ...marketRange.params, args.limit],
  );

  const chain = await dbQuerySafe<Record<string, unknown>>(
    `SELECT symbol, minute_bucket, expiry, expiry_bucket, atm_strike,
            full_chain_oi_pcr, band7_oi_pcr, volume_pcr, max_pain,
            call_wall_strike, call_wall_oi, call_wall_strength, call_wall_distance,
            call_wall_migration, put_wall_strike, put_wall_oi, put_wall_strength,
            put_wall_distance, put_wall_migration, atm_iv, straddle_ltp,
            straddle_change, validation_status, calculation_version
       FROM chain_state_1m
      WHERE symbol = $1${chainRange.sql}
      ORDER BY minute_bucket ASC, expiry ASC
      LIMIT $${2 + chainRange.params.length}`,
    [args.symbol, ...chainRange.params, args.limit],
  );

  const options = await dbQuerySafe<Record<string, unknown>>(
    `SELECT symbol, minute_bucket, snapshot_id, expiry, expiry_bucket, dte, strike,
            option_type, atm_offset, is_candidate, is_wall, ltp, bid, ask, spread,
            volume, oi, oi_change, iv, delta, gamma, vega, theta, intrinsic,
            extrinsic, day_high, day_low, pdh, pdl, quote_timestamp,
            quote_age_seconds, liquidity_status, validation_status, calculation_version
       FROM option_snapshot_1m
      WHERE symbol = $1${optionRange.sql}
      ORDER BY minute_bucket ASC, expiry ASC, strike ASC, option_type ASC
      LIMIT $${2 + optionRange.params.length}`,
    [args.symbol, ...optionRange.params, args.limit],
  );

  if (!market || !chain || !options) {
    console.log(JSON.stringify({
      version: VERSION,
      architectureRole: "READ_ONLY_OFFLINE_REPLAY_INPUT",
      productionImpact: "NONE",
      ok: false,
      reason: "READ_QUERY_FAILED",
    }, null, 2));
    process.exit(3);
  }

  const marketBuckets = new Set(market.rows.map((r) => String(r.minute_bucket)));
  const chainBuckets = new Set(chain.rows.map((r) => String(r.minute_bucket)));
  const optionBuckets = new Set(options.rows.map((r) => String(r.minute_bucket)));
  const alignedBuckets = [...marketBuckets].filter((b) => chainBuckets.has(b) && optionBuckets.has(b));

  const firstBucket = market.rows.length ? market.rows[0].minute_bucket ?? null : null;
  const lastBucket = market.rows.length ? market.rows[market.rows.length - 1].minute_bucket ?? null : null;

  console.log(JSON.stringify({
    version: VERSION,
    architectureRole: "READ_ONLY_OFFLINE_REPLAY_INPUT",
    productionImpact: "NONE",
    mutationAllowed: false,
    brokerCalls: false,
    telegramCalls: false,
    executionCalls: false,
    filters: args,
    coverage: {
      marketRows: market.rows.length,
      chainRows: chain.rows.length,
      optionRows: options.rows.length,
      marketBuckets: marketBuckets.size,
      chainBuckets: chainBuckets.size,
      optionBuckets: optionBuckets.size,
      fullyAlignedBuckets: alignedBuckets.length,
      firstMarketBucket: firstBucket,
      lastMarketBucket: lastBucket,
    },
    readiness: alignedBuckets.length > 0 ? "REPLAY_INPUT_AVAILABLE" : "NO_ALIGNED_REPLAY_INPUT",
    nextStep: alignedBuckets.length > 0
      ? "Feed aligned minute buckets into a deterministic replay adapter; keep all output research-only."
      : "Populate/verify normalized recorder tables before attempting deterministic replay.",
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    version: VERSION,
    architectureRole: "READ_ONLY_OFFLINE_REPLAY_INPUT",
    productionImpact: "NONE",
    ok: false,
    reason: "UNHANDLED_REPLAY_LOADER_ERROR",
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
