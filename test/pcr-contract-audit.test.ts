import test from 'node:test';
import assert from 'node:assert/strict';
import {DashboardPcrSampler} from '../dashboard-pcr-sampler.js';
import {inspectPcrContractArithmetic} from '../scripts/check-pcr-contract-arithmetic.js';
import {Hono} from 'hono';
import {mountDashboardLiveRoutes} from '../dashboard-live-http.js';

const date='2026-11-04',expiry='2026-11-09',at=Date.parse(date+'T10:00:00+05:30');
function fixture(){
 let now=at,active=true,fail=false,calls=0;
 const entries:any[]=['CE','PE'].map((side,i)=>({role:'OPTION',symbol:'NIFTY',expiry,strike:23800,token:10+i,exchange:'NFO',label:'OPT'+side,side}));
 const quotes:any=Object.fromEntries(entries.map(e=>['NFO:'+e.label,{instrument_token:e.token,oi:e.side==='CE'?100:200,timestamp:date+(e.side==='CE'?' 09:50:00':' 10:00:00'),secret:'MUST_NOT_LEAK'}]));
 const sampler=new DashboardPcrSampler({date,entries,missing:[],omittedExpiries:[]},{now:()=>now,active:()=>active,wait:async()=>{},fetchQuotes:async()=>{calls++;if(fail)throw Error('PCR_QUOTE_HTTP_429');return quotes;}});
 return {sampler,quotes,calls:()=>calls,advance:(ms:number)=>now+=ms,fail:()=>fail=true,
  payload:()=>({connected:true,readOnly:true,extraBrokerRequests:0,serverTime:new Date(now).toISOString(),audit:sampler.readAudit('NIFTY',expiry)})};
}
test('old outer quote retains independently summable reported evidence without making fresh PCR',async()=>{
 const h=fixture();await h.sampler.tick();const p=h.payload(),r=inspectPcrContractArithmetic(p);
 assert.equal(h.sampler.read('NIFTY',expiry)?.fullPcr,null);
 assert.equal(r.ok,true);assert.equal((r as any).pcr,2);assert.equal((r as any).ceTotal,100);assert.equal((r as any).peTotal,200);
 assert.equal((r as any).freshnessState,'INCOMPLETE');assert.equal((r as any).observation,'LATEST_REPORTED_MIXED_TIMESTAMPS');
 assert.equal(h.calls(),1);assert(!JSON.stringify(p).includes('MUST_NOT_LEAK'));
 assert(!JSON.stringify(h.sampler.read('NIFTY',expiry)).includes('rows"'),'audit rows do not enter the live/SSE snapshot');
 p.audit!.rows[0].oi=999;assert.equal(h.payload().audit!.rows[0].oi,100,'audit reader cannot mutate saved evidence');
 assert.equal(h.sampler.readAudit('NIFTY','2026-11-17'),null);
});
test('missing/invalid OI, token mismatch and duplicate rows cannot pass independent arithmetic',async()=>{
 const h=fixture();await h.sampler.tick();const original=h.payload();
 for(const mutate of [(p:any)=>p.audit.rows.pop(),(p:any)=>p.audit.rows[0].oi=null,(p:any)=>p.audit.rows[0].oi=-1,(p:any)=>p.audit.rows[0].oi=.5,(p:any)=>p.audit.rows[0].responseToken=999,(p:any)=>p.audit.rows[1]={...p.audit.rows[0]},(p:any)=>p.audit.rows[0].expiry='2026-11-17',(p:any)=>p.audit.claimed.value=9,(p:any)=>p.audit.claimed.ceTotal=99,(p:any)=>p.connected=false,(p:any)=>p.audit.rows[0].sourceAt='invalid']){
  const p=structuredClone(original);mutate(p);assert.equal(inspectPcrContractArithmetic(p).ok,false);
 }
 h.quotes['NFO:OPTPE'].oi=0;h.advance(60000);await h.sampler.tick();assert.equal((inspectPcrContractArithmetic(h.payload()) as any).pcr,0);
});
test('failed, expired and new-session attempts revoke cached evidence and never borrow old rows',async()=>{
 const h=fixture();await h.sampler.tick();assert(h.payload().audit);
 h.advance(90001);assert.equal(h.payload().audit,null);
 h.fail();await h.sampler.tick();assert.equal(h.payload().audit,null);
 const next=fixture();await next.sampler.tick();next.advance(86400000);assert.equal(next.payload().audit,null);
});
test('cached audit GET validates exact selection, avoids display reads and is not cached',async()=>{
 const h=fixture();await h.sampler.tick();let reads=0;
 const app=new Hono();mountDashboardLiveRoutes(app,()=>{throw Error('Unexpected display read');},()=>'',(symbol,exp)=>{reads++;assert.equal(symbol,'NIFTY');assert.equal(exp,expiry);return h.payload();});
 for(const query of ['', '?symbol=OTHER&expiry='+expiry,'?symbol=NIFTY&expiry=2026-02-30','?symbol=NIFTY&expiry=bad'])assert.equal((await app.request('/dashboard-live/pcr-audit'+query)).status,400);
 assert.equal(reads,0);
 const r=await app.request('/dashboard-live/pcr-audit?symbol=NIFTY&expiry='+expiry);
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(inspectPcrContractArithmetic(await r.json()).ok,true);assert.equal(reads,1);assert.equal(h.calls(),1);
});
