// Manual, read-only comparison. Never imported by application startup or retention jobs.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MEMORY_KINDS = "'CAS_CLOSING_FIXED_CONTRACT_MEMORY_V1','INTRADAY_NOTABLE_EVENT_V1','INTRADAY_PREMIUM_RESPONSE_V1','INTRADAY_MEMORY_SESSION_RECEIPT_V1'";
const timed = column => `t.${column} >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND t.${column} < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
export const SOURCES = [
  ['marketSnapshots', 'market_snapshot_1m', timed('minute_bucket'), true],
  ['optionSnapshots', 'option_snapshot_1m', timed('minute_bucket'), true],
  ['chainStates', 'chain_state_1m', timed('minute_bucket'), true],
  ['timeframeStates', 'timeframe_state', timed('block_end'), true],
  ['candidates', 'candidate_history', timed('observed_at'), true],
  ['tradePlans', 'trade_plan_history', timed('created_at'), true],
  ['tradeEvents', 'trade_event_history', timed('event_at'), true],
  ['meaningfulNarrativeEvents', 'app_state_log', `t.kind = 'meaningful_narrative_event' AND ${timed('created_at')}`, false],
  ['researchMemories', 'app_state_log', `t.kind IN (${MEMORY_KINDS}) AND t.payload->>'tradeDate' = $1::text`, true],
  ['participationMinutes', 'app_state_log', "t.kind = 'DASHBOARD_PARTICIPATION_MINUTE_V1' AND t.payload->>'tradeDate' = $1::text", false],
];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value) fail('INVALID_TRADING_DATE');
  return value;
}
function safeNumbers(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) fail('UNSAFE_JSON_NUMBER');
  if (value && typeof value === 'object') for (const entry of Object.values(value)) safeNumbers(entry);
}
export function validateArchive(archive, date) {
  validDate(date);
  if (archive?.schemaVersion !== 'EOD_ARCHIVE_V2' || archive.tradingDate !== date) fail('ARCHIVE_SCHEMA_OR_DATE_MISMATCH');
  safeNumbers(archive);
  for (const [category,,, identity] of SOURCES) {
    const rows = archive[category];
    if (category === 'participationMinutes' && rows === undefined) continue;
    if (!Array.isArray(rows)) fail(`ARCHIVE_CATEGORY_MISSING:${category}`);
    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`INVALID_ARCHIVE_ROW:${category}`);
      if (!identity) continue;
      if (!['string','number'].includes(typeof row.id) || !String(row.id).trim()) fail(`ARCHIVE_ROW_ID_MISSING:${category}`);
      const id = String(row.id);
      if (ids.has(id)) fail(`DUPLICATE_ARCHIVE_ROW_ID:${category}`);
      ids.add(id);
    }
  }
  return archive;
}
export async function readArchive(path, date, maxBytes = 128 * 1024 * 1024) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) fail('ARCHIVE_FILE_TOO_LARGE_OR_NOT_REGULAR');
  // One bounded file; JSON parsing still uses several times its byte size in RAM.
  const stored = await readFile(path);
  if (stored.length > maxBytes) fail('ARCHIVE_FILE_TOO_LARGE');
  const gzip = stored[0] === 0x1f && stored[1] === 0x8b;
  const bytes = gzip ? gunzipSync(stored, { maxOutputLength: maxBytes }) : stored;
  const archive = validateArchive(JSON.parse(bytes.toString('utf8')), date);
  return { archive, checksum: sha256(bytes), bytes: bytes.length, compressedChecksum: gzip ? sha256(stored) : null };
}
export function assertReadOnly(args = [], env = process.env) {
  if (args.includes('--apply') || env.EOD_RETENTION_APPLY?.trim().toLowerCase() === 'true') fail('APPLY_DISABLED_READ_ONLY_AUDIT');
}
function safeCount(value) {
  if (value === null || value === undefined || value === '') fail('INVALID_DATABASE_COUNT');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail('INVALID_DATABASE_COUNT');
  return n;
}
export async function auditArchive(client, input, date) {
  validateArchive(input.archive, date);
  if (!/^[0-9a-f]{64}$/.test(input.checksum ?? '')) fail('INVALID_ARCHIVE_CHECKSUM');
  let open = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    open = true;
    await client.query("SET LOCAL statement_timeout = '45000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const required = [...new Set([...SOURCES.map(s => s[1]), 'eod_archive_runs'])];
    for (const table of required) {
      const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`]);
      if (!result.rows[0]?.exists) fail(`REQUIRED_TABLE_MISSING:${table}`);
    }
    const receipts = await client.query('SELECT status, drive_file_id, checksum_sha256, record_count FROM public.eod_archive_runs WHERE trading_date = $1::date', [date]);
    const receipt = receipts.rows[0];
    const receiptMatches = receipts.rows.length === 1 && receipt.status === 'DRIVE_VERIFIED' && Boolean(receipt.drive_file_id) && receipt.checksum_sha256 === input.checksum;
    const categories = [];
    for (const [category, table, scope, identity] of SOURCES) {
      const rows = input.archive[category];
      const counted = await client.query(`SELECT count(*)::text AS n FROM public.${table} t WHERE ${scope}`, [date]);
      const sourceCount = safeCount(counted.rows[0].n);
      const result = { category, sourceCount, archivedCount: rows?.length ?? null };
      if (!rows) {
        categories.push({ ...result, status: sourceCount ? 'ARCHIVE_CATEGORY_MISSING' : 'LEGACY_CATEGORY_ABSENT_NO_SOURCE_ROWS' });
        continue;
      }
      if (!identity) {
        categories.push({ ...result, status: !sourceCount && !rows.length ? 'NO_SOURCE_ROWS' : 'PAYLOAD_ONLY_NO_ROW_IDENTITY', countMatches: sourceCount === rows.length });
        continue;
      }
      let matchedIds = 0, matchedContents = 0;
      for (let offset = 0; offset < rows.length; offset += 250) {
        // Populate only the ID using the real column type (text/UUID/bigint), preserving its index.
        const compared = await client.query(`SELECT count(t.id)::text AS ids,
          count(*) FILTER (WHERE t.id IS NOT NULL AND to_jsonb(t) = a.row)::text AS contents
          FROM jsonb_array_elements($2::jsonb) AS a(row)
          LEFT JOIN public.${table} t ON t.id = (jsonb_populate_record(NULL::public.${table}, jsonb_build_object('id', a.row->'id'))).id AND ${scope}`, [date, JSON.stringify(rows.slice(offset, offset + 250))]);
        matchedIds += safeCount(compared.rows[0].ids);
        matchedContents += safeCount(compared.rows[0].contents);
      }
      if (matchedIds > rows.length || matchedIds > sourceCount || matchedContents > matchedIds) fail(`NON_UNIQUE_SOURCE_ID:${category}`);
      categories.push({ ...result, matchedIds, matchedContents,
        changedRows: matchedIds - matchedContents,
        archiveRowsAbsentFromDate: rows.length - matchedIds,
        sourceRowsAbsentFromArchive: sourceCount - matchedIds,
        status: sourceCount === rows.length && matchedContents === sourceCount ? 'EXACT_ROWS_MATCH_AT_SNAPSHOT' : 'ROW_MISMATCH',
      });
    }
    const archiveCount = SOURCES.reduce((n, [key]) => n + (input.archive[key]?.length ?? 0), 0);
    const receiptCountMatches = receipt ? safeCount(receipt.record_count) === archiveCount : false;
    await client.query('COMMIT');
    open = false;
    return { mode: 'READ_ONLY_ROW_AUDIT_V1', tradingDate: date,
      isolation: 'REPEATABLE_READ_READ_ONLY', productionWrites: 0, deletionAuthorized: false, safeToDelete: false,
      archiveByteSource: 'LOCAL_COPY_NOT_FRESH_DRIVE_READBACK', archiveChecksumSha256: input.checksum,
      receiptMatches, receiptCountMatches, driveFileId: receipt?.drive_file_id ?? null,
      status: receiptMatches && receiptCountMatches && categories.every(c => c.status === 'EXACT_ROWS_MATCH_AT_SNAPSHOT' || c.status === 'LEGACY_CATEGORY_ABSENT_NO_SOURCE_ROWS' || c.status === 'NO_SOURCE_ROWS') ? 'SNAPSHOT_MATCH_ONLY' : 'INCOMPLETE_OR_MISMATCHED',
      categories,
      limitations: ['Selected EOD categories only; not a full PostgreSQL backup', 'Payload-only groups cannot prove database row identity', 'Local bytes matching a historic receipt are not a fresh Drive read-back', 'No deletion or retention-policy change is implemented; later changes require revalidation', 'Read-only queries still need a healthy database and working space; no disk is reclaimed'],
    };
  } catch (error) {
    if (open) { try { await client.query('ROLLBACK'); } catch {} }
    throw error;
  }
}
export async function main(args = process.argv.slice(2), env = process.env) {
  assertReadOnly(args, env);
  if (args.length !== 4 || args[0] !== '--date' || args[2] !== '--archive') fail('USAGE: --date YYYY-MM-DD --archive /path/to/existing-eod.json[.gz]');
  const date = validDate(args[1]);
  if (!env.DATABASE_URL?.trim()) fail('DATABASE_URL_NOT_SET');
  const input = await readArchive(args[3], date);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 50000, application_name: 'optionpilot-read-only-row-audit', options: '-c default_transaction_read_only=on' });
  try {
    await client.connect();
    return await auditArchive(client, input, date);
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await main();
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'SNAPSHOT_MATCH_ONLY') process.exitCode = 2;
  } catch (error) {
    // Do not log driver errors, connection strings, rows or credentials.
    const known = /^(APPLY_DISABLED|USAGE:|INVALID_|ARCHIVE_|DUPLICATE_|UNSAFE_|DATABASE_URL_NOT_SET|REQUIRED_TABLE_|NON_UNIQUE_)/.test(error?.message ?? '');
    console.error(JSON.stringify({ status: 'AUDIT_BLOCKED', productionWrites: 0, safeToDelete: false, reason: known ? error.message : 'CONNECTION_QUERY_OR_FILE_CHECK_FAILED', code: /^[A-Z0-9_]{1,40}$/.test(error?.code ?? '') ? error.code : null }));
    process.exitCode = 1;
  }
}
