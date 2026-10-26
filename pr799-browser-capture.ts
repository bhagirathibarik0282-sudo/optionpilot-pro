import assert from 'node:assert/strict';
import {projectRecordedRagLadder} from './rag-recorder-event-ladder-bridge.js';

export const PR799_CAPTURE_EVIDENCE_SHA='118a0e2d0c07691435358d41088f4658b8deeeb1f4acf81f539d59eb41b3fc82';
const pick=(r:any,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]));
/** Transport only renderer inputs; never raw market JSON or arbitrary provenance. */
export function buildPr799BrowserCapture(pair:any[],raw:any,capturedAt:string){
 assert.equal(pair.length,2);assert(pair.every(r=>r.ok));
 assert(Number.isFinite(Date.parse(capturedAt)));
 assert.equal(raw.provenance?.selectedEvidenceSha256,PR799_CAPTURE_EVIDENCE_SHA);
 assert.deepEqual(pick(raw.identity,['symbol','date','expiry','strike','side']),
   {symbol:'NIFTY',date:'2026-10-19',expiry:'2026-10-19',strike:23150,side:'PE'});
 assert.equal(raw.event.timeIst,'10:45');
 const original=projectRecordedRagLadder(raw);assert(original.ok);
 const buckets=['10:42','10:45','10:48'].map(t=>new Date('2026-10-19T'+t+':00+05:30').toISOString());
 const inWindow=(r:any)=>r.symbol==='NIFTY'&&buckets.includes(new Date(r.minute_bucket).toISOString());
 const mk=['symbol','minute_bucket','truth_verdict','snapshot_id','backend_timestamp','spot_ltp','india_vix','pdh','pdl','spot_prev_close','calculation_version'];
 const ok=['symbol','minute_bucket','truth_verdict','snapshot_id','expiry','strike','option_type','ltp','oi','quote_timestamp','day_high','day_low'];
 const market=pair[0].market.filter(inWindow).map((r:any)=>pick(r,mk));
 const options=pair[0].options.filter((r:any)=>inWindow(r)&&String(r.expiry).slice(0,10)==='2026-10-19'&&Number(r.strike)===23150&&r.option_type==='PE').map((r:any)=>pick(r,ok));
 assert.equal(market.length,3);assert.equal(options.length,3);
 for(const [i,bucket] of buckets.entries()){
   const m=market.filter((r:any)=>new Date(r.minute_bucket).toISOString()===bucket);
   const q=options.filter((r:any)=>new Date(r.minute_bucket).toISOString()===bucket);
   assert.equal(m.length,1);assert.equal(q.length,1);
   assert.equal(m[0].truth_verdict,'TRUE');assert.equal(q[0].truth_verdict,'TRUE');
   assert.equal(q[0].ltp,[153.85,137.1,142.9][i]);
 }
 const point=(p:any)=>p===null?null:({...pick(p,['offset','timeIst','bucketAt','receiptAt']),
   pair:{pe:p.pair?.pe?pick(p.pair.pe,['price','oi','quoteAt','receiptAt','snapshotId']):null},
   context:pick(p.context??{},['spot','pdh','pdc','pdl','vix','fullPcr','fullPcrSource','fullPcrCanonicalSourceAt'])});
 const evidence={...pick(raw,['ok','status','mode','source']),safety:{readOnly:true,writesPerformed:false},
   identity:pick(raw.identity,['symbol','date','expiry','strike','side','dte']),
   event:pick(raw.event,['timeIst','availableAt','before','after']),
   provenance:{selectedEvidenceSha256:PR799_CAPTURE_EVIDENCE_SHA},
   beforeAndAt:raw.beforeAndAt.map(point),outcomes:raw.outcomes.map(point)};
 // Sanitizing transport must preserve every displayed admitted value and guard.
 assert.deepEqual(projectRecordedRagLadder(evidence),original);
 const capture={mode:'PR799_ACTUAL_ARCHIVE_BROWSER_CAPTURE_V1',capturedAt,
   scope:'Three actual Recorder markers and exact PE; full admitted RAG lanes; no baseline or full session',
   readOnly:true,writesPerformed:false,selectedEvidenceSha256:PR799_CAPTURE_EVIDENCE_SHA,
   state:{date:'2026-10-19',recordedDates:['2026-10-19'],current:{NIFTY:{market,options,chain:[]}},baseline:{},history:{}},evidence};
 assert(Buffer.byteLength(JSON.stringify(capture))<250000);
 return capture;
}
