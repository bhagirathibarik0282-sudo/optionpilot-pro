import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import pg from 'pg';
import {runH1ReplayPairRead} from '../h1-replay-http.js';
import {parseRagEventRequest,readRagEventEvidence} from '../rag-event-evidence.js';
import {projectRecordedRagLadder} from '../rag-recorder-event-ladder-bridge.js';
import {PR799_PREVIEW_SELECTION} from '../pr799-recorder-preview.js';

// Manual archive capture only. No server, application startup, broker, writes or retry.
async function main(){
 assert.equal(process.env.PR799_BROWSER_CAPTURE,'NIFTY_OCT19_1045_READ_ONLY');
 assert(process.env.DATABASE_URL);
 const deadline=setTimeout(()=>{console.error('PR799_CAPTURE_TIMEOUT');process.exit(1);},120000);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,
   query_timeout:50000,application_name:'pr799-bounded-browser-capture',
   options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000'});
 let failed=false;pool.on('error',()=>{failed=true;});
 let pair:any[]=[];let raw:any;
 try{
   const parsed=parseRagEventRequest({...PR799_PREVIEW_SELECTION,kind:'SNAPSHOT',includeOutcomes:'true',lookback:'3'});
   assert(parsed.ok);if(!parsed.ok)return;
   const read=async<T extends Record<string,unknown>>(sql:string,params:unknown[]):Promise<T[]>=>{
     const client=await pool.connect();let begun=false,broken=false;
     try{
       await client.query('BEGIN READ ONLY');begun=true;
       assert.equal((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only,'on');
       return (await client.query(sql,params)).rows as T[];
     }finally{
       try{if(begun)await client.query('ROLLBACK');}catch{broken=true;failed=true;}
       client.release(broken);
     }
   };
   raw=await readRagEventEvidence(parsed.value,undefined,async requests=>{
     pair=await runH1ReplayPairRead(requests,read);return pair;
   });
   assert.equal(pair.length,2);assert(pair.every(r=>r.ok));
   assert.equal(raw.provenance.selectedEvidenceSha256,'118a0e2d0c07691435358d41088f4658b8deeeb1f4acf81f539d59eb41b3fc82');
   assert.equal(projectRecordedRagLadder(raw).ok,true);
 }finally{
   try{await pool.end();}catch{failed=true;}finally{clearTimeout(deadline);}
 }
 assert.equal(failed,false);
 // Only three actual current-session markers and the selected exact PE are
 // transported. Do not serialize raw canonical payloads, credentials or other contracts.
 const buckets=new Set(['10:42','10:45','10:48'].map(t=>new Date('2026-10-19T'+t+':00+05:30').toISOString()));
 const pick=(r:any,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]));
 const mk=['symbol','minute_bucket','truth_verdict','snapshot_id','backend_timestamp','spot_ltp','india_vix','spot_pdh','spot_pdl','spot_pdc','calculation_version'];
 const ok=['symbol','minute_bucket','truth_verdict','snapshot_id','expiry','strike','option_type','ltp','oi','quote_timestamp','day_high','day_low'];
 const inWindow=(r:any)=>r.symbol==='NIFTY'&&buckets.has(new Date(r.minute_bucket).toISOString());
 const market=pair[0].market.filter(inWindow).map((r:any)=>pick(r,mk));
 const options=pair[0].options.filter((r:any)=>inWindow(r)&&String(r.expiry).slice(0,10)==='2026-10-19'&&Number(r.strike)===23150&&r.option_type==='PE').map((r:any)=>pick(r,ok));
 assert.equal(market.length,3);assert.equal(options.length,3);
 const evidence=pick(raw,['ok','status','mode','source','safety','identity','event','provenance','beforeAndAt','outcomes']);
 const capture={mode:'PR799_ACTUAL_ARCHIVE_BROWSER_CAPTURE_V1',capturedAt:new Date().toISOString(),
   scope:'Three actual Recorder markers and exact PE; full admitted RAG lanes; no baseline or full session',
   readOnly:true,writesPerformed:false,selectedEvidenceSha256:raw.provenance.selectedEvidenceSha256,
   state:{date:'2026-10-19',recordedDates:['2026-10-19'],current:{NIFTY:{market,options,chain:[]}},baseline:{},history:{}},evidence};
 const json=JSON.stringify(capture);assert(Buffer.byteLength(json)<250000);
 const encoded=gzipSync(json).toString('base64');assert(encoded.length<100000);
 const chunks=encoded.match(/.{1,3000}/g)!;
 console.log('PR799_CAPTURE_BEGIN '+JSON.stringify({chunks:chunks.length,sha256:createHash('sha256').update(json).digest('hex')}));
 chunks.forEach((chunk,i)=>console.log('PR799_CAPTURE_CHUNK '+i+' '+chunk));
 console.log('PR799_CAPTURE_COMPLETE_DB_CLOSED_NO_LISTENER');
}
main().catch(()=>{console.error('PR799_CAPTURE_FAILED_NO_PAYLOAD');process.exitCode=1;});
