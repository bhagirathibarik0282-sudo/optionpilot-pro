import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { casOptionWriterPrecedenceSql } from './cas-option-writer-precedence-fixture.mjs';

function generatedDbSource() {
  const dir = mkdtempSync(join(tmpdir(), 'cas-writer-wiring-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const name of ['server.ts', 'db.ts', 'storage-v3-adapter.ts', 'h1-replay-http.ts', 'scripts/wire-storage-v3-runtime.mjs']) {
      copyFileSync(new URL('../' + name, import.meta.url), join(dir, name));
    }
    const script = join(dir, 'scripts/wire-storage-v3-runtime.mjs');
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    const first = readFileSync(join(dir, 'db.ts'), 'utf8');
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    assert.equal(readFileSync(join(dir, 'db.ts'), 'utf8'), first, 'wiring stays idempotent');
    return first;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('CAS writer fixture exercises production SQL and both whole-row write orders', () => {
  const sql = casOptionWriterPrecedenceSql();
  assert.match(sql, /H1 then Storage split market and option snapshot identity/);
  assert.match(sql, /Storage then H1 lost whole H1 option row/);
  assert.match(sql, /derived_oi_change_gap_seconds = 60/);
  assert.match(sql, /CREATE TEMP TABLE cas_option_writer_test/);
  assert.match(sql, /ROLLBACK/);
});

test('startup-generated depth SQL retains option precedence and exact depth columns', () => {
  const sql = casOptionWriterPrecedenceSql(generatedDbSource());
  assert.match(sql, /bid_qty=EXCLUDED.bid_qty, ask_qty=EXCLUDED.ask_qty\s+WHERE cas_option_writer_test/);
  assert.match(sql, /o.bid_qty = 10 AND o.ask_qty = 20/);
});

test('PostgreSQL preserves coherent market/option IDs, invalidation and contract grain', {
  skip: !process.env.CAS_MEMORY_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.CAS_MEMORY_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(casOptionWriterPrecedenceSql());
    await client.query(casOptionWriterPrecedenceSql(generatedDbSource()));
  }
  finally { await client.end(); }
});
