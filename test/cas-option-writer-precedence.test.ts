import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { casOptionWriterPrecedenceSql } from './cas-option-writer-precedence-fixture.mjs';

test('CAS writer fixture exercises production SQL and both whole-row write orders', () => {
  const sql = casOptionWriterPrecedenceSql();
  assert.match(sql, /H1 then Storage split market and option snapshot identity/);
  assert.match(sql, /Storage then H1 lost whole H1 option row/);
  assert.match(sql, /derived_oi_change_gap_seconds = 60/);
  assert.match(sql, /CREATE TEMP TABLE cas_option_writer_test/);
  assert.match(sql, /ROLLBACK/);
});

test('PostgreSQL preserves coherent market/option IDs, invalidation and contract grain', {
  skip: !process.env.CAS_MEMORY_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.CAS_MEMORY_TEST_DATABASE_URL });
  await client.connect();
  try { await client.query(casOptionWriterPrecedenceSql()); }
  finally { await client.end(); }
});
