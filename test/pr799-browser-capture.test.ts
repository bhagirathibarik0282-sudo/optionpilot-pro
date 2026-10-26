import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {buildPr799BrowserCapture,PR799_CAPTURE_EVIDENCE_SHA} from '../pr799-browser-capture.js';

// Guard-test fixture using the already documented prices. Not an actual DB capture.
function fixture(){
 const times=['10:42','10:45','10:48'],prices=[153.85,137.1,142.9];
 const iso=(t:string)=>new Date('2026-10-19T'+t+':00+05:30').toISOString();
 const points=times.map((timeIst,i)=>({offset:(i-1)*3,timeIst,bucketAt:iso(timeIst),receiptAt:iso(timeIst),
   context:{unrelatedSecret:'MUST_NOT_BE_EXPORTED'},
   pair:{pe:{price:prices[i],oi:null,quoteAt:iso(timeIst),receiptAt:iso(timeIst),snapshotId:'guard-fixture-'+i,
     unrelatedSecret:'MUST_NOT_BE_EXPORTED'}}}));
 const evidence={ok:true,status:'PARTIAL',mode:'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1',source:'EXISTING_POSTGRES_H1_REPLAY',
   safety:{readOnly:true,writesPerformed:false},
   identity:{symbol:'NIFTY',date:'2026-10-19',expiry:'2026-10-19',strike:23150,side:'PE'},
   event:{timeIst:'10:45',availableAt:iso('10:45'),before:153.85,after:137.1},
   provenance:{selectedEvidenceSha256:PR799_CAPTURE_EVIDENCE_SHA,unrelatedSecret:'MUST_NOT_BE_EXPORTED'},
   beforeAndAt:points.slice(0,2),outcomes:points.slice(2),unrelatedSecret:'MUST_NOT_BE_EXPORTED'};
 const market=times.map(t=>({symbol:'NIFTY',minute_bucket:iso(t),truth_verdict:'TRUE',raw:{unrelatedSecret:'MUST_NOT_BE_EXPORTED'}}));
 const options=times.map((t,i)=>({symbol:'NIFTY',minute_bucket:iso(t),truth_verdict:'TRUE',expiry:'2026-10-19',strike:23150,
   option_type:'PE',ltp:prices[i],raw:{unrelatedSecret:'MUST_NOT_BE_EXPORTED'}}));
 return {pair:[{ok:true,market,options,chain:[]},{ok:true}],evidence};
}
test('transport retains admitted evidence but strips arbitrary raw and nested fields',()=>{
 const {pair,evidence}=fixture();
 const capture=buildPr799BrowserCapture(pair,evidence,'2026-10-25T00:00:00Z');
 assert.equal(capture.state.current.NIFTY.market.length,3);
 assert.deepEqual(capture.state.current.NIFTY.options.map(q=>q.ltp),[153.85,137.1,142.9]);
 assert(!JSON.stringify(capture).includes('MUST_NOT_BE_EXPORTED'));
 assert.equal(capture.writesPerformed,false);
});
test('missing/duplicate exact endpoint, non-TRUE data and wrong premium fail closed',()=>{
 for(const mutate of [
   (x:any)=>x.pair[0].options.pop(),
   (x:any)=>x.pair[0].market.push(x.pair[0].market[0]),
   (x:any)=>{x.pair[0].options[1].truth_verdict='FALSE';},
   (x:any)=>{x.pair[0].options[1].ltp=0;},
   (x:any)=>{x.evidence.identity.side='CE';},
   (x:any)=>{x.evidence.provenance.selectedEvidenceSha256='0'.repeat(64);},
   (x:any)=>{x.pair[1].ok=false;}
 ]){const x=fixture();mutate(x);assert.throws(()=>buildPr799BrowserCapture(x.pair,x.evidence,'2026-10-25T00:00:00Z'));}
});
test('manual entry point without configuration exits without payload or listener',()=>{
 const env={...process.env};delete env.DATABASE_URL;delete env.PR799_BROWSER_CAPTURE;
 const run=spawnSync(process.execPath,['--import','tsx','scripts/pr799-browser-capture.ts'],{env,encoding:'utf8',timeout:10000});
 assert.equal(run.status,1);assert.equal(run.stdout,'');
 assert.match(run.stderr,/PR799_CAPTURE_FAILED_NO_PAYLOAD/);
 assert.match(run.stderr,/"stage":"CONFIGURATION"/);
});
test('missing checkpoint nulls are preserved instead of crashing after a successful archive read',()=>{
 const {pair,evidence}=fixture();
 evidence.beforeAndAt.unshift(null as any);evidence.outcomes.push(null as any);
 const capture=buildPr799BrowserCapture(pair,evidence,'2026-10-26T00:00:00Z');
 assert.equal(capture.evidence.beforeAndAt[0],null);assert.equal(capture.evidence.outcomes.at(-1),null);
});
test('Recorder transport retains the normalized previous-session reference field names',()=>{
 const {pair,evidence}=fixture();
 Object.assign(pair[0].market[0],{pdh:23200,pdl:22900,spot_prev_close:23100});
 const capture=buildPr799BrowserCapture(pair,evidence,'2026-10-26T00:00:00Z');
 assert.equal(capture.state.current.NIFTY.market[0].pdh,23200);
 assert.equal(capture.state.current.NIFTY.market[0].pdl,22900);
 assert.equal(capture.state.current.NIFTY.market[0].spot_prev_close,23100);
});
