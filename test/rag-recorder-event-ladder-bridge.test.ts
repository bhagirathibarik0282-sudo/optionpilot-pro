import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {parseRagEventRequest,buildRagPremiumSnapshot} from '../rag-event-evidence.js';
import type {H1ReplayHttpResult} from '../h1-replay-http.js';
import {projectRecordedRagLadder,mountRecorderEventContextLadderRoute} from '../rag-recorder-event-ladder-bridge.js';
import {renderEventContextLadder} from '../rag-event-context-ladder-view.js';
import {RECORDED_REPLAY_HTML,installRecordedReplay} from '../recorded-replay-view.js';
const when=(t:string,seconds=0)=>new Date(Date.parse('2026-10-19T'+t+':00+05:30')+seconds*1000).toISOString();
function snapshot(){
 const point=(t:string,offset:number,v:number)=>({
  timeIst:t,offset,bucketAt:when(t),receiptAt:when(t,25),pair:{
   pe:{price:v,oi:100000,quoteAt:when(t,21),receiptAt:when(t,25),snapshotId:'h1-abc'},
   ce:{price:220-v,oi:300000,quoteAt:when(t,20),receiptAt:when(t,25),snapshotId:'h1-abc'}},
  context:{spot:23120,fullPcr:1.2145,fullPcrSource:'Normalized full-chain source',pdh:23200,pdl:23000,pdc:23150,
   futures:23170,ceWall:23300,vix:15.2}
 });
 return {ok:true,mode:'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1',source:'EXISTING_POSTGRES_H1_REPLAY',
  safety:{readOnly:true},identity:{symbol:'NIFTY',date:'2026-10-19',expiry:'2026-10-19',strike:23150,side:'PE'},
  event:{timeIst:'09:36',availableAt:when('09:36',25)},
  provenance:{selectedEvidenceSha256:'a'.repeat(64)},
  beforeAndAt:[point('09:33',-3,100),point('09:36',0,107)],
  outcomes:[point('09:39',3,112)]
 };
}
test('recorded snapshot keeps spot/premium lanes separate, withholds normalized PCR and sector history',()=>{
 const projected=projectRecordedRagLadder(snapshot());
 assert.equal(projected.ok,true);if(!projected.ok)return;
 assert.equal(projected.lanes.find(x=>x.offsetMinutes===0)?.cells.some(x=>x.family==='PREMIUM'&&x.value===107),true);
 assert.equal(projected.lanes.find(x=>x.offsetMinutes===3)?.cells.some(x=>x.family==='PREMIUM'&&x.value===112),true);
 assert.equal(projected.lanes.find(x=>x.offsetMinutes===0)?.cells.some(x=>x.family==='PCR_OI'),false); // normalized source is insufficient
 assert.equal(projected.lanes.some(x=>x.cells.some(c=>c.family==='FUTURES'||c.family==='SECTOR'||c.family==='HEAVYWEIGHT')),false);
 assert.equal(projected.institutionalContext.length,0);
});
test('RAG data must include exact source, eventKnownAt and evidence fingerprint; no substitution',()=>{
 for(const edit of [
  (x:any)=>{x.event.availableAt=when('09:38');},
  (x:any)=>{x.mode='CANDIDATE';},
  (x:any)=>{x.provenance.selectedEvidenceSha256='missing';},
  (x:any)=>{x.identity.side='XX';},
  (x:any)=>{x.source='UNVERIFIED_WEB';}
 ]){
  const value=snapshot();edit(value);assert.equal(projectRecordedRagLadder(value).ok,false);
 }
});
test('read-only HTML route requires exact inputs and invokes the existing audited reader once',async()=>{
 const app=new Hono();let requests=0;
 mountRecorderEventContextLadderRoute(app,(async(q:any)=>{requests++;assert.equal(q.kind,'SNAPSHOT');assert.equal(q.includeOutcomes,true);return snapshot();}) as any);
 const invalid=await app.request('/rag-event-context-ladder/view?symbol=NIFTY');
 assert.equal(invalid.status,400);assert.equal(requests,0);
 const valid=await app.request('/rag-event-context-ladder/view?symbol=NIFTY&date=2026-10-19&expiry=2026-10-19&strike=23150&side=PE&time=09%3A36');
 assert.equal(valid.status,200);assert.equal(requests,1);
 const html=await valid.text();
 assert.match(html,/Recorder Event Context/);
 assert.match(html,/Saved evidence/);
 assert.match(html,/CE\/PE • exact contract/);
 assert.match(html,/Similar/i);
 assert.match(html,/No verified recorded observations/);
 assert.equal(valid.headers.get('cache-control'),'no-store');
});
test('recorder entry is a single explicit guarded user action with exact identity',()=>{
 assert.match(RECORDED_REPLAY_HTML,/id="rr-rag-ladder"/);
 assert.match(RECORDED_REPLAY_HTML,/id="rr-rag-side"/);
 const src=installRecordedReplay.toString();
 assert.match(src,/exactQuote/);
 assert.match(src,/regular3m/);
 assert.match(src,/window\.location\.assign/);
 assert.match(src,/rag-event-context-ladder\/view/);
 assert.match(src,/q\.minute_bucket/);
 assert.match(src,/cursor/);
 assert.match(src,/option_type/);
});

test('15:30 final recorder bucket remains available at actual 15:30:25 receipt',()=>{
 const raw=snapshot();
 const final={...raw.beforeAndAt[1],timeIst:'15:30',offset:0,
   bucketAt:when('15:30'),receiptAt:when('15:30',25),
   pair:{
    ce:{...raw.beforeAndAt[1].pair.ce,quoteAt:when('15:30',20),receiptAt:when('15:30',25)},
    pe:{...raw.beforeAndAt[1].pair.pe,quoteAt:when('15:30',21),receiptAt:when('15:30',25)}
   }};
 raw.event.timeIst='15:30';
 raw.event.availableAt=when('15:30',25);
 raw.beforeAndAt=[final];
 raw.outcomes=[];
 const result=projectRecordedRagLadder(raw);
 assert.equal(result.ok,true);
 if(result.ok)assert.equal(result.lanes.find(x=>x.offsetMinutes===0)?.cells.some(x=>x.family==='PREMIUM'),true);
});

test('even a well-formed RAG snapshot for a different selected contract fails closed',async()=>{
 const app=new Hono();
 mountRecorderEventContextLadderRoute(app,(async()=>{
   const data=snapshot();
   data.identity.symbol='SENSEX';
   return data;
 }) as any);
 const route='/rag-event-context-ladder/view?symbol=NIFTY&date=2026-10-19&expiry=2026-10-19&strike=23150&side=PE&time=09%3A36';
 const result=await app.request(route);
 assert.equal(result.status,422);
 const html=await result.text();
 assert.match(html,/REQUEST_RESPONSE_CONTRACT_IDENTITY_MISMATCH/);
 assert.ok(!html.includes('23120'));
});

test('an absent event-time exact premium must block the entire event page, even if spot exists',()=>{
 const raw=snapshot();
 raw.beforeAndAt=[raw.beforeAndAt[0]];
 const projected=projectRecordedRagLadder(raw);
 assert.equal(projected.ok,false);
 if(!projected.ok)assert.equal(projected.reason,'EVENT_PREMIUM_SOURCE_NOT_ADMITTED');
});

test('normalized PCR source alone never becomes canonical full-chain evidence',()=>{
 const normalized=snapshot();
 const nr=projectRecordedRagLadder(normalized);
 assert.equal(nr.ok,true);
 if(nr.ok)assert.equal(nr.lanes.every(x=>x.cells.every(c=>c.family!=='PCR_OI')),true);
 const canonical=snapshot();
 for(const p of [...canonical.beforeAndAt,...canonical.outcomes])
   p.context.fullPcrSource='Exact canonical full-chain source';
 const cr=projectRecordedRagLadder(canonical);
 assert.equal(cr.ok,true);
 if(cr.ok)assert.equal(cr.lanes.find(x=>x.offsetMinutes===0)?.cells.some(c=>c.family==='PCR_OI'),true);
});

test('one-click pinned recorder sample must not be labelled a detected event or cross-day similar-event retrieval',()=>{
 const verified=projectRecordedRagLadder(snapshot());
 assert.equal(verified.ok,true);
 const html=renderEventContextLadder(verified);
 assert.match(html,/Recorder → Selected snapshot evidence/);
 assert.match(html,/Selected snapshot/);
 assert.match(html,/NOT a detected PDH\/PDL, OI wall or PCR event/);
 assert.match(html,/Similar-event retrieval is NOT performed/);
 assert.doesNotMatch(html,/Event-wise RAG evidence/);
});

test('real H1 RAG builder output projects into Recorder ladder without mocking RAG response shape',()=>{
 const picked=parseRagEventRequest({symbol:'NIFTY',date:'2026-10-13',
   expiry:'2026-10-13',strike:'22300',side:'PE',time:'09:36',
   kind:'SNAPSHOT',lookback:'3',includeOutcomes:'true'});
 assert.equal(picked.ok,true);if(!picked.ok)return;
 const market:any[]=[],options:any[]=[];
 const date='2026-10-13';
 for(const [i,hm] of ['09:33','09:36','09:39'].entries()){
   const bucket=new Date(date+'T'+hm+':00+05:30').toISOString();
   const ms=Date.parse(bucket),receipt=new Date(ms+24000).toISOString();
   const snapshot_id=date+hm;
   market.push({symbol:'NIFTY',minute_bucket:bucket,backend_timestamp:receipt,
     truth_verdict:'TRUE',snapshot_id,spot_ltp:22484+i,calculation_version:'STORAGE_V3_PHASE1'});
   for(const side of ['CE','PE'])
     options.push({symbol:'NIFTY',minute_bucket:bucket,expiry:'2026-10-13',strike:22300,
       option_type:side,snapshot_id,truth_verdict:'TRUE',ltp:side==='PE'?100+i*7:120-i*3,
       oi:1000+i*100,quote_timestamp:receipt,day_high:150,day_low:90});
 }
 const current:H1ReplayHttpResult={ok:true,mode:'READ_ONLY_H1_3M_REPLAY',
   productionImpact:'NONE',request:{symbol:'NIFTY',tradeDate:date,fromTime:'09:15',toTime:'09:39',scope:'FULL'},
   market,options,chain:[]};
 const previous:H1ReplayHttpResult={ok:false,mode:'READ_ONLY_H1_3M_REPLAY',
   productionImpact:'NONE',request:{symbol:'NIFTY',tradeDate:'2026-10-12',
    fromTime:'09:15',toTime:'15:30',scope:'FULL'}};
 const upstream=buildRagPremiumSnapshot(picked.value,current,previous);
 assert.equal(upstream.ok,true);
 const projected=projectRecordedRagLadder(upstream);
 assert.equal(projected.ok,true);
 if(!projected.ok)return;
 const before=projected.lanes.find(l=>l.offsetMinutes===-3);
 const currentLane=projected.lanes.find(l=>l.offsetMinutes===0);
 const after=projected.lanes.find(l=>l.offsetMinutes===3);
 assert.equal(before?.cells.find(c=>c.family==='PREMIUM'&&c.metric==='LTP')?.value,100);
 assert.equal(currentLane?.cells.find(c=>c.family==='PREMIUM'&&c.metric==='LTP')?.value,107);
 assert.equal(after?.cells.find(c=>c.family==='PREMIUM'&&c.metric==='LTP')?.value,114);
 assert.equal(currentLane?.cells.find(c=>c.family==='PREMIUM'&&c.metric==='LTP')?.changePct,7);
 assert.equal(projected.institutionalContext.length,0);
 assert.equal(projected.lanes.every(l=>l.cells.every(c=>c.family!=='FUTURES'&&
   c.family!=='HEAVYWEIGHT'&&c.family!=='SECTOR'&&c.family!=='FII_DII')),true);
});
