// Optional SQL engine smoke test. Install @electric-sql/pglite in a disposable checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

(process.env.BNF_SHADOW_SQL_TEST === 'true' ? test : test.skip)('PostgreSQL schema, version CAS and append-only event rollback', async()=>{
  const { PGlite } = await import('@electric-sql/pglite');
  const db=new PGlite();
  try {
    await db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    await db.query('INSERT INTO bnf_shadow_scope_v1(scope,version,payload) VALUES ($1,0,$2) ON CONFLICT(scope) DO NOTHING',['test','{}']);
    await db.exec('BEGIN');
    let r=await db.query('UPDATE bnf_shadow_scope_v1 SET version=version+1,payload=$1 WHERE scope=$2 AND version=$3',['{"active":null}','test',0]);
    assert.equal(r.affectedRows,1);
    await db.query('INSERT INTO bnf_shadow_event_v1(scope,event_id,intent_id,occurred_at,kind,payload) VALUES ($1,$2,$3,$4,$5,$6)',['test','event1','intent1','2026-11-18T10:00:00+05:30','ENTRY_FILL','{}']);
    await db.exec('COMMIT');
    r=await db.query('UPDATE bnf_shadow_scope_v1 SET version=version+1,payload=$1 WHERE scope=$2 AND version=$3',['{}','test',0]);
    assert.equal(r.affectedRows,0);
    await db.exec('BEGIN');
    await db.query('UPDATE bnf_shadow_scope_v1 SET version=version+1,payload=$1 WHERE scope=$2 AND version=$3',['{}','test',1]);
    await assert.rejects(db.query('INSERT INTO bnf_shadow_event_v1(scope,event_id,intent_id,occurred_at,kind,payload) VALUES ($1,$2,$3,$4,$5,$6)',['test','event1','intent1','2026-11-18','DUPLICATE','{}']));
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT version FROM bnf_shadow_scope_v1 WHERE scope=$1',['test'])).rows[0].version,1);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM bnf_shadow_event_v1')).rows[0].n,1);
  } finally { await db.close(); }
});
