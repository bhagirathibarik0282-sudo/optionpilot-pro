import pg, { type PoolClient } from "pg";
import { archiveKey, decideEodArchive, indiaTradingDateFromIso, isWeekdayTradingCandidate } from "./eod-archive-core.js";
import { uploadEodArchiveToDrive } from "./eod-drive-upload.js";

const { Pool } = pg;

function getPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL_NOT_SET");
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({ connectionString: url, max: 2, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
}

async function ensureSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS eod_archive_runs (
      trading_date DATE PRIMARY KEY,
      archive_key TEXT NOT NULL UNIQUE,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      record_count BIGINT NOT NULL DEFAULT 0,
      archive_destination TEXT,
      error TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS eod_archive_payloads (
      trading_date DATE PRIMARY KEY,
      archive_key TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      record_count BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE eod_archive_runs ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
    ALTER TABLE eod_archive_runs ADD COLUMN IF NOT EXISTS drive_verified_at TIMESTAMPTZ;
    ALTER TABLE eod_archive_runs ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;
    ALTER TABLE eod_archive_runs ADD COLUMN IF NOT EXISTS cleanup_allowed BOOLEAN NOT NULL DEFAULT false;
  `);
}

async function sourceCounts(client: PoolClient, tradingDate: string) {
  const q = await client.query(`
    SELECT
      (SELECT count(*) FROM market_snapshot_1m WHERE (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS market_count,
      (SELECT count(*) FROM option_snapshot_1m WHERE (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS option_count,
      (SELECT count(*) FROM chain_state_1m WHERE (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS chain_count,
      (SELECT count(*) FROM timeframe_state WHERE (block_end AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS timeframe_count,
      (SELECT count(*) FROM candidate_history WHERE (observed_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS candidate_count,
      (SELECT count(*) FROM trade_plan_history WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS trade_plan_count,
      (SELECT count(*) FROM trade_event_history WHERE (event_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS trade_event_count
  `, [tradingDate]);
  const row = q.rows[0] || {};
  const counts = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v || 0)]));
  const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
  return { counts, total };
}

async function alreadyDriveVerified(client: PoolClient, tradingDate: string) {
  const q = await client.query("SELECT status FROM eod_archive_runs WHERE trading_date=$1::date", [tradingDate]);
  return q.rows[0]?.status === "DRIVE_VERIFIED";
}

async function buildPayload(client: PoolClient, tradingDate: string) {
  const result = await client.query(`
    SELECT jsonb_build_object(
      'schemaVersion','EOD_ARCHIVE_V1',
      'tradingDate',$1::text,
      'marketSnapshots',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY minute_bucket), '[]'::jsonb) FROM market_snapshot_1m t WHERE (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date=$1::date),
      'optionSnapshots',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY minute_bucket, expiry, strike, option_type), '[]'::jsonb) FROM option_snapshot_1m t WHERE (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date=$1::date),
      'chainStates',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY minute_bucket, expiry), '[]'::jsonb) FROM chain_state_1m t WHERE (minute_bucket AT TIME ZONE 'Asia/Kolkata')::date=$1::date),
      'timeframeStates',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY block_end), '[]'::jsonb) FROM timeframe_state t WHERE (block_end AT TIME ZONE 'Asia/Kolkata')::date=$1::date),
      'candidates',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY observed_at), '[]'::jsonb) FROM candidate_history t WHERE (observed_at AT TIME ZONE 'Asia/Kolkata')::date=$1::date),
      'tradePlans',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY created_at), '[]'::jsonb) FROM trade_plan_history t WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=$1::date),
      'tradeEvents',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY event_at), '[]'::jsonb) FROM trade_event_history t WHERE (event_at AT TIME ZONE 'Asia/Kolkata')::date=$1::date)
    ) AS payload
  `, [tradingDate]);
  return result.rows[0]?.payload || null;
}

export async function runEodArchive(nowIso = new Date().toISOString()) {
  const tradingDate = process.env.EOD_ARCHIVE_TRADING_DATE?.trim() || indiaTradingDateFromIso(nowIso);
  if (!isWeekdayTradingCandidate(tradingDate)) {
    console.log(`[EOD_ARCHIVE] skip date=${tradingDate} reason=NON_WEEKDAY`);
    return { ok: true, status: "SKIPPED_NO_DATA", tradingDate, reason: "NON_WEEKDAY" };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [archiveKey(tradingDate)]);

    const completed = await alreadyDriveVerified(client, tradingDate);
    const { counts, total } = await sourceCounts(client, tradingDate);
    const decision = decideEodArchive({ tradingDate, nowIso, alreadyCompleted: completed, sourceRecordCount: total });

    if (!decision.shouldRun) {
      console.log(`[EOD_ARCHIVE] skip date=${tradingDate} status=${decision.status} reason=${decision.reason}`);
      return { ok: true, tradingDate, ...decision, counts, total };
    }

    const key = archiveKey(tradingDate);
    await client.query(`
      INSERT INTO eod_archive_runs (trading_date, archive_key, started_at, status, record_count, archive_destination, error, cleanup_allowed, updated_at)
      VALUES ($1::date,$2,now(),'STARTED',$3,'POSTGRES:eod_archive_payloads',NULL,false,now())
      ON CONFLICT (trading_date) DO UPDATE SET
        archive_key=EXCLUDED.archive_key, started_at=now(), completed_at=NULL, status='STARTED',
        record_count=EXCLUDED.record_count, archive_destination=EXCLUDED.archive_destination, error=NULL,
        cleanup_allowed=false, updated_at=now()
      WHERE eod_archive_runs.status <> 'DRIVE_VERIFIED'
    `, [tradingDate, key, total]);

    try {
      const payload = await buildPayload(client, tradingDate);
      if (!payload) throw new Error("ARCHIVE_PAYLOAD_EMPTY");
      const payloadJson = JSON.stringify(payload);

      await client.query("BEGIN");
      await client.query(`
        INSERT INTO eod_archive_payloads (trading_date, archive_key, payload, record_count)
        VALUES ($1::date,$2,$3::jsonb,$4)
        ON CONFLICT (trading_date) DO UPDATE SET
          archive_key=EXCLUDED.archive_key, payload=EXCLUDED.payload, record_count=EXCLUDED.record_count
      `, [tradingDate, key, payloadJson, total]);
      await client.query(`
        UPDATE eod_archive_runs SET status='POSTGRES_COMPLETED', completed_at=now(), record_count=$2,
          archive_destination='POSTGRES:eod_archive_payloads', error=NULL, cleanup_allowed=false, updated_at=now()
        WHERE trading_date=$1::date
      `, [tradingDate, total]);
      await client.query("COMMIT");

      let drive;
      try {
        drive = await uploadEodArchiveToDrive(tradingDate, payloadJson);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await client.query(`
          UPDATE eod_archive_runs SET status='DRIVE_FAILED', archive_destination='POSTGRES:eod_archive_payloads',
            error=$2, cleanup_allowed=false, updated_at=now() WHERE trading_date=$1::date
        `, [tradingDate, message]);
        console.error(`[EOD_ARCHIVE] drive failed date=${tradingDate} error=${message}`);
        return { ok: false, status: "DRIVE_FAILED", tradingDate, recordCount: total, counts, error: message };
      }

      await client.query(`
        UPDATE eod_archive_runs SET status='DRIVE_VERIFIED', drive_file_id=$2, drive_verified_at=now(),
          checksum_sha256=$3, archive_destination=$4, error=NULL, cleanup_allowed=true, updated_at=now()
        WHERE trading_date=$1::date
      `, [tradingDate, drive.fileId, drive.checksumSha256, `GOOGLE_DRIVE:${drive.fileId}`]);

      console.log(`[EOD_ARCHIVE] drive verified date=${tradingDate} records=${total} file=${drive.fileId}`);
      return {
        ok: true,
        status: "DRIVE_VERIFIED",
        tradingDate,
        archiveKey: key,
        recordCount: total,
        counts,
        driveFileId: drive.fileId,
        checksumSha256: drive.checksumSha256,
        cleanupAllowed: true,
      };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      const message = err instanceof Error ? err.message : String(err);
      await client.query(`UPDATE eod_archive_runs SET status='FAILED', error=$2, cleanup_allowed=false, updated_at=now() WHERE trading_date=$1::date`, [tradingDate, message]);
      console.error(`[EOD_ARCHIVE] failed date=${tradingDate} error=${message}`);
      return { ok: false, status: "FAILED", tradingDate, error: message };
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [archiveKey(tradingDate)]); } catch {}
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEodArchive().then((r) => {
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  }).catch((err) => {
    console.error(`[EOD_ARCHIVE] fatal ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
