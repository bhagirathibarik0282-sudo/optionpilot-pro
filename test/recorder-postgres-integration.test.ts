import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const testUrl = process.env.RECORDER_TEST_DATABASE_URL;
test('recorder and EOD SQL against an isolated PostgreSQL schema', {skip:!testUrl}, async t=>{
  const url=new URL(testUrl!);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'test database must be loopback');
  assert.equal(url.pathname,'/optionpilot_test','use a dedicated test database');
  const schema='recorder_test_'+randomUUID().replaceAll('-','');
  const admin=new pg.Client({connectionString:url.href});await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options',`-c search_path=${schema}`);
  process.env.DATABASE_URL=url.href;
  const client=new pg.Client({connectionString:url.href});await client.connect();
  try{
    const db=await import('../db.ts');
    await db.dbInit();
    assert.equal((await client.query("SELECT to_regclass('app_state_log') AS name")).rows[0].name,'app_state_log');
    const {participationMinute}=await import('../participation-minute-recorder.ts');
    const frame=JSON.parse(readFileSync(new URL('./fixtures/live-capture.json',import.meta.url),'utf8'));
    const payload=participationMinute(frame,Date.parse(frame.serverTime))!;
    assert.ok(payload);
    await t.test('actual SQL stores all participation rows and rejects a duplicate',async()=>{
      assert.equal(await db.dbSaveParticipationMinuteOnce(payload),true);
      assert.equal(await db.dbSaveParticipationMinuteOnce(payload),false);
      const r=await client.query('SELECT payload FROM app_state_log WHERE kind=$1',[payload.version]);
      assert.equal(r.rows.length,1);assert.equal(r.rows[0].payload.rows.length,16);
      assert.equal(r.rows[0].payload.rows.filter((r:any)=>r.role==='STOCK').length,8);
    });
    await t.test('an actual SQL write failure rolls back and can be retried',async()=>{
      const key='2026-10-29T04:23:00.000Z',next={...payload,memoryKey:key,minuteBucket:key};
      await client.query(`ALTER TABLE app_state_log ADD CONSTRAINT recorder_test_reject CHECK (payload->>'memoryKey' <> '${key}')`);
      await assert.rejects(db.dbSaveParticipationMinuteOnce(next));
      await client.query('ALTER TABLE app_state_log DROP CONSTRAINT recorder_test_reject');
      assert.equal(await db.dbSaveParticipationMinuteOnce(next),true);
      assert.equal(await db.dbSaveParticipationMinuteOnce(next),false);
    });
    await t.test('native PostgreSQL serializes concurrent transactions for the same minute',{
      skip:process.env.RECORDER_TEST_ENGINE==='pglite'?'PGlite multiplexing cannot prove native PostgreSQL concurrency':false,
    },async()=>{
      const key='2026-10-29T04:24:00.000Z',next={...payload,memoryKey:key,minuteBucket:key};
      const results=await Promise.all(Array.from({length:20},()=>db.dbSaveParticipationMinuteOnce(next)));
      assert.equal(results.filter(Boolean).length,1);
      const q=await client.query("SELECT count(*)::int AS n FROM app_state_log WHERE kind=$1 AND payload->>'memoryKey'=$2",[payload.version,key]);
      assert.equal(q.rows[0].n,1);
    });
    await t.test('actual H1 upsert preserves old source value with a diagnostic status',async()=>{
      const {recordH1Snapshot}=await import('../h1-recorder-adapter.ts');
      const market=JSON.parse(readFileSync(new URL('./fixtures/replay-NIFTY.json',import.meta.url),'utf8')).canonical[0].market;
      market.expiries=market.expiries.map((e:any)=>({...e,expiryDate:new Date(e.expiryDate)}));
      const leg=market.expiries[0].ceStrikes[0];leg.quoteTimestamp='1970-01-01T00:00:00Z';
      await recordH1Snapshot({market,truthVerdict:'TRUE',calculationVersion:'TEST_ONLY',now:new Date(market.timestamp)});
      const q=await client.query("SELECT ltp,validation_status FROM option_snapshot_1m WHERE symbol='NIFTY' AND expiry=$1::date AND strike=$2 AND option_type='CE'",[leg.expiryDate,leg.strike]);
      assert.equal(Number(q.rows[0].ltp),leg.lastPrice);assert.equal(q.rows[0].validation_status,'DIAGNOSTIC_OTHER_SESSION');
    });
    await t.test('actual EOD JSON contains participation and counts observed tradeDate',async()=>{
      const {buildPayload,sourceCounts}=await import('../eod-archive-job.ts');
      const p=await buildPayload(client,'2026-10-29');
      assert.ok(p.participationMinutes.length>=2);assert.equal(p.participationMinutes[0].rows.length,16);
      assert.equal(p.optionSnapshots.some((r:any)=>r.validation_status==='DIAGNOSTIC_OTHER_SESSION'),true);
      const count=await sourceCounts(client,'2026-10-29');assert.equal(count.counts.participation_minute_count,p.participationMinutes.length);
      const other=await buildPayload(client,'2026-10-28');assert.equal(other.participationMinutes.length,0);
    });
  }finally{
    await client.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
