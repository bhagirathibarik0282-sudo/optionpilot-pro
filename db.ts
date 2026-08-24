// ============================================================================
// PostgreSQL persistence layer -- added 2026-08-20, Week 1 of the approved
// roadmap ("PostgreSQL Persistence: Recorder snapshots, Journal, FII/DII,
// Rollover history survive restart/redeploy").
//
// Design choice (deliberately simple for this first pass): ONE generic
// append-only table (`app_state_log`) with a `kind` discriminator and a
// JSONB payload, instead of four separate rigid per-feature tables. Every
// persisted record (Recorder snapshot, Journal entry, FII/DII entry,
// Rollover snapshot) already has its own well-defined TypeScript interface
// in server.ts -- storing that same object as JSONB means zero risk of a
// hand-written SQL schema silently drifting out of sync with those
// interfaces, and zero migration work when a field is added/renamed later.
// The tradeoff (no per-field SQL querying/indexing) is an accepted one for
// this pass -- it can be normalized into dedicated tables later if a
// specific query pattern needs it (e.g. for Week 4 backtesting), without
// touching any of the call sites below.
//
// HARD SAFETY RULE (per explicit "no bug" requirement): every exported
// function here must NEVER throw, and must NEVER block/degrade the app if
// DATABASE_URL is unset OR the DB is unreachable. This layer is additive
// only -- the app must behave EXACTLY as it did before this file existed
// when there is no working database, which is why every function starts
// with a "no pool -> no-op" guard and wraps its body in try/catch.
// ============================================================================

import pg from "pg";

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;
let poolInitAttempted = false;

function getPool(): InstanceType<typeof Pool> | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (pool) return pool;
  if (poolInitAttempted) return null;
  poolInitAttempted = true;
  try {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
    pool.on("error", (err: Error) => {
      console.error("[DB] idle client error (pool stays usable):", err.message);
    });
  } catch (err) {
    console.error("[DB] failed to construct connection pool -- persistence disabled for this run:", err instanceof Error ? err.message : err);
    pool = null;
  }
  return pool;
}

export async function dbInit(): Promise<void> {
  const p = getPool();
  if (!p) {
    console.log("[DB] DATABASE_URL not set -- persistence disabled, running in-memory only (same behavior as before this file existed)");
    return;
  }
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS app_state_log (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_app_state_log_kind_created ON app_state_log (kind, created_at DESC);`);
    console.log("[DB] connected, schema ready");
  } catch (err) {
    console.error("[DB] schema init failed -- persistence disabled for this run:", err instanceof Error ? err.message : err);
    pool = null;
  }
}

export async function dbInsert(kind: string, payload: unknown): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await p.query("INSERT INTO app_state_log (kind, payload) VALUES ($1, $2::jsonb)", [kind, JSON.stringify(payload)]);
  } catch (err) {
    console.error(`[DB] insert failed for kind="${kind}" (in-memory state is unaffected, only this DB write was lost):`, err instanceof Error ? err.message : err);
  }
}

export async function dbLoadRecent<T>(kind: string, limit: number): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query("SELECT payload FROM app_state_log WHERE kind = $1 ORDER BY created_at DESC LIMIT $2", [kind, limit]);
    return res.rows.map((r: { payload: T }) => r.payload).reverse();
  } catch (err) {
    console.error(`[DB] load failed for kind="${kind}" (falling back to empty -- app starts as if no history existed):`, err instanceof Error ? err.message : err);
    return [];
  }
}

// Additive escape hatch for dedicated normalized research tables.
// It preserves this module's hard safety rule: callers receive null instead
// of an exception when Postgres is unavailable or a query fails.
export async function dbQuerySafe<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[] } | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const res = await p.query(sql, params);
    return { rows: res.rows as T[] };
  } catch (err) {
    console.error("[DB] normalized research query failed (caller must degrade safely):", err instanceof Error ? err.message : err);
    return null;
  }
}

export function dbIsConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}
