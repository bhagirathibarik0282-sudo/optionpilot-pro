import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE62_REPLAY_FRAME_PROBE_V1";
const source = readFileSync(path, "utf8");

if (source.includes(marker)) {
  console.log(`[Phase62] ${marker} already present; no change.`);
  process.exit(0);
}

const anchor = 'app.route("/api/offline-research", offlineResearchRouter);';
if (!source.includes(anchor)) {
  throw new Error("[Phase62] Source drift: offline research mount anchor not found; refusing to patch.");
}

const route = `// PHASE62_REPLAY_FRAME_PROBE_V1\n// Research-only reconstruction probe. SELECT-only DB access; no broker/auth, Telegram, execution, or mutation.\napp.get("/api/offline-research/replay-frame-probe", async (c) => {\n  const symbol = String(c.req.query("symbol") || "NIFTY").toUpperCase();\n  if (!["NIFTY", "BANKNIFTY", "SENSEX"].includes(symbol)) {\n    return c.json({ ok: false, productionImpact: "NONE", reason: "INVALID_SYMBOL", allowed: ["NIFTY", "BANKNIFTY", "SENSEX"] }, 400);\n  }\n\n  const { dbIsConfigured, dbQuerySafe } = await import("./db.js");\n  if (!dbIsConfigured()) return c.json({ ok: false, productionImpact: "NONE", reason: "DATABASE_URL_NOT_CONFIGURED" }, 503);\n\n  const bucketResult = await dbQuerySafe<{ minute_bucket: string }>(\n    \`WITH mb AS (SELECT DISTINCT minute_bucket FROM market_snapshot_1m WHERE symbol=$1),\n           cb AS (SELECT DISTINCT minute_bucket FROM chain_state_1m WHERE symbol=$1),\n           ob AS (SELECT DISTINCT minute_bucket FROM option_snapshot_1m WHERE symbol=$1),\n           aligned AS (SELECT minute_bucket FROM mb INTERSECT SELECT minute_bucket FROM cb INTERSECT SELECT minute_bucket FROM ob)\n       SELECT minute_bucket::text FROM aligned ORDER BY minute_bucket DESC LIMIT 1\`,\n    [symbol],\n  );\n  const minuteBucket = bucketResult?.rows?.[0]?.minute_bucket ?? null;\n  if (!minuteBucket) return c.json({ ok: false, productionImpact: "NONE", reason: "NO_ALIGNED_REPLAY_INPUT", symbol }, 404);\n\n  const market = await dbQuerySafe<Record<string, unknown>>(\n    \`SELECT symbol, minute_bucket, snapshot_id, exchange_timestamp, backend_timestamp, freshness_status,\n            spot_ltp, spot_open, spot_high, spot_low, spot_prev_close, vwap, pdh, pdl, gap_percent,\n            future_ltp, future_vwap, future_oi, future_oi_change, future_volume, future_basis,\n            india_vix, india_vix_change, calculation_version\n       FROM market_snapshot_1m WHERE symbol=$1 AND minute_bucket=$2::timestamptz LIMIT 1\`,\n    [symbol, minuteBucket],\n  );\n\n  const chain = await dbQuerySafe<Record<string, unknown>>(\n    \`SELECT symbol, minute_bucket, expiry, expiry_bucket, atm_strike, full_chain_oi_pcr, band7_oi_pcr, volume_pcr,\n            max_pain, call_wall_strike, call_wall_oi, call_wall_strength, call_wall_distance, call_wall_migration,\n            put_wall_strike, put_wall_oi, put_wall_strength, put_wall_distance, put_wall_migration, atm_iv,\n            straddle_ltp, straddle_change, validation_status, calculation_version\n       FROM chain_state_1m WHERE symbol=$1 AND minute_bucket=$2::timestamptz ORDER BY expiry ASC LIMIT 12\`,\n    [symbol, minuteBucket],\n  );\n\n  const options = await dbQuerySafe<Record<string, unknown>>(\n    \`WITH base AS (\n         SELECT *, MIN(ABS(COALESCE(atm_offset, 99))) OVER (PARTITION BY expiry, option_type) AS min_abs_offset\n         FROM option_snapshot_1m WHERE symbol=$1 AND minute_bucket=$2::timestamptz\n       )\n       SELECT symbol, minute_bucket, expiry, expiry_bucket, dte, strike, option_type, atm_offset, is_candidate, is_wall,\n              ltp, bid, ask, spread, volume, oi, oi_change, iv, delta, gamma, vega, theta, intrinsic, extrinsic,\n              day_high, day_low, pdh, pdl, quote_timestamp, quote_age_seconds, liquidity_status, validation_status, calculation_version\n       FROM base\n       WHERE is_candidate=TRUE OR is_wall=TRUE OR ABS(COALESCE(atm_offset, 99)) <= 2\n       ORDER BY expiry ASC, strike ASC, option_type ASC LIMIT 80\`,\n    [symbol, minuteBucket],\n  );\n\n  if (!market || !chain || !options) return c.json({ ok: false, productionImpact: "NONE", reason: "READ_QUERY_FAILED" }, 503);\n\n  return c.json({\n    version: "OFFLINE_REPLAY_FRAME_PROBE_V1", architectureRole: "READ_ONLY_REPLAY_RECONSTRUCTION", productionImpact: "NONE",\n    mutationAllowed: false, brokerCalls: false, telegramCalls: false, executionCalls: false,\n    symbol, minuteBucket, market: market.rows[0] ?? null, chain: chain.rows, options: options.rows,\n    counts: { marketRows: market.rows.length, chainRows: chain.rows.length, optionRows: options.rows.length },\n    nextStep: "Map this normalized replay frame to the existing deterministic server validator/rule-engine input without inventing a second scoring formula."\n  });\n});\n\n`;

const next = source.replace(anchor, route + anchor);
for (const required of [marker, "/api/offline-research/replay-frame-probe", "READ_ONLY_REPLAY_RECONSTRUCTION", "dbQuerySafe"]) {
  if (!next.includes(required)) throw new Error(`[Phase62] Verification failed: missing ${required}`);
}
if (/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i.test(route)) {
  throw new Error("[Phase62] Safety check failed: mutation SQL detected in route.");
}
if (/fetchMarket|refreshMarketSnapshot|sendTelegram|placeOrder|executeTrade/i.test(route)) {
  throw new Error("[Phase62] Safety check failed: forbidden live/execution call detected.");
}

writeFileSync(path, next, "utf8");
console.log(`[Phase62] Applied ${marker}.`);
