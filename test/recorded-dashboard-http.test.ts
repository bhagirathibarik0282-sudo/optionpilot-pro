import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRecordedDashboardHandler } from '../recorded-dashboard-http.js';
import { renderRecordedDashboard } from '../recorded-dashboard-view.js';

async function serve(t:any,dependencies:any={},shouldRun=false){
 const handler=createRecordedDashboardHandler(dependencies);
 const server=http.createServer(async(req,res)=>{if(!await handler(req,res,{shouldRun})){res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
 await once(server,'listening');t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 return 'http://127.0.0.1:'+(server.address() as any).port;
}
test('saved viewer works before/after hours and at the normal dashboard address after close',async t=>{
 const url=await serve(t);for(const path of ['/','/recorded-dashboard','/api/research/business-dashboard/view']){const r=await fetch(url+path);assert.equal(r.status,200);assert.equal(r.headers.get('x-optionpilot-mode'),'RECORDED_READ_ONLY');assert.match(await r.text(),/All recorded days/);}
 assert.equal((await fetch(url+'/api/orders')).status,404);
});
test('every archive route rejects writes and a 60+ minute request never queries storage',async t=>{
 let reads=0;const url=await serve(t,{replay:async()=>{reads++;}});
 assert.equal((await fetch(url+'/recorded-dashboard',{method:'POST'})).status,405);
 const r=await fetch(url+'/api/research/recorded-dashboard/replay?symbol=NIFTY&date=2026-10-30&from=09:15&to=15:30');assert.equal(r.status,400);assert.equal(reads,0);
 assert.equal((await fetch(url+'/api/research/recorded-dashboard/replay?symbol=WRONG&date=2026-10-30&from=09:15&to=10:15')).status,400);
});
test('new replay endpoint preserves exact request and repairs full-PCR provenance before projecting',async t=>{
 let args:any[]=[];
 const source={symbol:'NIFTY',minute_bucket:'2026-10-30T03:45:00Z',expiry:'2026-11-02',truth_verdict:'TRUE',calculation_version:'H1_RUNTIME_BRIDGE_V1',full_chain_oi_pcr:9};
 const url=await serve(t,{replay:async(...values:any[])=>{args=values;return {ok:true,request:values[0],market:[],options:[],chain:[source],canonical:[]};}});
 const r=await fetch(url+'/api/research/recorded-dashboard/replay?symbol=NIFTY&date=2026-10-30&from=09:15&to=10:15');assert.equal(r.status,200);const data=await r.json();
 assert.equal(args[0].symbol,'NIFTY');assert.equal(args[0].scope,'CORE');assert.equal(args[1],true);
 const index=data.chain.columns.indexOf('full_chain_oi_pcr');assert.equal(data.chain.rows[0][index],null);assert.equal(data.canonical,undefined);
});
test('query failure reports missing storage rather than an empty successful session',async t=>{
 const url=await serve(t,{dates:async()=>({ok:false,dates:[],reason:'QUERY_FAILED'})});const r=await fetch(url+'/api/research/recorded-dashboard/dates');assert.equal(r.status,503);assert.equal((await r.json()).reason,'QUERY_FAILED');
});
test('archive concurrency is bounded; existing in-flight reads finish normally',async t=>{
 const releases:any[]=[];const url=await serve(t,{dates:()=>new Promise(resolve=>releases.push(()=>resolve({ok:true,dates:[]})))});
 const a=fetch(url+'/api/research/recorded-dashboard/dates'),b=fetch(url+'/api/research/recorded-dashboard/dates');
 while(releases.length<2)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await fetch(url+'/api/research/recorded-dashboard/dates')).status,429);releases.forEach(release=>release());assert.equal((await a).status,200);assert.equal((await b).status,200);
});
test('standalone browser script parses and exposes the requested queue controls',()=>{
 const html=renderRecordedDashboard();for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script));assert.match(html,/id="ar-last3"/);assert.match(html,/id="ar-last5"/);assert.match(html,/id="ar-all"/);
});
