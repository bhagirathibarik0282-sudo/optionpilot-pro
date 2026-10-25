import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {canonicalReplayReadSql,runH1ReplayPairRead,runH1ReplayRead} from '../h1-replay-http.js';
import {canonicalPcrProjectionSql} from '../h1-replay-canonical-projection.js';

// Frozen pre-optimization SQL is the real captured builder query, not a second
// implementation of the candidate. These fixtures never write archive tables.
export const legacyCanonicalSql=readFileSync(new URL('./fixtures/h1-canonical-legacy-query.sql',import.meta.url),'utf8');
export function canonicalQueryFixtures(){
  const base={symbol:'NIFTY',minuteBucket:'2026-10-19T05:15:00.000Z',snapshotId:'fixture-A',
    truthVerdict:'TRUE',sourceTimestamp:'2026-10-19T05:15:00.667Z',calculationVersion:'H1_RUNTIME_BRIDGE_V1',
    market:{symbol:'NIFTY',gapScore:{fullChainPcr:0},expiries:[{expiry:'Current Expiry',expiryDate:'2026-10-19',ceStrikes:[],peStrikes:[]}]}};
  const row=(payload:unknown,kind='H1_CANONICAL_MARKET_ARCHIVE')=>({kind,payload,created_at:'2026-10-25T00:00:00Z'});
  return [row(base),row(base),row({...base,snapshotId:'conflict'}),
    row({...base,minuteBucket:'2026-10-19T10:45:00+05:30'}),
    row({...base,market:null}),row({...base,market:[]}),row({...base,market:false}),
    row({...base,market:{...base.market,unused:'z'.repeat(20000)}}),
    row({...base,snapshotId:null,sourceTimestamp:null,truthVerdict:'STALE'}),
    row({...base,market:undefined}),row({...base,symbol:'SENSEX'}),
    row({...base,minuteBucket:'2026-10-19T05:16:00Z'}),
    row({...base,minuteBucket:'2026-10-16T05:15:00Z'}),
    row({...base,minuteBucket:null}),row({...base,symbol:null}),
    row({...base,symbol:{other:'NIFTY'}}),row(base,'OTHER_KIND'),
    ...[null,false,4,[],{},'NIFTY'].map(x=>row(x))];
}
export function withCanonicalFixture(sql:string){
  const query=sql.replace('FROM app_state_log','FROM fixture_source');
  return `WITH fixture_source AS (
    SELECT r.kind,r.payload FROM jsonb_to_recordset($5::jsonb) AS r(kind text,payload jsonb)
  ) SELECT * FROM (${query}) AS result`;
}
const normalize=(rows:any[])=>rows.map(r=>JSON.stringify(r)).sort();
test('candidate has one metadata decoder and preserves raw market, filters and all rows',()=>{
  const sql=canonicalReplayReadSql();
  assert.equal((sql.match(/jsonb_to_record\(/g)||[]).length,1);
  assert.match(sql,/payload->'market' AS market/);
  assert.match(sql,/p\."minuteBucket"::timestamptz/);
  assert.doesNotMatch(sql,/created_at|DISTINCT|LIMIT/i);
});
test('PostgreSQL paired archive scans equal independent sessions, including latest markers and duplicate offsets',
 {skip:!process.env.TEST_REPLAY_DATABASE_URL},async()=>{
 const client=new pg.Client({connectionString:process.env.TEST_REPLAY_DATABASE_URL});await client.connect();
 try{
   const fixtures=canonicalQueryFixtures();
   const base=fixtures[0].payload as any;
   const marker=(minuteBucket:string,truthVerdict:string,created_at:string)=>({kind:'H1_TRUTH_MARKER',
     payload:{symbol:'NIFTY',minuteBucket,truthVerdict},created_at});
   fixtures.push(
     {kind:'H1_CANONICAL_MARKET_ARCHIVE',payload:{...base,minuteBucket:'2026-10-16T10:00:00Z'},created_at:'2026-10-25T00:00:00Z'},
     {kind:'H1_CANONICAL_MARKET_ARCHIVE',payload:{...base,minuteBucket:'2026-10-16T15:30:00+05:30'},created_at:'2026-10-25T00:00:00Z'},
     marker('2026-10-19T05:15:00Z','TRUE','2026-10-24T00:00:00Z'),
     marker('2026-10-19T10:45:00+05:30','STALE','2026-10-25T00:00:00Z'),
     marker('2026-10-16T10:00:00Z','TRUE','2026-10-25T00:00:00Z'),
     marker('2026-10-16T10:00:01Z','STALE','2026-10-25T01:00:00Z'));
   const input=JSON.stringify(fixtures);
   const requests=[{symbol:'NIFTY',tradeDate:'2026-10-19',fromTime:'10:45',toTime:'10:45',scope:'FULL'},
     {symbol:'NIFTY',tradeDate:'2026-10-16',fromTime:'09:15',toTime:'15:30',scope:'FULL'}] as const;
   let scans=0;
   const read=async(sql:string,params:unknown[])=>{
     if(!sql.includes('FROM app_state_log'))return [] as any;
     scans++;const fixtureParam=params.length+1;
     const query=`WITH fixture_source AS (SELECT r.kind,r.payload,r.created_at
       FROM jsonb_to_recordset($${fixtureParam}::jsonb) AS r(kind text,payload jsonb,created_at timestamptz))
       SELECT * FROM (${sql.replace('FROM app_state_log','FROM fixture_source')}) AS archive_result`;
     return (await client.query(query,[...params,input])).rows as any;
   };
   const independent=await Promise.all(requests.map(q=>runH1ReplayRead(q,read)));
   assert(independent.every(r=>r.ok));assert.equal(scans,4);scans=0;
   const paired=await runH1ReplayPairRead(requests,read);
   assert.equal(scans,2);assert(paired.every(r=>r.ok));
   // SQL orders by bucket only: equal-time peers have no promised tie order.
   // Compare complete canonical multisets, retaining every duplicate and value.
   const stable=({queryTimingsMs,canonical,...value}:any)=>({...value,canonical:normalize(canonical)});
   assert.deepEqual(paired.map(stable),independent.map(stable));
   for(const replay of paired)assert(replay.canonical!.every((row,i,all)=>i===0||
     Date.parse(String(all[i-1].minute_bucket))<=Date.parse(String(row.minute_bucket))));
   assert.equal(paired[0].continuity?.truthCounts.STALE,1);
   assert.equal(paired[1].continuity?.truthCounts.TRUE,1,'15:30:01 source must stay outside 15:30 upper bound');
   assert.equal(paired[1].canonical?.length,3,'original earlier fixture row and both closing aliases remain');
   assert.equal(paired[1].canonical?.filter(row=>Date.parse(String(row.minute_bucket))===
     Date.parse('2026-10-16T10:00:00Z')).length,2,'offset aliases remain duplicate canonical rows');
 }finally{await client.end();}
});
test('PostgreSQL candidate equals frozen legacy SQL across duplicates, offsets, late imports and nulls',
  {skip:!process.env.TEST_REPLAY_DATABASE_URL},async()=>{
  const client=new pg.Client({connectionString:process.env.TEST_REPLAY_DATABASE_URL});
  await client.connect();
  try{
    const params=['NIFTY','2026-10-19','10:45','10:45',JSON.stringify(canonicalQueryFixtures())];
    const old=await client.query(withCanonicalFixture(legacyCanonicalSql),params);
    const candidate=await client.query(withCanonicalFixture(canonicalReplayReadSql()),params);
    assert.ok(old.rows.length>=10);assert.deepEqual(normalize(candidate.rows),normalize(old.rows));
    const priorProjected=`WITH replay_archive AS MATERIALIZED (${legacyCanonicalSql})
      SELECT minute_bucket,symbol,snapshot_id,truth_verdict,source_timestamp,calculation_version,
      ${canonicalPcrProjectionSql('raw_market')} AS market FROM replay_archive ORDER BY minute_bucket`;
    const legacyProjection=priorProjected.replace("payload->'market' AS market","payload->'market' AS raw_market");
    const a=await client.query(withCanonicalFixture(legacyProjection),params);
    const b=await client.query(withCanonicalFixture(canonicalReplayReadSql(true)),params);
    assert.deepEqual(normalize(b.rows),normalize(a.rows));
    // Malformed source timestamps remain errors, never fabricated empty rows.
    const malformed=JSON.stringify([{kind:'H1_CANONICAL_MARKET_ARCHIVE',
      payload:{symbol:'NIFTY',minuteBucket:'not-a-timestamp',market:{}}}]);
    for(const sql of [legacyCanonicalSql,canonicalReplayReadSql()])
      await assert.rejects(()=>client.query(withCanonicalFixture(sql),[...params.slice(0,4),malformed]));
  }finally{await client.end();}
});
