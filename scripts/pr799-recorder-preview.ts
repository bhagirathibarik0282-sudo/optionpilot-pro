import assert from 'node:assert/strict';
import pg from 'pg';
import {serve} from '@hono/node-server';
import {runH1ReplayPairRead} from '../h1-replay-http.js';
import {parseRagEventRequest,readRagEventEvidence} from '../rag-event-evidence.js';
import {projectRecordedRagLadder} from '../rag-recorder-event-ladder-bridge.js';
import {createPr799RecorderPreview,PR799_PREVIEW_SELECTION} from '../pr799-recorder-preview.js';

// Manual entry point only. Never use npm start or import the full server.
async function main(){
 const password=process.env.PR799_PREVIEW_PASSWORD??'';
 if(process.env.PR799_PREVIEW!=='NIFTY_OCT19_1045_READ_ONLY'||password.length<32||!process.env.DATABASE_URL)
   throw new Error('PREVIEW_NOT_CONFIGURED');
 const parsed=parseRagEventRequest({...PR799_PREVIEW_SELECTION,kind:'SNAPSHOT',includeOutcomes:'true',lookback:'3'});
 assert.equal(parsed.ok,true);if(!parsed.ok)return;
 const deadline=setTimeout(()=>{console.error('PR799_PREVIEW_PREPARE_TIMEOUT');process.exit(1);},120000);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,
   query_timeout:50000,application_name:'pr799-fixed-recorder-preview',
   options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000'});
 let poolFailed=false;pool.on('error',()=>{poolFailed=true;});
 let pair:any[]=[];let evidence:any;
 try{
   const read=async<T extends Record<string,unknown>>(sql:string,params:unknown[]):Promise<T[]>=>{
     const client=await pool.connect();let begun=false,broken=false;
     try{
       await client.query('BEGIN READ ONLY');begun=true;
       const setting=await client.query('SHOW transaction_read_only');assert.equal(setting.rows[0]?.transaction_read_only,'on');
       return (await client.query(sql,params)).rows as T[];
     }finally{
       try{if(begun)await client.query('ROLLBACK');}catch{broken=true;poolFailed=true;}
       client.release(broken);
     }
   };
   evidence=await readRagEventEvidence(parsed.value,undefined,async requests=>{
     const result=await runH1ReplayPairRead(requests,read);pair=result;return result;
   });
   assert.equal(poolFailed,false);assert.equal(pair.length,2);assert(pair.every(r=>r.ok));
   assert.equal(projectRecordedRagLadder(evidence).ok,true);
   assert.equal(evidence.provenance.selectedEvidenceSha256,'118a0e2d0c07691435358d41088f4658b8deeeb1f4acf81f539d59eb41b3fc82');
 }finally{
   // No request handler has a database connection. Failure to close prevents serving.
   try{await pool.end();}finally{clearTimeout(deadline);}
 }
 assert.equal(poolFailed,false);
 const rows=(replay:any)=>({market:replay.market,
   options:replay.options.filter((r:any)=>String(r.expiry).slice(0,10)==='2026-10-19'&&Number(r.strike)===23150),
   chain:replay.chain.filter((r:any)=>String(r.expiry).slice(0,10)==='2026-10-19')});
 const state={date:'2026-10-19',recordedDates:['2026-10-16','2026-10-19'],
   current:{NIFTY:rows(pair[0])},baseline:{NIFTY:rows(pair[1])},history:{}};
 assert(state.current.NIFTY.options.some((r:any)=>r.option_type==='PE'&&
   new Date(r.minute_bucket).toISOString()==='2026-10-19T05:15:00.000Z'&&r.truth_verdict==='TRUE'));
 const app=createPr799RecorderPreview({password,state,evidence});
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:8789},()=>{
   console.log('PR799_FIXED_ARCHIVE_PREVIEW_READY_LOOPBACK_ONLY_DB_CLOSED_TTL_10M');
 });
 const expiry=setTimeout(()=>server.close(),600000);
 server.on('close',()=>clearTimeout(expiry));
 const close=()=>server.close();process.once('SIGTERM',close);process.once('SIGINT',close);
}
main().catch(()=>{console.error('PR799_PREVIEW_PREPARATION_FAILED_NO_SERVER_STARTED');process.exitCode=1;});
