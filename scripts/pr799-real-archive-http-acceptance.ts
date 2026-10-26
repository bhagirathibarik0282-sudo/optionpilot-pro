/** Bounded PR799 HTTP acceptance on the actual archived NIFTY event. No listener or source export. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import vm from 'node:vm';
import pg from 'pg';
import {runH1ReplayPairRead} from '../h1-replay-http.js';
import {parseRagEventRequest,readRagEventEvidence} from '../rag-event-evidence.js';
import {projectRecordedRagLadder} from '../rag-recorder-event-ladder-bridge.js';
import {createPr799RecorderPreview,PR799_PREVIEW_SELECTION} from '../pr799-recorder-preview.js';
import {recorderCaptureExpiryDate} from '../pr799-browser-capture.js';

const FIXED_SHA='118a0e2d0c07691435358d41088f4658b8deeeb1f4acf81f539d59eb41b3fc82';
let deadline:NodeJS.Timeout|null=null;
async function main(){
 assert.equal(process.env.PR799_EXACT_HTTP_SMOKE,'NIFTY_OCT19_1045_READ_ONLY','Explicit one-shot flag required');
 assert(process.env.DATABASE_URL,'Private Recorder connection required');
 deadline=setTimeout(()=>{console.error('PR799_ACTUAL_HTTP_TIMEOUT_NO_RELEASE');process.exit(1);},120000);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,
   query_timeout:50000,application_name:'pr799-exact-archive-http-smoke',
   options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000'});
 let poolFailed=false;pool.on('error',()=>{poolFailed=true;});
 let pair:any[]=[];let raw:any;
 try{
  const parsed=parseRagEventRequest({...PR799_PREVIEW_SELECTION,kind:'SNAPSHOT',includeOutcomes:'true',lookback:'3'});
  assert.equal(parsed.ok,true);
  if(!parsed.ok)throw Error('SAMPLE_QUERY_REJECTED');
  const read=async<T extends Record<string,unknown>>(sql:string,params:unknown[]):Promise<T[]>=>{
   const client=await pool.connect();let begun=false,broken=false;
   try{
    await client.query('BEGIN READ ONLY');begun=true;
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only,'on');
    return (await client.query(sql,params)).rows as T[];
   }finally{
    try{if(begun)await client.query('ROLLBACK');}catch{broken=true;poolFailed=true;}
    client.release(broken);
   }
  };
  raw=await readRagEventEvidence(parsed.value,undefined,async requests=>{
   pair=await runH1ReplayPairRead(requests,read);return pair;
  });
 }finally{await pool.end();}
 assert.equal(poolFailed,false,'Pool failed');
 assert.equal(pair.length,2);
 assert(pair.every(x=>x.ok),'Fixed current and prior Recorder windows required');
 assert.equal(raw?.provenance?.selectedEvidenceSha256,FIXED_SHA,'Archive sample fingerprint mismatch');
 assert.equal(projectRecordedRagLadder(raw).ok,true,'RAG event must admit the real archive');
 const rows=(replay:any)=>({market:replay.market,
  options:replay.options.filter((r:any)=>recorderCaptureExpiryDate(r.expiry)==='2026-10-19'&&Number(r.strike)===23150),
  chain:replay.chain.filter((r:any)=>recorderCaptureExpiryDate(r.expiry)==='2026-10-19')});
 const state={date:'2026-10-19',recordedDates:['2026-10-16','2026-10-19'],
  current:{NIFTY:rows(pair[0])},baseline:{NIFTY:rows(pair[1])},history:{}};
 const point=state.current.NIFTY.options.filter((r:any)=>r.option_type==='PE'&&
  new Date(r.minute_bucket).toISOString()==='2026-10-19T05:15:00.000Z'&&r.truth_verdict==='TRUE');
 assert.equal(point.length,1,'Exactly one confirmed PE at event bucket');
 assert.equal(Number(point[0].ltp),137.1,'No fabricated event premium');
 // DB is closed before any in-process HTTP handling.
 const password=randomBytes(32).toString('hex');
 const app=createPr799RecorderPreview({password,state,evidence:raw});
 const auth='Basic '+Buffer.from('preview:'+password).toString('base64');
 const unauth=await app.request('/');
 assert.equal(unauth.status,401,'Archived sample must not be public');
 assert.equal((await app.request('/',{method:'POST',headers:{authorization:auth}})).status,405,'GET only');
 const page=await app.request('/',{headers:{authorization:auth}});
 assert.equal(page.status,200,'Authenticated Recorder must render');
 const html=await page.text();
 assert(html.includes('id="rr-rag-ladder"')&&html.includes('2026-10-19'));
 assert(!html.includes(password),'Password must not leak to the page');
 const embedded=html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/);
 assert(embedded,'Recorder browser boot must exist');
 new vm.Script(embedded[1]);
 const query=new URLSearchParams(PR799_PREVIEW_SELECTION);
 assert.equal((await app.request('/api/research/rag-event-context-ladder/view?'+query.toString(),{headers:{authorization:auth}})).status,200,'Fixed exact Recorder RAG link must open');
 const bad=new URLSearchParams(query);bad.set('side','CE');
 assert.equal((await app.request('/api/research/rag-event-context-ladder/view?'+bad.toString(),{headers:{authorization:auth}})).status,422,'Wrong side must fail closed');
 assert.equal((await app.request('/api/research/rag-event-context-ladder/view?'+query+'&side=PE',{headers:{authorization:auth}})).status,422,'Duplicate selection must fail closed');
 assert.equal((await app.request('/api/research/background-quotes',{headers:{authorization:auth}})).status,404,'No live endpoints');
 console.log('PR799_REAL_ARCHIVE_HTTP_ACCEPTED '+JSON.stringify({sample:'NIFTY_2026-10-19_23150_PE_10:45',fingerprintVerified:true,currentAndPriorWindows:true,actualEventLtpVerified:true,authenticatedHtml:true,exactRagView:true,wrongContractRejected:true,duplicateRejected:true,readOnly:true,noListener:true,noMarketDataExport:true,poolClosed:true,writesPerformed:false,probabilityActivated:false}));
}
main().catch(e=>{console.error('PR799_REAL_ARCHIVE_HTTP_HOLD '+String(e?.message??e).replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[DATABASE_URL_REDACTED]'));process.exitCode=1;})
 .finally(()=>{if(deadline)clearTimeout(deadline);});
