import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE61_OFFLINE_REPLAY_COVERAGE_ROUTE_V1";
const source = readFileSync(path, "utf8");

if (source.includes(marker)) {
  console.log(`[Phase61] ${marker} already present; no change.`);
  process.exit(0);
}

const anchor = 'app.route("/api/offline-research", offlineResearchRouter);';
if (!source.includes(anchor)) {
  throw new Error("[Phase61] Source drift: offline research mount anchor not found; refusing to patch.");
}

const route = `// PHASE61_OFFLINE_REPLAY_COVERAGE_ROUTE_V1\n// Research-only, read-only aggregate coverage check. No broker/auth calls, no Telegram,\n// no execution, no DB mutation, and no raw snapshot payload is returned.\napp.get("/api/offline-research/replay-input-coverage", async (c) => {\n  const symbol = String(c.req.query("symbol") || "NIFTY").toUpperCase();\n  if (!["NIFTY", "BANKNIFTY", "SENSEX"].includes(symbol)) {\n    return c.json({ ok: false, productionImpact: "NONE", reason: "INVALID_SYMBOL", allowed: ["NIFTY", "BANKNIFTY", "SENSEX"] }, 400);\n  }\n\n  const { dbIsConfigured, dbQuerySafe } = await import("./db.js");\n  if (!dbIsConfigured()) {\n    return c.json({ ok: false, productionImpact: "NONE", reason: "DATABASE_URL_NOT_CONFIGURED" }, 503);\n  }\n\n  const result = await dbQuerySafe<Record<string, string | number | null>>(\n    \`WITH\n       m AS (SELECT minute_bucket FROM market_snapshot_1m WHERE symbol = $1),\n       c AS (SELECT minute_bucket FROM chain_state_1m WHERE symbol = $1),\n       o AS (SELECT minute_bucket FROM option_snapshot_1m WHERE symbol = $1),\n       mb AS (SELECT DISTINCT minute_bucket FROM m),\n       cb AS (SELECT DISTINCT minute_bucket FROM c),\n       ob AS (SELECT DISTINCT minute_bucket FROM o),\n       aligned AS (SELECT minute_bucket FROM mb INTERSECT SELECT minute_bucket FROM cb INTERSECT SELECT minute_bucket FROM ob)\n     SELECT\n       (SELECT COUNT(*) FROM m)::int AS market_rows,\n       (SELECT COUNT(*) FROM c)::int AS chain_rows,\n       (SELECT COUNT(*) FROM o)::int AS option_rows,\n       (SELECT COUNT(*) FROM mb)::int AS market_buckets,\n       (SELECT COUNT(*) FROM cb)::int AS chain_buckets,\n       (SELECT COUNT(*) FROM ob)::int AS option_buckets,\n       (SELECT COUNT(*) FROM aligned)::int AS fully_aligned_buckets,\n       (SELECT MIN(minute_bucket)::text FROM mb) AS first_market_bucket,\n       (SELECT MAX(minute_bucket)::text FROM mb) AS last_market_bucket\`,\n    [symbol],\n  );\n\n  if (!result || !result.rows.length) {\n    return c.json({ ok: false, productionImpact: "NONE", reason: "READ_QUERY_FAILED" }, 503);\n  }\n\n  const coverage = result.rows[0];\n  const aligned = Number(coverage.fully_aligned_buckets || 0);\n  return c.json({\n    version: "OFFLINE_SHADOW_REPLAY_COVERAGE_V1",\n    architectureRole: "READ_ONLY_OFFLINE_REPLAY_INPUT",\n    productionImpact: "NONE",\n    mutationAllowed: false,\n    brokerCalls: false,\n    telegramCalls: false,\n    executionCalls: false,\n    symbol,\n    coverage,\n    readiness: aligned > 0 ? "REPLAY_INPUT_AVAILABLE" : "NO_ALIGNED_REPLAY_INPUT",\n  });\n});\n\n`;

const next = source.replace(anchor, route + anchor);
for (const required of [marker, "/api/offline-research/replay-input-coverage", "dbQuerySafe", "REPLAY_INPUT_AVAILABLE"]) {
  if (!next.includes(required)) throw new Error(`[Phase61] Verification failed: missing ${required}`);
}
if (/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE/i.test(route)) {
  throw new Error("[Phase61] Safety check failed: mutation SQL detected in route.");
}

writeFileSync(path, next, "utf8");
console.log(`[Phase61] Applied ${marker}.`);
