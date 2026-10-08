import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {researchRouter} from '../research-router.js';
import {prepareMemoryData,detectObservationEvents,buildObservationResponses,mergeMemoryData, type MemoryData} from '../intraday-observation-memory.js';
import {expectedPreviousTradingDate,queueIntradayMemoryCycle,intradayMemoryRuntimeStatus} from '../intraday-observation-memory-runtime.js';
import type {H1ReplayHttpResult} from '../h1-replay-http.js';
function fixture():H1ReplayHttpResult {
 const market=[],options=[],chain=[];
 for(let i=0;i<=20;i++) {
  const t=new Date(Date.parse('2026-10-08T03:45:00Z')+i*180000).toISOString(),snapshot_id='s'+i;
  market.push({symbol:'NIFTY',minute_bucket:t,truth_verdict:'TRUE',snapshot_id,calculation_version:'STORAGE_V3_PHASE1',spot_ltp:22500+i,india_vix:15,future_ltp:22550+i,future_oi:1000+i});
  chain.push({symbol:'NIFTY',minute_bucket:t,truth_verdict:'TRUE',calculation_version:'STORAGE_V3_PHASE1',expiry:'2026-10-13',full_chain_oi_pcr:1,call_wall_strike:i>=4?22600:22550,put_wall_strike:22400});
  for(const side of ['CE','PE'])options.push({symbol:'NIFTY',minute_bucket:t,truth_verdict:'TRUE',snapshot_id,calculation_version:'STORAGE_V3_PHASE1',expiry:'2026-10-13',strike:22500,option_type:side,atm_offset:0,dte:5,ltp:side==='CE'?i?100+i*2:99:100-i,pdh:side==='CE'?100:200,pdl:1,oi:i===15?2000:1000+i*10,quote_age_seconds:5,quote_timestamp:t});
 }
 return {ok:true,mode:'READ_ONLY_H1_3M_REPLAY',productionImpact:'NONE',request:{symbol:'NIFTY',tradeDate:'2026-10-08',fromTime:'09:15',toTime:'15:30',scope:'CORE'},market,options,chain,canonical:[]};
}
const empty:MemoryData={market:[],options:[],chain:[]};
const detect=(d=prepareMemoryData(fixture()))=>detectObservationEvents(d,empty,'NIFTY','2026-10-08','2026-10-07',null,'RECOVERED_HISTORICAL');
const crossing=(d=prepareMemoryData(fixture()))=>detect(d).find(e=>e.facts.some(f=>f.family==='PREMIUM_LEVEL'))!;
test('reuses PDH crossing and wall migration, groups facts per exact contract/time',()=>{
 const es=detect();assert.ok(crossing());assert.ok(es.some(e=>e.facts.some(f=>f.family==='WALL_MIGRATION')));
 assert.equal(new Set(es.map(e=>e.memoryKey)).size,es.length);assert.equal(crossing().at,'2026-10-08T03:48:00.000Z');
 assert.equal(crossing().previousDay.consecutiveTradingDay,false);assert.equal(crossing().previousDay.sameContractPair.ce,null);
});
test('exact same-strike CE/PE returns for all three horizons',()=>{
 const data=prepareMemoryData(fixture()),e=crossing(data),rs=buildObservationResponses(e,data,'2026-10-08T04:45:00.000Z');
 assert.equal(rs.length,3);assert.ok(rs.every(r=>r.status==='QUALIFIED'&&r.expiry===e.expiry&&r.strike===e.strike));
 assert.equal(rs[0].pair.ce!.ltp,104);assert.ok(Math.abs(rs[0].ceReturnPct!-(104/102-1)*100)<1e-10);
});
for(const [field,value] of [['quote_age_seconds',61],['quote_age_seconds',null],['snapshot_id','wrong'],['truth_verdict','PARTIAL'],['ltp',0],['quote_timestamp',null]] as const) test('rejects target '+field+'='+value,()=>{
 const raw=fixture();raw.options!.find(r=>r.minute_bucket==='2026-10-08T03:51:00.000Z'&&r.option_type==='CE')![field]=value;
 const d=prepareMemoryData(raw),r=buildObservationResponses(crossing(d),d,'2026-10-08T04:45:00.000Z')[0];assert.equal(r.status,'MISSING');assert.equal(r.ceReturnPct,null);
});
test('ATM roll and nearby timestamp cannot substitute for exact locked target',()=>{
 const raw=fixture(),r=raw.options!.find(r=>r.minute_bucket==='2026-10-08T03:51:00.000Z'&&r.option_type==='CE')!;r.strike=22550;
 const d=prepareMemoryData(raw);assert.equal(buildObservationResponses(crossing(d),d,'2026-10-08T04:45:00.000Z')[0].status,'MISSING');
 r.strike=22500;r.minute_bucket='2026-10-08T03:52:00.000Z';assert.equal(buildObservationResponses(crossing(),prepareMemoryData(raw),'2026-10-08T04:45:00.000Z')[0].status,'MISSING');
});
test('gap crossing never fabricates instant PDH break; pending horizons remain unsaved',()=>{
 const raw=fixture();raw.market=raw.market!.filter(r=>r.minute_bucket!=='2026-10-08T03:48:00.000Z');
 assert.ok(!detect(prepareMemoryData(raw)).some(e=>e.facts.some(f=>f.family==='PREMIUM_LEVEL')));
 assert.equal(buildObservationResponses(crossing(),prepareMemoryData(fixture()),'2026-10-08T03:48:00.000Z').length,0);
});
test('late event records session-boundary missing rather than next-day gain',()=>{
 const e={...crossing(),at:'2026-10-08T09:57:00.000Z'};const rs=buildObservationResponses(e,empty,'2026-10-08T10:00:00.000Z');
 assert.equal(rs[1].reason,'OUTSIDE_SAME_SESSION');assert.equal(rs[2].peReturnPct,null);
});
test('notable percentile uses only earlier changes; future data does not alter earlier frozen facts',()=>{
 const full=prepareMemoryData(fixture()),at='2026-10-08T04:33:00.000Z';
 const prefix={market:full.market.filter(r=>r.minute_bucket<=at),options:full.options.filter(r=>r.minute_bucket<=at),chain:full.chain.filter(r=>r.minute_bucket<=at)};
 const past=detect(prefix),all=detect(full).filter(e=>e.at<=at);assert.deepEqual(past,all);
 assert.ok(all.some(e=>e.facts.some(f=>f.earlierSamples>=8)));
});
test('legacy band PCR excluded; canonical exact full-chain provenance restored',()=>{
 const raw=fixture();raw.market!.forEach(r=>r.calculation_version='H1_RUNTIME_BRIDGE_V1');raw.chain!.forEach(r=>r.calculation_version='H1_RUNTIME_BRIDGE_V1');
 assert.ok(prepareMemoryData(raw).chain.every(r=>r.full_chain_oi_pcr===null));
 raw.canonical=raw.market!.map(r=>({...r,market:{symbol:'NIFTY',gapScore:{fullChainPcr:1.5},expiries:[{expiry:'Current Expiry',expiryDate:'2026-10-13'}]}}));
 assert.ok(prepareMemoryData(raw).chain.every(r=>r.full_chain_oi_pcr===1.5));
});
test('incremental merging retains exact contract identity without duplicate rows',()=>{
 const d=prepareMemoryData(fixture());assert.deepEqual(mergeMemoryData(d,d),d);
 assert.equal(expectedPreviousTradingDate('2026-10-21'),'2026-10-19');queueIntradayMemoryCycle();assert.equal(intradayMemoryRuntimeStatus().running,false);
});
test('GET is read-only, invalid requests rejected, outage fails closed',async()=>{
 const app=new Hono();app.route('/api/research',researchRouter);
 assert.equal((await app.request('/api/research/intraday-memory?date=2026-02-30')).status,400);
 assert.equal((await app.request('/api/research/intraday-memory?symbol=FOO')).status,400);
 assert.equal((await app.request('/api/research/intraday-memory',{method:'POST'})).status,404);
 assert.equal((await app.request('/api/research/intraday-memory/view')).status,200);
 assert.equal((await app.request('/api/research/intraday-memory')).status,503);
});
