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
test('unified terminal and legacy saved viewer work at their existing addresses after close',async t=>{
 const url=await serve(t);for(const path of ['/','/recorded-dashboard','/api/research/business-dashboard/view']){const r=await fetch(url+path);assert.equal(r.status,200);assert.equal(r.headers.get('x-optionpilot-mode'),'RECORDED_READ_ONLY');const html=await r.text();assert.match(html,/All recorded days/);if(path!=='/recorded-dashboard'){assert.match(html,/id="op-recorded-mode"/);assert.match(html,/id="mb-live-watch" open/);assert.match(html,/id="mb-watch-chart"/);assert.match(html,/id="mb-shared-memory"/);assert.match(html,/const recordedOnly=true/);}}
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

test('archive facade serves existing RAG readers with GET-only methods and unchanged exact selection',async t=>{
 let reads=0;const url=await serve(t,{ragEvidence:async(selection:any)=>{reads++;return {ok:true,identity:selection,safety:{writesPerformed:false,createsOrders:false}};},ragHistory:async()=>({ok:true,matches:[]})});
 const path='/api/research/rag-event-evidence?symbol=NIFTY&date=2026-11-04&expiry=2026-11-09&strike=23900&side=CE&time=14:31&kind=SNAPSHOT&lookback=3';
 const r=await fetch(url+path);assert.equal(r.status,200);assert.equal(r.headers.get('x-optionpilot-mode'),'RECORDED_READ_ONLY');assert.equal((await r.json()).identity.time,'14:31');assert.equal(reads,1);
 assert.equal((await fetch(url+path,{method:'POST'})).status,405);assert.equal(reads,1);
 assert.equal((await fetch(url+path.replace('kind=SNAPSHOT','kind=EVENT'))).status,400);assert.equal(reads,1);
 assert.equal((await fetch(url+'/api/research/rag-event-evidence/view')).status,200);
 assert.equal((await fetch(url+'/api/research/rag-same-dte-history')).status,200);
});
test('after-hours dashboard embeds the same evidence panel without navigating to another page',()=>{
 const html=renderRecordedDashboard();assert.equal((html.match(/id="rag-evidence-card"/g)||[]).length,1);assert.match(html,/id="rag-time"[^>]*step="60"/);
});


test('after-hours main dashboard shows an honest BANKNIFTY SHADOW status without starting a worker',async t=>{
 const url=await serve(t,{},false);
 for(const path of ['/recorded-dashboard']){
  const r=await fetch(url+path);assert.equal(r.status,200);
  const html=await r.text();
  assert.equal((html.match(/id="ar-bnf-shadow"/g)||[]).length,1);
  assert.match(html,/BANKNIFTY · SHADOW PAPER/);
  assert.match(html,/OFF HOURS/);
  assert.match(html,/paper signals, entries and exits are not verified/);
  assert.match(html,/All recorded days/);
  assert.doesNotMatch(html,/\/api\/kite\/orders|<form[^>]*action="\/orders/);
 }
});

test('normal recorded replay does not mislabel an operating-hours worker as off-hours',async t=>{
 const url=await serve(t,{},true);
 const r=await fetch(url+'/recorded-dashboard');assert.equal(r.status,200);
 assert.doesNotMatch(await r.text(),/id="ar-bnf-shadow"/);
});


test('GET-only day-wise SHADOW journal endpoint works after hours without touching trading or replay',async t=>{
 let reads=0;
 const report={ok:true,mode:'BNF_SHADOW_DAYWISE_READ_ONLY_V1',source:'DURABLE_PAPER_JOURNAL',lots:[1,2,4,6],days:[],reason:'NO_VERIFIED_SHADOW_JOURNAL_EVENTS',estimatedOnly:true,brokerOrders:0,fillsNotScaled:true};
 const url=await serve(t,{daywise:async()=>{reads++;return report}},false);
 const response=await fetch(url+'/api/research/recorded-dashboard/bnf-shadow-daywise');
 assert.equal(response.status,200);
 assert.equal(response.headers.get('x-optionpilot-mode'),'RECORDED_READ_ONLY');
 const body=await response.json();
 const {selectedDay,latestJournalDate,...original}=body;
 assert.deepEqual(original,report);
 assert.equal(latestJournalDate,null);
 assert.equal(selectedDay.status,'NO_JOURNAL_EVENTS');
 assert.equal(selectedDay.completeSessionVerified,false);
 assert.equal(reads,1);
 const post=await fetch(url+'/api/research/recorded-dashboard/bnf-shadow-daywise',{method:'POST'});
 assert.equal(post.status,405);
 assert.equal(reads,1);
});

test('day-wise SHADOW journal evidence failure never renders fictitious P&L',async t=>{
 const url=await serve(t,{daywise:async()=>({ok:false,mode:'BNF_SHADOW_DAYWISE_READ_ONLY_V1',reason:'SHADOW_JOURNAL_UNAVAILABLE',days:[],lots:[1,2,4,6],brokerOrders:0})});
 const response=await fetch(url+'/api/research/recorded-dashboard/bnf-shadow-daywise');
 assert.equal(response.status,503);
 const body=await response.json();
 assert.equal(body.days.length,0);
 assert.equal(body.reason,'SHADOW_JOURNAL_UNAVAILABLE');
});

test('selected SHADOW date is validated before DB reads and worker history cannot masquerade as live proof',async t=>{
 let reads=0;
 const url=await serve(t,{daywise:async()=>{reads++;return {ok:true,days:[],lots:[1,2,4,6],brokerOrders:0};},
  shadowHealth:(date:string)=>({date,phase:'BLOCKED',reason:'WORKER_EXITED_NO_AUTO_RETRY',lastExitAt:date+'T04:00:00Z',
   exitCode:1,account:'PRIVATE',lastReportedCounts:{observations:12,signals:0}})});
 assert.equal((await fetch(url+'/api/research/recorded-dashboard/bnf-shadow-daywise?date=2026-11-31')).status,400);
 assert.equal(reads,0);
 const response=await fetch(url+'/api/research/recorded-dashboard/bnf-shadow-daywise?date=2026-11-19');
 const body=await response.json();assert.equal(response.status,200);assert.equal(reads,1);
 assert.equal(body.selectedDay.date,'2026-11-19');assert.equal(body.selectedDay.status,'NO_JOURNAL_EVENTS');
 assert.equal(body.selectedDay.workerEvidence.exitCode,1);assert.equal(body.selectedDay.completeSessionVerified,false);
 assert.ok(!JSON.stringify(body).includes('PRIVATE'));
});

test('after-hours market dashboard links to the dedicated SHADOW page without large panels',()=>{
 const html=renderRecordedDashboard(true);
 assert.equal((html.match(/class="op-bnf-daywise"/g)||[]).length,0);
 assert.match(html,/href="\/banknifty-shadow"/);
});

 test('dedicated SHADOW viewer is GET-only and available while the market worker is stopped',async t=>{
 let reads=0;const url=await serve(t,{daywise:async()=>{reads++;}},false);
 const response=await fetch(url+'/banknifty-shadow');assert.equal(response.status,200);
 const html=await response.text();assert.match(html,/BANKNIFTY · SHADOW PAPER/);assert.match(html,/est = estimated/);
 assert.equal(reads,0);assert.equal((await fetch(url+'/banknifty-shadow',{method:'POST'})).status,405);
 });


test('off-hours unified terminal routes admit only bounded GET readback without invoking the market runtime',async t=>{
 let calls:any[]=[];
 const date='2025-10-30';
 const url=await serve(t,{
  dates:async()=>({ok:true,dates:[{symbol:'NIFTY',tradeDate:date}]}),
  replay:async(request:any,provenance:any)=>{calls.push({request,provenance});return {ok:true,request,market:[],options:[],chain:[],canonical:[]};},
  oiHistory:async(d:string)=>{calls.push(['oi',d]);return {date:d,rows:[]};},
  quoteHistory:async(d:string)=>{calls.push(['quotes',d]);return {date:d,snapshots:[]};},
  memory:async(d:string,s:string)=>{calls.push(['memory',d,s]);return {ok:true,tradeDate:d,events:[],responses:[],availability:{events:{},responses:{}}};},
  cash:async()=>{calls.push(['cash']);return {status:200,body:{ok:true,contextOnly:true}};}
 });
 const paths=['/api/research/h1-theory-dates','/api/research/dashboard-watch/oi-history?date='+date,'/api/research/background-quotes/history?date='+date,'/api/research/intraday-memory?date='+date+'&symbol=NIFTY','/api/research/fii-dii/production-readiness'];
 for(const path of paths){const r=await fetch(url+path);assert.equal(r.status,200,path);assert.equal(r.headers.get('x-optionpilot-mode'),'RECORDED_READ_ONLY');assert.equal((await fetch(url+path,{method:'POST'})).status,405);}
 const route='/api/research/h1-replay?symbol=NIFTY&date='+date+'&from=09:15&to=11:15&scope=CORE&format=compact&canonical=pcr-provenance';
 const r=await fetch(url+route);assert.equal(r.status,200);assert.equal((await r.json()).canonicalProjection,'PCR_PROVENANCE_V1');
 assert.equal(calls.at(-1).request.scope,'CORE');assert.equal(calls.at(-1).provenance,true);
 const before=calls.length;
 for(const path of [route.replace('11:15','11:16'),route.replace('scope=CORE','scope=FULL'),route.replace('&canonical=pcr-provenance',''),'/api/research/intraday-memory?date=2025-02-30','/api/research/background-quotes/history?date='+date+'&symbol=WRONG'])assert.equal((await fetch(url+path)).status,400,path);
 assert.equal((await fetch(url+route,{method:'POST'})).status,405);assert.equal(calls.length,before);
 assert.equal((await fetch(url+'/api/research/background-quotes')).status,404);
 assert.equal((await fetch(url+'/api/orders')).status,404);
});
test('operating-hours dashboard routes stay with the existing market child',async t=>{
 const url=await serve(t,{},true);
 for(const path of ['/','/api/research/business-dashboard/view','/api/research/h1-theory-dates','/api/research/intraday-memory?date=2025-10-30'])assert.equal((await fetch(url+path)).status,404,path);
 assert.equal((await fetch(url+'/recorded-dashboard')).status,200);
});
