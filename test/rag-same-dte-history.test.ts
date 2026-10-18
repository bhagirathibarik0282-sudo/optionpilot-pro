import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { compareSameDteHistory } from '../rag-same-dte-history.js';
import { readSameDteHistory, mountSameDteHistoryRoute } from '../rag-same-dte-history-http.js';
const s={symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:22500,side:'CE' as const,timeIst:'09:36',asOf:Date.parse('2026-10-13T10:00:00+05:30')};
function replay(day='2026-10-13',expiry=day,strikes=[22500],spot=22500):any{
 const times=['09:33','09:36'].map(t=>Date.parse(day+'T'+t+':00+05:30'));
 return {ok:true,mode:'READ_ONLY_H1_3M_REPLAY',productionImpact:'NONE',request:{symbol:'NIFTY',tradeDate:day},
  market:times.map((t,i)=>({symbol:'NIFTY',minute_bucket:new Date(t).toISOString(),backend_timestamp:new Date(t+24000).toISOString(),spot_ltp:spot+i*5,snapshot_id:day+i,truth_verdict:'TRUE'})),
  options:strikes.flatMap(strike=>times.map((t,i)=>({symbol:'NIFTY',expiry,strike,option_type:'CE',minute_bucket:new Date(t).toISOString(),quote_timestamp:new Date(t+20000).toISOString(),ltp:100+i*2,snapshot_id:day+i,truth_verdict:'TRUE'})))};
}
test('same DTE compares different expiries and selects one closest-moneyness contract per day',()=>{
 const r:any=compareSameDteHistory(s,replay(),[replay('2026-10-06','2026-10-06',[22400,22500])]);
 assert.equal(r.matches.length,1);assert.equal(r.matches[0].expiry,'2026-10-06');assert.equal(r.matches[0].strike,22500);
 assert.equal(r.matches[0].premiumChange,2);assert.equal(r.safety.affectsSelector,false);
});
test('DTE mismatch and closing-clock mismatch produce no match',()=>{
 const r:any=compareSameDteHistory(s,replay(),[replay('2026-10-06','2026-10-13'),replay('2026-07-28')]);
 assert.equal(r.matches.length,0);assert.equal(r.blocked.length,2);
});
test('same-day and future history never enter comparison',()=>{
 const r:any=compareSameDteHistory(s,replay(),[replay(),replay('2026-10-14')]);assert.equal(r.coverage.suppliedPriorDays,0);
});
test('missing, stale, wrong-snapshot, invalid-price and conflicting duplicate quote fail closed',()=>{
 for(const mutate of [
  (x:any)=>x.options.pop(),(x:any)=>x.options[1].quote_timestamp='2026-10-06T09:34:00+05:30',
  (x:any)=>x.options[1].snapshot_id='wrong',(x:any)=>x.options[1].ltp=0,
  (x:any)=>x.options.push({...x.options[1],ltp:999}),
  (x:any)=>x.market[1].backend_timestamp='2026-10-06T09:36:31+05:30',
  (x:any)=>x.options[1].quote_timestamp='2026-10-05T09:36:20+05:30',
  (x:any)=>x.options.forEach((q:any)=>q.expiry='2026-10-06garbage')]){
  const h=replay('2026-10-06');mutate(h);const r:any=compareSameDteHistory(s,replay(),[h]);assert.equal(r.matches.length,0);
 }
});
test('exact aliases deduplicate but repeated day sources are blocked',()=>{
 const h=replay('2026-10-06');h.options.push({...h.options[1]});
 assert.equal((compareSameDteHistory(s,replay(),[h]) as any).matches.length,1);
 assert.equal((compareSameDteHistory(s,replay(),[h,h]) as any).blocked[0].reason,'DUPLICATE_DAY_SOURCE');
});
test('anchor receipt and quote must exist at explicit replay cutoff',()=>{
 assert.equal((compareSameDteHistory({...s,asOf:Date.parse('2026-10-13T09:36:23+05:30')},replay(),[]) as any).reason,'ANCHOR_PAIR_UNAVAILABLE_AT_CUTOFF');
 assert.equal(compareSameDteHistory({...s,asOf:Infinity},replay(),[]).ok,false);
});
test('malformed dates, non-grid selections and absent spot cannot produce evidence',()=>{
 assert.equal(compareSameDteHistory({...s,date:'2026-02-30'},replay(),[]).ok,false);
 assert.equal(compareSameDteHistory({...s,timeIst:'09:35'},replay(),[]).ok,false);
 const x=replay();x.market[1].spot_ltp=null;assert.equal(compareSameDteHistory(s,x,[]).ok,false);
});
test('selected evidence hash changes when observed price changes',()=>{
 const h=replay('2026-10-06');const a:any=compareSameDteHistory(s,replay(),[h]);h.options[1].ltp=103;
 const b:any=compareSameDteHistory(s,replay(),[h]);assert.notEqual(a.provenance.selectedEvidenceSha256,b.provenance.selectedEvidenceSha256);
});
test('HTTP retrieval reuses exact 3m FULL reader, six prior dates maximum, no future outcomes',async()=>{
 const calls:any[]=[];const r:any=await readSameDteHistory({symbol:s.symbol,date:s.date,expiry:s.expiry,strike:String(s.strike),side:s.side,time:s.timeIst},async q=>{calls.push(q);return replay(q.tradeDate);},async()=>({ok:true,dates:Array.from({length:10},(_,i)=>({symbol:'NIFTY',tradeDate:'2026-10-'+String(12-i).padStart(2,'0')}))} as any));
 assert.equal(r.ok,true);assert.equal(calls.length,7);assert.equal(r.retrieval.maximumPriorDays,6);
 assert.ok(calls.every(q=>q.fromTime==='09:33'&&q.toTime==='09:36'&&q.scope==='FULL'));
});
test('invalid anchor avoids history reads and route failures return unavailable',async()=>{
 const r=await readSameDteHistory({symbol:s.symbol,date:s.date,expiry:s.expiry,strike:String(s.strike),side:s.side,time:s.timeIst},async()=>replay('2026-10-12'),async()=>{throw Error('must not read');});assert.equal(r.ok,false);
 const app=new Hono();mountSameDteHistoryRoute(app,async()=>{throw Error('source failure');});
 const response=await app.request('/rag-same-dte-history');assert.equal(response.status,503);assert.equal((await response.json()).reason,'HISTORICAL_SOURCE_UNAVAILABLE');
 assert.equal((await app.request('/rag-same-dte-history',{method:'POST'})).status,404);
});
