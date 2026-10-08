import test from 'node:test';
import pg from 'pg';
import { chainWriterPrecedenceSql } from './chain-writer-precedence-fixture.mjs';

test('actual chain UPSERT preserves normalized rows in both writer orders and allows invalidation', {
  skip: !process.env.CHAIN_WRITER_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.CHAIN_WRITER_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(chainWriterPrecedenceSql());
  } finally {
    await client.end();
  }
});
