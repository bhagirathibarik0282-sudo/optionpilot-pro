import pg from "pg";

const { Pool } = pg;

export interface ShadowContractIdentityAtomicClaimEnvelope {
  version: "SHADOW_CONTRACT_IDENTITY_PERSISTENCE_V1";
  persistedAt: string;
  tradeId: string;
  identity: unknown;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export type ShadowContractIdentityAtomicStoreResult =
  | { status: "FOUND"; payload: unknown }
  | { status: "NOT_FOUND"; payload: null }
  | { status: "UNAVAILABLE"; payload: null };

export interface ShadowContractIdentityAtomicSqlPort {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

let pool: InstanceType<typeof Pool> | null = null;
let schemaReady: Promise<boolean> | null = null;

function getPool(): InstanceType<typeof Pool> | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (pool) return pool;
  try {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      max: 2,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
    pool.on("error", (err: Error) => {
      console.error("[SHADOW_IDENTITY_DB] idle client error:", err.message);
    });
    return pool;
  } catch (err) {
    console.error(
      "[SHADOW_IDENTITY_DB] pool construction failed:",
      err instanceof Error ? err.message : err,
    );
    pool = null;
    return null;
  }
}

async function ensureSchema(port: ShadowContractIdentityAtomicSqlPort): Promise<boolean> {
  try {
    await port.query(`
      CREATE TABLE IF NOT EXISTS shadow_contract_identity_claim (
        trade_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    return true;
  } catch (err) {
    console.error(
      "[SHADOW_IDENTITY_DB] schema init failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function readyPort(
  injected?: ShadowContractIdentityAtomicSqlPort,
): Promise<ShadowContractIdentityAtomicSqlPort | null> {
  if (injected) return (await ensureSchema(injected)) ? injected : null;
  const p = getPool();
  if (!p) return null;
  if (!schemaReady) schemaReady = ensureSchema(p);
  return (await schemaReady) ? p : null;
}

export async function claimShadowContractIdentityAtomic(
  envelope: ShadowContractIdentityAtomicClaimEnvelope,
  injected?: ShadowContractIdentityAtomicSqlPort,
): Promise<ShadowContractIdentityAtomicStoreResult> {
  const port = await readyPort(injected);
  if (!port) return { status: "UNAVAILABLE", payload: null };

  try {
    await port.query(
      `INSERT INTO shadow_contract_identity_claim (trade_id, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (trade_id) DO NOTHING`,
      [envelope.tradeId, JSON.stringify(envelope)],
    );

    const readBack = await port.query<{ payload: unknown }>(
      "SELECT payload FROM shadow_contract_identity_claim WHERE trade_id = $1",
      [envelope.tradeId],
    );
    if (readBack.rows.length !== 1) return { status: "UNAVAILABLE", payload: null };
    return { status: "FOUND", payload: readBack.rows[0].payload };
  } catch (err) {
    console.error(
      `[SHADOW_IDENTITY_DB] atomic claim failed for tradeId="${envelope.tradeId}":`,
      err instanceof Error ? err.message : err,
    );
    return { status: "UNAVAILABLE", payload: null };
  }
}

export async function loadShadowContractIdentityAtomic(
  tradeId: string,
  injected?: ShadowContractIdentityAtomicSqlPort,
): Promise<ShadowContractIdentityAtomicStoreResult> {
  const normalized = typeof tradeId === "string" ? tradeId.trim() : "";
  if (!normalized) return { status: "UNAVAILABLE", payload: null };

  const port = await readyPort(injected);
  if (!port) return { status: "UNAVAILABLE", payload: null };

  try {
    const result = await port.query<{ payload: unknown }>(
      "SELECT payload FROM shadow_contract_identity_claim WHERE trade_id = $1",
      [normalized],
    );
    if (result.rows.length === 0) return { status: "NOT_FOUND", payload: null };
    if (result.rows.length !== 1) return { status: "UNAVAILABLE", payload: null };
    return { status: "FOUND", payload: result.rows[0].payload };
  } catch (err) {
    console.error(
      `[SHADOW_IDENTITY_DB] atomic load failed for tradeId="${normalized}":`,
      err instanceof Error ? err.message : err,
    );
    return { status: "UNAVAILABLE", payload: null };
  }
}
