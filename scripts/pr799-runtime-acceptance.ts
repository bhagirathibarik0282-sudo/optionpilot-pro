import assert from 'node:assert/strict';
import pg from 'pg';
import {Hono} from 'hono';
import {runH1ReplayPairRead} from '../h1-replay-http.js';
import {readRagEventEvidence} from '../rag-event-evidence.js';
import {mountRecorderEventContextLadderRoute,projectRecordedRagLadder} from '../rag-recorder-event-ladder-bridge.js';

// Manual, fixed-scope, one-shot acceptance. Never run the application startup,
// expose an HTTP listener, print archive rows/credentials, or schedule a retry.
const url=process.env.DATABASE_URL?.trim();
const enabled=process.env.PR799_RUNTIME_ACCEPTANCE==='NIFTY_OCT19_1045_READ_ONLY';
if(!enabled||!url){
 console.error(JSON.stringify({ok:false,reason:!enabled?'MANUAL_ACCEPTANCE_NOT_ENABLED':'DATABASE_URL_NOT_CONFIGURED'}));
 process.exitCode=2;
}else{
 let pool:pg.Pool|undefined,failed=false,result:unknown;
 const deadline=setTimeout(()=>{
   console.error(JSON.stringify({ok:false,reason:'ACCEPTANCE_PROCESS_DEADLINE'}));
   process.exit(1);
 },120000);
 try{
   pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:5000,
     query_timeout:50000,application_name:'pr799-readonly-runtime-acceptance',
     options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000'});
   pool.on('error',()=>{failed=true;});
   const sourceScanCounts={markers:0,canonical:0};
   const read=async<T extends Record<string,unknown>>(sql:string,params:unknown[]):Promise<T[]>=>{
     if(sql.includes("kind = 'H1_TRUTH_MARKER'"))sourceScanCounts.markers++;
     if(sql.includes("kind = 'H1_CANONICAL_MARKET_ARCHIVE'"))sourceScanCounts.canonical++;
     const client=await pool!.connect();
     let begun=false,broken=false;
     try{
       await client.query('BEGIN READ ONLY');begun=true;
       const setting=await client.query('SHOW transaction_read_only');
       assert.equal(setting.rows[0]?.transaction_read_only,'on');
       return (await client.query(sql,params)).rows as T[];
     }finally{
       try{if(begun)await client.query('ROLLBACK');}catch{broken=true;failed=true;}
       client.release(broken);
     }
   };
   const reads:unknown[]=[];let evidence:any,sourceStartedAt=0,sourceEndedAt=0,evidenceEndedAt=0;
   const app=new Hono();
   mountRecorderEventContextLadderRoute(app,async request=>{
     evidence=await readRagEventEvidence(request,undefined,async requests=>{
       sourceStartedAt=performance.now();
       const pair=await runH1ReplayPairRead(requests,read);
       sourceEndedAt=performance.now();
       pair.forEach((replay,i)=>reads.push({request:requests[i],ok:replay.ok,reason:replay.reason??null,counts:replay.counts,
         queryTimingsMs:replay.queryTimingsMs}));
       return pair;
     });
     evidenceEndedAt=performance.now();
     return evidence;
   });
   const start=performance.now();
   const response=await app.request('/rag-event-context-ladder/view?symbol=NIFTY&date=2026-10-19&expiry=2026-10-19&strike=23150&side=PE&time=10%3A45');
   const html=await response.text();
   const elapsedMs=Math.round((performance.now()-start)*10)/10;
   assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(evidence.ok,true);assert.equal(evidence.identity.symbol,'NIFTY');
   assert.equal(evidence.identity.date,'2026-10-19');assert.equal(evidence.identity.expiry,'2026-10-19');
   assert.equal(evidence.identity.strike,23150);assert.equal(evidence.identity.side,'PE');
   assert.equal(evidence.event.timeIst,'10:45');assert.equal(evidence.event.after,137.1);
   assert.equal(evidence.safety.writesPerformed,false);
   assert.equal(evidence.provenance.selectedEvidenceSha256,'118a0e2d0c07691435358d41088f4658b8deeeb1f4acf81f539d59eb41b3fc82');
   assert.equal(sourceScanCounts.markers,1);assert.equal(sourceScanCounts.canonical,1);
   const projected=projectRecordedRagLadder(evidence);assert.equal(projected.ok,true);
   if(!projected.ok)throw new Error('projection blocked');
   const premium=(offset:number)=>projected.lanes.find(l=>l.offsetMinutes===offset)?.cells
     .find(c=>c.family==='PREMIUM'&&c.metric==='LTP')?.value;
   assert.equal(premium(-3),153.85);assert.equal(premium(0),137.1);assert.equal(premium(3),142.9);
   assert.match(html,/137\.1/);
   result={ok:true,mode:'ONE_SHOT_REAL_DB_RAG_HANDLER_ACCEPTANCE',httpStatus:response.status,
     elapsedMs,scope:'DEPLOYED_PROCESS_IN_PROCESS_HTTP_HANDLER_WITH_REAL_DB_EXCLUDES_PUBLIC_EDGE_AND_BROWSER',
     identity:evidence.identity,event:evidence.event,selectedEvidenceSha256:evidence.provenance.selectedEvidenceSha256,
     premiums:{before3m:premium(-3),event:premium(0),after3m:premium(3)},reads,sourceScanCounts,
     stageTimingsMs:{sources:Math.round((sourceEndedAt-sourceStartedAt)*10)/10,
       evidenceBuild:Math.round((evidenceEndedAt-sourceEndedAt)*10)/10,
       renderAndResponse:Math.round((performance.now()-evidenceEndedAt)*10)/10},
     safety:{transactionReadOnlyVerified:true,writesPerformed:false,publicListener:false,brokerRequests:false},
     limits:{processMs:120000,statementMs:45000,lockMs:1000,poolMax:5},
     limitations:['One sample; no universal latency claim.','Shared archive timings overlap and must not be added.','Diagnostic pool uses explicit read-only transactions and deadlines.',
       'Public HTTP edge, Recorder browser click-through and mobile visual acceptance remain unverified.',
       'Recorded canonical PCR does not prove complete fresh full-chain inventory.']};
 }catch{
   failed=true;
 }finally{
   try{await pool?.end();}catch{failed=true;}
   clearTimeout(deadline);
 }
 if(failed||!result){console.error(JSON.stringify({ok:false,reason:'READ_ONLY_RUNTIME_ACCEPTANCE_FAILED'}));process.exitCode=1;}
 else console.log(JSON.stringify(result));
}
