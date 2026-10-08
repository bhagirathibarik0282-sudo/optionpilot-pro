import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { dbQuerySafe } from "../db.js";
import { persistConnectedDriveSession, loadConnectedDriveRefreshToken } from "../drive-connected-session.js";
import { sourceCounts, buildPayload, alreadyDriveVerified } from "../eod-archive-job.js";

test("PostgreSQL export includes recovered memory by observed date and upgrades V1 receipts", { skip: !process.env.EOD_ARCHIVE_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.EOD_ARCHIVE_TEST_DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [table, column] of [["market_snapshot_1m", "minute_bucket"], ["option_snapshot_1m", "minute_bucket"], ["chain_state_1m", "minute_bucket"], ["timeframe_state", "block_end"], ["candidate_history", "observed_at"], ["trade_plan_history", "created_at"], ["trade_event_history", "event_at"]]) {
      await client.query(`CREATE TEMP TABLE ${table} (${column} timestamptz, expiry date, strike numeric, option_type text) ON COMMIT DROP`);
    }
    await client.query("CREATE TEMP TABLE app_state_log (id bigserial, kind text, payload jsonb, created_at timestamptz) ON COMMIT DROP");
    const kinds = ["CAS_CLOSING_FIXED_CONTRACT_MEMORY_V1", "INTRADAY_NOTABLE_EVENT_V1", "INTRADAY_PREMIUM_RESPONSE_V1", "INTRADAY_MEMORY_SESSION_RECEIPT_V1"];
    for (const kind of kinds) await client.query("INSERT INTO app_state_log(kind,payload,created_at) VALUES ($1,$2,'2026-10-09T01:00:00Z')", [kind, JSON.stringify({ tradeDate: "2026-10-08", memoryKey: kind + "/fixture", version: kind })]);
    await client.query("INSERT INTO app_state_log(kind,payload,created_at) VALUES ('GOOGLE_DRIVE_CONNECTED_SESSION_V1','{\"tradeDate\":\"2026-10-08\"}','2026-10-08'), ($1,'{\"tradeDate\":\"2026-10-07\"}','2026-10-08'), ($1,'{}','2026-10-08')", [kinds[0]]);
    const payload = await buildPayload(client, "2026-10-08");
    assert.equal(payload.schemaVersion, "EOD_ARCHIVE_V2");
    assert.equal(payload.researchMemories.length, 4);
    assert.deepEqual(payload.researchMemories.map((row: { kind: string }) => row.kind).sort(), kinds.sort());
    assert.equal((await sourceCounts(client, "2026-10-08")).total, 4);
    assert.equal((await buildPayload(client, "2026-10-07")).researchMemories.length, 1);
    await client.query("CREATE TEMP TABLE eod_archive_runs (trading_date date,status text) ON COMMIT DROP; CREATE TEMP TABLE eod_archive_payloads (trading_date date,payload jsonb) ON COMMIT DROP");
    await client.query("INSERT INTO eod_archive_runs VALUES ('2026-10-08','DRIVE_VERIFIED'); INSERT INTO eod_archive_payloads VALUES ('2026-10-08','{\"schemaVersion\":\"EOD_ARCHIVE_V1\"}')");
    assert.equal(await alreadyDriveVerified(client, "2026-10-08"), false);
    await client.query("UPDATE eod_archive_payloads SET payload=$1", [JSON.stringify(payload)]);
    assert.equal(await alreadyDriveVerified(client, "2026-10-08"), true);
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});

test("PostgreSQL shared encrypted session readback and restart-equivalent loading", { skip: !process.env.EOD_ARCHIVE_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.EOD_ARCHIVE_TEST_DATABASE_URL });
  const client = await pool.connect();
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "DATABASE_URL"], old = names.map(n => process.env[n]);
  try {
    await client.query("BEGIN; CREATE TEMP TABLE app_state_log (id bigserial,kind text,payload jsonb,created_at timestamptz DEFAULT now()) ON COMMIT DROP");
    ["fixture-client", "fixture-secret", "fixture-db"].forEach((v, i) => { process.env[names[i]] = v; });
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", createHash("sha256").update("fixture-secret").digest(), iv);
    const bytes = Buffer.concat([cipher.update("fixture-refresh"), cipher.final()]);
    const ciphertext = [iv.toString("hex"), cipher.getAuthTag().toString("hex"), bytes.toString("hex")].join(":");
    const query = (async (sql: string, params: unknown[]) => ({ rows: (await client.query(sql, params)).rows })) as typeof dbQuerySafe;
    assert.equal(await persistConnectedDriveSession(ciphertext, "2026-10-08T19:35:43.131Z", query), true);
    assert.equal(await persistConnectedDriveSession(ciphertext, "2026-10-08T19:35:43.131Z", query), true);
    assert.equal((await client.query("SELECT count(*) FROM app_state_log")).rows[0].count, "1");
    const freshReader = (async (sql: string, params: unknown[]) => ({ rows: (await client.query(sql, params)).rows })) as typeof dbQuerySafe;
    assert.equal(await loadConnectedDriveRefreshToken("fixture-client", "fixture-secret", freshReader), "fixture-refresh");
    assert.equal(JSON.stringify((await client.query("SELECT payload FROM app_state_log")).rows).includes("fixture-refresh"), false);
  } finally { names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; }); await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
