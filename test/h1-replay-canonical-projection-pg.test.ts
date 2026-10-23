import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {canonicalPcrProjectionSql} from '../h1-replay-canonical-projection.js';
import {projectCanonicalPcrRows} from '../h1-replay-compact-v1.js';

test('PostgreSQL dashboard projection equals the existing JS projection, including malformed and duplicate evidence',{skip:!process.env.TEST_REPLAY_DATABASE_URL},async()=>{
 const client=new pg.Client({connectionString:process.env.TEST_REPLAY_DATABASE_URL});await client.connect();
 try{
  const leg={strike:23000,optionType:'CE',expiryDate:'2026-10-27',lastPrice:100,quoteTimestamp:'2026-10-23T04:30:00Z',pdc:99,oi:200,unneeded:'x'.repeat(10000)};
  const expiry={expiry:'Current Expiry',expiryDate:'2026-10-27',ceStrikes:[leg,leg,null,[],5,'x',{}, {strike:null,pdc:null}],peStrikes:[]};
  const valid={symbol:'NIFTY',gapScore:{fullChainPcr:1.2,unneeded:99},expiries:[expiry,expiry,null,[],{},7,'x'],unneeded:'y'.repeat(10000)};
  const cases:any[]=[undefined,null,[],false,5,'x',{},valid,{symbol:null,gapScore:null,expiries:null},{gapScore:{fullChainPcr:null},expiries:[]},{gapScore:[],expiries:{}},{gapScore:'x',expiries:[{ceStrikes:null,peStrikes:'x'}]}];
  for(const market of cases){
   const payload=market===undefined?{}:{market};const expected=JSON.parse(JSON.stringify(projectCanonicalPcrRows([{market}])))[0].market??null;
   const res=await client.query('SELECT '+canonicalPcrProjectionSql()+' AS market FROM (SELECT $1::jsonb AS payload) AS source',[JSON.stringify(payload)]);
   assert.deepEqual(res.rows[0].market,expected,JSON.stringify(market));
   const materialized=await client.query('WITH replay_archive AS MATERIALIZED (SELECT ($1::jsonb)->\'market\' AS raw_market) SELECT '+canonicalPcrProjectionSql('raw_market')+' AS market FROM replay_archive',[JSON.stringify(payload)]);assert.deepEqual(materialized.rows[0].market,expected);
  }
  // Deterministic variations cover absent vs null fields, false/zero and ordering.
  for(let i=0;i<40;i++){const market:any={symbol:i%2?'NIFTY':null,expiries:[{expiry:'Current Expiry',ceStrikes:[{...leg,lastPrice:i%3?i:null},...(i%2?[leg]:[])],peStrikes:[]}],gapScore:i%4?{fullChainPcr:i/10}:null};if(i%5===0)delete market.expiries[0].ceStrikes[0].pdc;
   const expected=JSON.parse(JSON.stringify(projectCanonicalPcrRows([{market}])))[0].market;const res=await client.query('SELECT '+canonicalPcrProjectionSql()+' AS market FROM (SELECT $1::jsonb AS payload) AS source',[JSON.stringify({market})]);assert.deepEqual(res.rows[0].market,expected);
  }
 }finally{await client.end();}
});
