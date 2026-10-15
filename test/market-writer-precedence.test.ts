import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { marketWriterPrecedenceSql } from './market-writer-precedence-fixture.mjs';

test('production market SQL fixture includes both orders and invalidation', () => {
  const sql = marketWriterPrecedenceSql();
  assert.match(sql, /H1 then Storage/);
  assert.match(sql, /Storage then H1/);
  assert.match(sql, /WHERE market_writer_test.calculation_version IS DISTINCT FROM 'H1_RUNTIME_BRIDGE_V1'/);
});

test('actual PostgreSQL market UPSERT preserves whole H1 rows in both writer orders', {
  skip: !process.env.MARKET_WRITER_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.MARKET_WRITER_TEST_DATABASE_URL });
  await client.connect();
  try { await client.query(marketWriterPrecedenceSql()); }
  finally { await client.end(); }
});
