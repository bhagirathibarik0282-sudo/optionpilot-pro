import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRecorderMatchedHistory as load} from '../recorder-matched-history.js';
import {buildH1ReplayContinuity,type H1ReplayRequest} from '../h1-replay-http.js';
import type {RecorderMatchRule} from '../recorder-matched-outcome.js';

// Normalized synthetic Recorder rows exercise the REAL snapshot builder.
// No fixture is an actual historical result or an actual DB query.
const dates=['2026-10-19','2026-10-20','2026-10-21'];
const rule:RecorderMatchRule={version:'LOADER_FIXTURE_V1',declaredAt:'2026-10-01T00:00:00Z',
 features:['PREMIUM_3M_DIRECTION','SPOT_VS_PDC'],horizonMinutes:3,movement:'INCREASE',minimumMovePct:10,minIndependentSessions:2};
const input=()=>({target:{symbol:'NIFTY',date:'2026-10-26',expiry:'2026-10-26',strike:'23150',side:'PE',time:'10:45'},
 historyFrom:dates[0],historyTo:dates[2],rule});
function replay(q:H1ReplayRequest){
 const start=Date.parse(q.tradeDate+'T'+q.fromTime+':00+05:30'),end=Date.parse(q.tradeDate+'T'+q.toTime+':00+05:30');
 const market:any[]=[],options:any[]=[];
 const step=q.tradeDate>='2026-10-19'?60000:180000;
 for(let ms=start;ms<=end;ms+=step){
  const minute_bucket=new Date(ms).toISOString(),receipt=new Date(ms+25000).toISOString(),snapshot_id=q.tradeDate+'-'+ms;
  market.push({symbol:q.symbol,minute_bucket,backend_timestamp:receipt,snapshot_id,truth_verdict:'TRUE',spot_ltp:23000,
   spot_prev_close:23100,calculation_version:'STORAGE_V3_PHASE1'});
  options.push({symbol:q.symbol,minute_bucket,snapshot_id,truth_verdict:'TRUE',expiry:q.tradeDate,strike:23150,option_type:'PE',
   ltp:ms<Date.parse(q.tradeDate+'T10:45:00+05:30')?100:ms===Date.parse(q.tradeDate+'T10:45:00+05:30')?110:q.tradeDate===dates[2]?99:132,
   oi:1000,quote_timestamp:new Date(ms+21000).toISOString(),day_high:150,day_low:80});
 }
 return {ok:true,mode:'READ_ONLY_H1_3M_REPLAY' as const,productionImpact:'NONE' as const,request:q,
  market,options,chain:[],canonical:[],continuity:buildH1ReplayContinuity(q,market,[])};
}
function harness(){
 const reads:H1ReplayRequest[]=[];let lists=0;
 const index:any={ok:true,mode:'READ_ONLY_H1_RECORDED_DATE_INDEX_V1',productionImpact:'NONE',
  dates:dates.map(tradeDate=>({symbol:'NIFTY',tradeDate,markerCount:100,firstMinute:null,lastMinute:null}))};
 const deps:any={listDates:async()=>{lists++;return index;},read:async(q:H1ReplayRequest)=>{reads.push(q);return replay(q);}};
 return {deps,index,reads,lists:()=>lists};
}
test('existing date inventory and replay rows feed real snapshot admission and the deterministic calculator',async()=>{
 const h=harness(),r=await load(input(),h.deps);
 assert.equal(r.status,'AVAILABLE');assert.equal(r.ratePct,2/3*100);
 assert.equal(h.lists(),1);assert.equal(h.reads.length,4);
 assert.deepEqual(h.reads.map(q=>q.tradeDate),['2026-10-26',...dates]);
 assert(h.reads.every(q=>q.scope==='FULL'&&q.fromTime==='10:42'));
 assert.deepEqual(h.reads.map(q=>q.toTime),['10:45','10:48','10:48','10:48']);
 assert.equal(r.audit.recordedContracts,3);assert.deepEqual(r.audit.loadedSessionDates,dates);
 assert(r.result?.episodes.every(x=>x.evidenceSha256.length===64&&x.contract.side==='PE'));
 assert.equal(r.safety.writesPerformed,false);
});
test('rule/range validation happens before inventory or DB reads and oversized scopes are not truncated',async()=>{
 for(const change of [
  (x:any)=>{x.rule={...rule,features:['PCR_CROSS']};},
  (x:any)=>{x.historyTo='2026-10-26';},
  (x:any)=>{x.historyFrom='2026-02-30';},
  (x:any)=>{x.target.time='09:15';},
  (x:any)=>{x.target.time='15:30';}
 ]){const h=harness(),x=input();change(x);assert.equal((await load(x,h.deps)).status,'UNAVAILABLE');assert.equal(h.lists(),0);assert.equal(h.reads.length,0);}
 const h=harness(),x=input();x.historyFrom='2026-10-01';
 h.index.dates=Array.from({length:21},(_,i)=>({symbol:'NIFTY',tradeDate:'2026-10-'+String(i+1).padStart(2,'0')}));
 const r=await load(x,h.deps);assert.equal(r.reason,'HISTORY_RANGE_EXCEEDS_BOUNDED_SESSION_LIMIT');assert.equal(h.reads.length,0);
});
test('inventory failure or duplicate date entries block before replay reads',async()=>{
 for(const mutate of [(h:any)=>{h.index.ok=false;},(h:any)=>{h.index.dates.push(h.index.dates[0]);},
  (h:any)=>{h.index.dates[0].tradeDate='not-a-date';}]){
  const h=harness();mutate(h);assert.equal((await load(input(),h.deps)).ratePct,null);assert.equal(h.reads.length,0);
 }
});
test('a failed historical session stops once without retries, replacement or a partial successful rate',async()=>{
 const h=harness(),read=h.deps.read;
 h.deps.read=async(q:H1ReplayRequest)=>{if(q.tradeDate===dates[1]){h.reads.push(q);throw new Error('unavailable');}return read(q);};
 const r=await load(input(),h.deps);assert.equal(r.reason,'HISTORICAL_RECORDER_SESSION_READ_INCOMPLETE');
 assert.equal(r.ratePct,null);assert.equal(h.reads.length,3);assert.deepEqual(r.audit.loadedSessionDates,[dates[0]]);
 assert.deepEqual(r.audit.failedSessionDates,[dates[1]]);
});
test('wrong replay identity, missing/false markers or unavailable exact target cannot be certified',async()=>{
 for(const edit of [
  (r:any)=>{r.request={...r.request,symbol:'SENSEX'};},
  (r:any)=>{r.continuity.complete=false;},
  (r:any)=>{r.continuity.truthCounts.TRUE=0;},
  (r:any)=>{r.options=[];},
  (r:any)=>{r.options.at(-1).quote_timestamp='2026-10-26T05:14:00Z';}
 ]){const h=harness();h.deps.read=async(q:H1ReplayRequest)=>{h.reads.push(q);const r=replay(q);edit(r);return r;};
  const r=await load(input(),h.deps);assert.equal(r.ratePct,null);assert.equal(h.reads.length,1);}
});
test('all recorded contracts are enumerated before matching; conflicting or missing outcomes are never filtered out',async()=>{
 const h=harness();h.deps.read=async(q:H1ReplayRequest)=>{
  h.reads.push(q);const r=replay(q);
  if(q.tradeDate===dates[0]){
   const extra=r.options.map(row=>({...row,strike:23200}));
   r.options.push(...extra);
   r.options=r.options.filter(row=>row.strike!==23150||row.minute_bucket!=='2026-10-19T05:18:00.000Z');
  }
  return r;
 };
 const r=await load(input(),h.deps);assert.equal(r.audit.recordedContracts,4);
 assert.equal(r.result?.counts.selectedSessions,3);assert.equal(r.result?.counts.missingOutcomes,1);assert.equal(r.ratePct,null);
});
test('a recorded session without a same-DTE exact contract stays visible in the audit, never as a zero outcome',async()=>{
 const h=harness();h.deps.read=async(q:H1ReplayRequest)=>{
  h.reads.push(q);const r=replay(q);if(q.tradeDate===dates[2])for(const row of r.options)row.expiry='2026-10-22';return r;
 };
 const r=await load(input(),h.deps);assert.deepEqual(r.audit.emptyContractSessions,[dates[2]]);
 assert.equal(r.result?.counts.resolved,2);assert.equal(r.ratePct,100);
});
test('a large contract inventory fails closed instead of selecting a profitable subset',async()=>{
 const h=harness();h.deps.read=async(q:H1ReplayRequest)=>{
  h.reads.push(q);const r=replay(q);
  if(q.tradeDate===dates[0])r.options=Array.from({length:65},(_,i)=>r.options.map(row=>({...row,strike:23150+i*50}))).flat();return r;
 };
 const r=await load(input(),h.deps);assert.equal(r.ratePct,null);assert.deepEqual(r.audit.failedSessionDates,[dates[0]]);assert.equal(h.reads.length,2);
});

test('a missing event-time option row cannot silently remove a prior session from the rate',async()=>{
 const h=harness();h.deps.read=async(q:H1ReplayRequest)=>{
  h.reads.push(q);const r=replay(q);
  if(q.tradeDate===dates[2])r.options=r.options.filter(row=>row.minute_bucket!=='2026-10-21T05:15:00.000Z');
  return r;
 };
 const r=await load(input(),h.deps);
 assert.equal(r.ratePct,null);assert.equal(r.result?.counts.rejected,1);
 assert.equal(r.audit.emptyContractSessions.length,0);
 assert.deepEqual(r.audit.rejectedContracts,[{date:dates[2],expiry:dates[2],strike:23150,side:'PE',reason:'EXACT_SNAPSHOT_UNAVAILABLE_AT_CUTOFF'}]);
});
test('noncanonical range and inventory dates are rejected rather than widening the history scope',async()=>{
 for(const field of ['historyFrom','historyTo'] as const){
  const h=harness(),x=input();x[field]=' '+x[field]+' ';
  const r=await load(x,h.deps);assert.equal(r.reason,'INVALID_PRIOR_HISTORY_RANGE');assert.equal(h.lists(),0);
 }
 const h=harness();h.index.dates[0].tradeDate=' '+dates[0]+' ';
 assert.equal((await load(input(),h.deps)).reason,'AMBIGUOUS_DATE_INVENTORY');assert.equal(h.reads.length,0);
});
test('malformed expiry or off-window option rows cannot certify complete source inventory',async()=>{
 for(const mutate of [
  (r:any)=>{r.options[0].expiry='invalid';},
  (r:any)=>{r.options[0].minute_bucket='2026-10-19T05:19:00.000Z';}
 ]){
  const h=harness();h.deps.read=async(q:H1ReplayRequest)=>{
   h.reads.push(q);const r=replay(q);if(q.tradeDate===dates[0])mutate(r);return r;
  };
  const r=await load(input(),h.deps);assert.equal(r.ratePct,null);assert.equal(h.reads.length,2);
  assert.deepEqual(r.audit.failedSessionDates,[dates[0]]);
 }
});
