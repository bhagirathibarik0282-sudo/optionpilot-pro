import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { dbSaveCasMemoryOnce } from '../db.js';
import { CAS_MEMORY_KIND } from '../cas-closing-memory.js';
const url = process.env.CAS_MEMORY_TEST_DATABASE_URL;

test('existing log persists one immutable memory under concurrent writers and rolls back failed writes', { skip: !url }, async () => {
  const parsed = new URL(url!);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'This test only runs against an isolated local/CI database');
  process.env.DATABASE_URL = url;
  const client = new pg.Client({ connectionString: url }); await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS app_state_log (id BIGSERIAL PRIMARY KEY,kind TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const key = CAS_MEMORY_KIND + '/test-concurrent';
    await client.query("DELETE FROM app_state_log WHERE kind=$1 AND payload->>'memoryKey'=$2", [CAS_MEMORY_KIND, key]);
    const results = await Promise.all(Array.from({ length: 10 }, (_, writer) => dbSaveCasMemoryOnce({ version: CAS_MEMORY_KIND, memoryKey: key, writer } as any)));
    assert.equal(results.filter(Boolean).length, 1);
    const saved = await client.query("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'memoryKey'=$2", [CAS_MEMORY_KIND, key]);
    assert.equal(saved.rows.length, 1);
    const winner = saved.rows[0].payload.writer;
    assert.equal(await dbSaveCasMemoryOnce({ version: CAS_MEMORY_KIND, memoryKey: key, writer: 999 } as any), false);
    const readback = await client.query("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'memoryKey'=$2", [CAS_MEMORY_KIND, key]);
    assert.equal(readback.rows[0].payload.writer, winner);
    await assert.rejects(dbSaveCasMemoryOnce({ version: 'WRONG', memoryKey: key }), /VERSION_INVALID/);
    await assert.rejects(dbSaveCasMemoryOnce({ version: CAS_MEMORY_KIND, memoryKey: key + '-bad', nonJson: 1n } as any));
    assert.equal(await dbSaveCasMemoryOnce({ version: CAS_MEMORY_KIND, memoryKey: key + '-bad' }), true);
  } finally { await client.end(); }
});
