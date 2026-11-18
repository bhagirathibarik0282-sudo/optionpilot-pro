import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { SOURCES, assertReadOnly, validDate, validateArchive, readArchive, auditArchive, main, sha256 } from '../scripts/eod-retention-row-audit.mjs';
const date = '2026-11-16';
const archive = () => ({ schemaVersion: 'EOD_ARCHIVE_V2', tradingDate: date, ...Object.fromEntries(SOURCES.map(([key]) => [key, []])) });

test('apply is rejected before files, imports or database connection', async () => {
  assert.throws(() => assertReadOnly(['--apply'], {}), /APPLY_DISABLED/);
  await assert.rejects(main([], { EOD_RETENTION_APPLY: ' TRUE ' }), /APPLY_DISABLED/);
});
test('invalid calendar dates and archive dates are rejected', () => {
  assert.equal(validDate(date), date);
  assert.throws(() => validDate('2026-02-30'), /INVALID/);
  assert.throws(() => validateArchive({ ...archive(), tradingDate: '2026-11-17' }, date), /DATE_MISMATCH/);
});
test('required groups cannot be silently omitted', () => {
  const a = archive(); delete a.chainStates;
  assert.throws(() => validateArchive(a, date), /CATEGORY_MISSING:chainStates/);
});
test('duplicate IDs and unsafe numbers fail closed', () => {
  const a = archive(); a.marketSnapshots = [{ id: 1 }, { id: '1' }];
  assert.throws(() => validateArchive(a, date), /DUPLICATE/);
  a.marketSnapshots = [{ id: 9007199254740992 }];
  assert.throws(() => validateArchive(a, date), /UNSAFE/);
});
test('legacy participation omission is accepted for later database comparison', () => {
  const a = archive(); delete a.participationMinutes;
  assert.equal(validateArchive(a, date), a);
});
test('original JSON bytes and gzip readback have the same uncompressed checksum', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eod-row-audit-'));
  try {
    const bytes = Buffer.from(JSON.stringify(archive(), null, 2));
    const plain = join(dir, 'eod.json'), compressed = join(dir, 'eod.json.gz');
    await writeFile(plain, bytes); await writeFile(compressed, gzipSync(bytes));
    const a = await readArchive(plain, date), b = await readArchive(compressed, date);
    assert.equal(a.checksum, sha256(bytes)); assert.equal(a.checksum, b.checksum);
    assert.notEqual(b.compressedChecksum, b.checksum);
    await assert.rejects(readArchive(plain, date, 5), /TOO_LARGE/);
    // Compressed input fits, but its expanded content exceeds the configured bound.
    await assert.rejects(readArchive(compressed, date, gzipSync(bytes).length + 1));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
function fakeClient({ changed = false, late = false, missing = false, checksum = true, failQuery = false } = {}) {
  const a = archive(); a.marketSnapshots = [{ id: 1, value: 10 }];
  const input = { archive: a, checksum: sha256(JSON.stringify(a)) };
  const queries = [];
  const client = { query: async (sql, values) => {
    queries.push(sql);
    if (failQuery && sql.startsWith('SELECT count(*)::text')) throw new Error('query failed');
    if (sql.includes('to_regclass')) return { rows: [{ exists: !missing }] };
    if (sql.includes('FROM public.eod_archive_runs')) return { rows: [{ status: 'DRIVE_VERIFIED', drive_file_id: 'file-id', checksum_sha256: checksum ? input.checksum : 'wrong', record_count: 1 }] };
    if (sql.startsWith('SELECT count(*)::text')) return { rows: [{ n: sql.includes('public.market_snapshot_1m') ? (late ? 2 : 1) : 0 }] };
    if (sql.startsWith('SELECT count(t.id)')) return { rows: [{ ids: 1, contents: changed ? 0 : 1 }] };
    return { rows: [] };
  } };
  return { client, input, queries };
}
test('snapshot match never authorizes deletion or claims fresh Drive verification', async () => {
  const { client, input, queries } = fakeClient();
  const result = await auditArchive(client, input, date);
  assert.equal(result.status, 'SNAPSHOT_MATCH_ONLY');
  assert.equal(result.safeToDelete, false); assert.equal(result.deletionAuthorized, false);
  assert.equal(result.archiveByteSource, 'LOCAL_COPY_NOT_FRESH_DRIVE_READBACK');
  assert.match(queries[0], /REPEATABLE READ READ ONLY/);
  assert.equal(queries.at(-1), 'COMMIT');
  assert.ok(queries.every(q => !/\b(DELETE|UPDATE|INSERT|VACUUM|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(q)));
});
test('same count with changed contents is reported as a mismatch', async () => {
  const { client, input } = fakeClient({ changed: true });
  const r = await auditArchive(client, input, date);
  assert.equal(r.status, 'INCOMPLETE_OR_MISMATCHED');
  assert.equal(r.categories[0].changedRows, 1);
});
test('late rows are not covered by an earlier archive', async () => {
  const { client, input } = fakeClient({ late: true });
  const r = await auditArchive(client, input, date);
  assert.equal(r.categories[0].sourceRowsAbsentFromArchive, 1);
  assert.equal(r.status, 'INCOMPLETE_OR_MISMATCHED');
});
test('receipt checksum mismatch cannot pass', async () => {
  const { client, input } = fakeClient({ checksum: false });
  assert.equal((await auditArchive(client, input, date)).receiptMatches, false);
});
test('missing source tables and failed queries roll back instead of passing', async () => {
  for (const options of [{ missing: true }, { failQuery: true }]) {
    const { client, input, queries } = fakeClient(options);
    await assert.rejects(auditArchive(client, input, date));
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.ok(!queries.includes('COMMIT'));
  }
});

// Optional real PostgreSQL engine validation, isolated in memory; never uses DATABASE_URL.
(process.env.EOD_ROW_AUDIT_SQL_TEST === 'true' ? test : test.skip)('PostgreSQL engine: exact content, scope boundaries, late rows, lost rows and payload-only data', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const client = { query: (text, values) => db.query(text, values) };
  try {
    for (const [,table,scope] of SOURCES.slice(0,7)) {
      const column = scope.match(/t\.(\w+) >=/)[1];
      await db.exec(`CREATE TABLE ${table} (id BIGINT PRIMARY KEY, ${column} TIMESTAMPTZ NOT NULL, value JSONB)`);
    }
    await db.exec('CREATE TABLE app_state_log (id BIGINT PRIMARY KEY, kind TEXT, payload JSONB, created_at TIMESTAMPTZ)');
    await db.exec('CREATE TABLE eod_archive_runs (trading_date DATE PRIMARY KEY, status TEXT, drive_file_id TEXT, checksum_sha256 TEXT, record_count BIGINT)');
    // Exactly IST midnight is included; previous and next IST dates are excluded.
    await db.exec(`INSERT INTO market_snapshot_1m VALUES
      (1,'2026-11-15T18:30:00Z','{"value":10}'),
      (2,'2026-11-15T18:29:59.999Z','{}'),
      (3,'2026-11-16T18:30:00Z','{}');
      INSERT INTO app_state_log VALUES (4,'INTRADAY_NOTABLE_EVENT_V1','{"tradeDate":"2026-11-16"}','2026-11-18T00:00:00Z')`);
    const a = archive();
    a.marketSnapshots = (await db.query('SELECT to_jsonb(t) AS row FROM market_snapshot_1m t WHERE id=1')).rows.map(r=>r.row);
    a.researchMemories = (await db.query('SELECT to_jsonb(t) AS row FROM app_state_log t')).rows.map(r=>r.row);
    const input = { archive:a, checksum: sha256(JSON.stringify(a)) };
    await db.query("INSERT INTO eod_archive_runs VALUES ($1,'DRIVE_VERIFIED','file-id',$2,2)", [date,input.checksum]);
    let r = await auditArchive(client,input,date);
    assert.equal(r.status,'SNAPSHOT_MATCH_ONLY');
    assert.equal(r.categories[0].sourceCount,1);
    assert.equal(r.categories.find(c=>c.category==='researchMemories').matchedContents,1);
    await db.exec(`UPDATE market_snapshot_1m SET value='{"value":11}' WHERE id=1`);
    r = await auditArchive(client,input,date);
    assert.equal(r.categories[0].changedRows,1);
    await db.exec(`INSERT INTO market_snapshot_1m VALUES (5,'2026-11-16T04:00:00Z','{}')`);
    r = await auditArchive(client,input,date);
    assert.equal(r.categories[0].sourceRowsAbsentFromArchive,1);
    await db.exec('DELETE FROM market_snapshot_1m WHERE id=1');
    r = await auditArchive(client,input,date);
    assert.equal(r.categories[0].archiveRowsAbsentFromDate,1);
    assert.equal(r.categories[0].sourceRowsAbsentFromArchive,1);
    // Same payload count cannot become row identity proof.
    a.meaningfulNarrativeEvents = [{ message:'x' }];
    await db.exec(`INSERT INTO app_state_log VALUES (6,'meaningful_narrative_event','{"message":"x"}','2026-11-16T04:00:00Z')`);
    r = await auditArchive(client,input,date);
    assert.equal(r.categories.find(c=>c.category==='meaningfulNarrativeEvents').status,'PAYLOAD_ONLY_NO_ROW_IDENTITY');
    delete a.participationMinutes;
    await db.exec(`INSERT INTO app_state_log VALUES (7,'DASHBOARD_PARTICIPATION_MINUTE_V1','{"tradeDate":"2026-11-16"}','2026-11-18T00:00:00Z')`);
    r = await auditArchive(client,input,date);
    assert.equal(r.categories.at(-1).status,'ARCHIVE_CATEGORY_MISSING');
    assert.equal(r.safeToDelete,false);
    // Prove the engine rejects writes inside the same read-only transaction used by the audit.
    await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assert.rejects(db.exec('DELETE FROM market_snapshot_1m'), /read.only/i);
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});
