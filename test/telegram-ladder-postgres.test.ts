import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createPostgresLadderOutbox} from '../telegram-ladder-postgres-outbox.js';
import {deliverLadderJob} from '../telegram-ladder-outbox.js';
import {LADDER_PREFIX} from '../telegram-ladder-v4.js';
import {framesFromH1} from '../telegram-ladder-recorder-adapter.js';
const database=process.env.LADDER_TEST_DATABASE_URL;
test('ladder outbox on native PostgreSQL connections',{skip:!database},async t=>{
  const url=new URL(database!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/optionpilot_test');
  const schema='ladder_test_'+randomUUID().replaceAll('-','');
  const admin=new pg.Client({connectionString:url.href});await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options',`-c search_path=${schema}`);
  const pool=new pg.Pool({connectionString:url.href,max:20});
  try {
    await pool.query('CREATE TABLE app_state_log(id bigserial PRIMARY KEY,kind text NOT NULL,payload jsonb NOT NULL)');
    await t.test('native date and timestamp rows retain exact premiums in UTC and IST',async()=>{
      const oldZone=process.env.TZ;
      try {for(const zone of ['UTC','Asia/Kolkata']) {
        process.env.TZ=zone;
        const {rows:[row]}=await pool.query(`SELECT 'NIFTY'::text AS symbol,
          '2026-10-30 04:15:00+00'::timestamptz AS minute_bucket,
          '2026-10-30 04:15:03+00'::timestamptz AS backend_timestamp,
          '2026-10-30 04:15:02+00'::timestamptz AS exchange_timestamp,
          '2026-10-30 04:15:02+00'::timestamptz AS quote_timestamp,
          '2026-11-03'::date AS expiry,23000::numeric AS strike,'CE'::text AS option_type,
          100::numeric AS ltp,23050::numeric AS spot_ltp,'exact'::text AS snapshot_id,
          'TRUE'::text AS truth_verdict,'TRUE'::text AS freshness_status,
          'RESEARCH_ELIGIBLE'::text AS validation_status`);
        assert.ok(row.minute_bucket instanceof Date);assert.ok(row.expiry instanceof Date);
        const frames=framesFromH1([{market:[row],options:[row],chain:[]}]);
        assert.equal(frames[0].minute,'2026-10-30T04:15:00.000Z');
        const index=frames[0].indices[0],expiry=index.expiries[0];
        assert.equal(index.spot.quality,'VERIFIED');assert.equal(expiry.expiry,'2026-11-03');
        assert.equal(expiry.contracts[0].ltp.value,100);assert.equal(expiry.contracts[0].ltp.quality,'VERIFIED');
        assert.throws(()=>framesFromH1([{market:[{...row,minute_bucket:new Date(NaN)}]}]),/INVALID_MINUTE/);
      }}finally{if(oldZone===undefined)delete process.env.TZ;else process.env.TZ=oldZone;}
    });
    let now=1000;const store=createPostgresLadderOutbox(pool,()=>now);
    const job={id:'LADDER_V4|native',parts:[LADDER_PREFIX+'one',LADDER_PREFIX+'two']};
    await t.test('twenty concurrent workers create exactly one immutable job',async()=>{
      const results=await Promise.all(Array.from({length:20},()=>store.putIfAbsent(job)));
      assert.equal(results.filter(Boolean).length,1);
      await store.putIfAbsent({...job,parts:[LADDER_PREFIX+'replacement']});
      const q=await pool.query('SELECT payload FROM app_state_log');assert.equal(q.rows.length,1);assert.deepEqual(q.rows[0].payload.parts,job.parts);
    });
    await t.test('part order and exclusive claim hold across separate connections',async()=>{
      assert.equal(await store.claim(job.id,1),false);
      const results=await Promise.all(Array.from({length:20},()=>store.claim(job.id,0)));
      assert.equal(results.filter(Boolean).length,1);await store.settle(job.id,0,'ACKED','123');
    });
    await t.test('new instance resumes at next part and explicit failure retries the same part',async()=>{
      const restarted=createPostgresLadderOutbox(pool,()=>now);
      assert.equal((await restarted.pending())[0].nextPart,1);
      assert.equal(await deliverLadderJob(restarted,job,async()=>({status:'RETRYABLE'}),1),'RETRYABLE');
      assert.equal((await restarted.pending())[0].nextPart,1);
      assert.equal(await deliverLadderJob(restarted,job,async()=>({status:'ACKED',receipt:'124'}),1),'ACKED');
      assert.equal((await restarted.pending()).length,0);
    });
    await t.test('ambiguous and abandoned sends never become eligible for automatic resend',async()=>{
      for(const id of ['unknown','abandoned']) {
        const j={id:'LADDER_V4|'+id,parts:[LADDER_PREFIX+id]};await store.putIfAbsent(j);
        assert.equal(await store.claim(j.id,0),true);
        if(id==='unknown')await store.settle(j.id,0,'UNKNOWN');
        now+=120001;
        const restarted=createPostgresLadderOutbox(pool,()=>now);
        assert.equal((await restarted.pending()).some(p=>p.job.id===j.id),false);
        assert.equal(await restarted.claim(j.id,0),false);
      }
    });
    await t.test('actual constraint failure rolls back and the same job can retry',async()=>{
      await pool.query("ALTER TABLE app_state_log ADD CONSTRAINT reject_test CHECK (payload->>'id' <> 'LADDER_V4|rollback')");
      const j={id:'LADDER_V4|rollback',parts:[LADDER_PREFIX+'rollback']};
      await assert.rejects(store.putIfAbsent(j));
      await pool.query('ALTER TABLE app_state_log DROP CONSTRAINT reject_test');
      assert.equal(await store.putIfAbsent(j),true);
      assert.equal(await store.putIfAbsent(j),false);
    });
  }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
