import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createRecordedDashboardHandler} from '../recorded-dashboard-http.js';
import {renderBnfShadowPage} from '../bnf-shadow-page.js';
import {renderRecordedDashboard} from '../recorded-dashboard-view.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';

async function serve(t:any,deps:any={}){
 const handler=createRecordedDashboardHandler(deps);
 const server=http.createServer(async(req,res)=>{if(!await handler(req,res,{shouldRun:false})){res.writeHead(404);res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 return 'http://127.0.0.1:'+(server.address() as any).port;
}
test('private timeline requires existing bearer token before any DB call; GET-only and no credentials in URL',async t=>{
 const old=process.env.RESEARCH_ADMIN_TOKEN;process.env.RESEARCH_ADMIN_TOKEN='synthetic-admin-secret-not-real';
 t.after(()=>old===undefined?delete process.env.RESEARCH_ADMIN_TOKEN:process.env.RESEARCH_ADMIN_TOKEN=old);
 let reads=0;
 const stub={ok:true,mode:'BNF_SHADOW_TIMELINE_READ_ONLY_V1',date:'2026-11-18',source:'DURABLE_SHADOW_PAPER_JOURNAL',
  brokerOrders:0,actualBrokerFills:false,telegramDeliveryVerified:false,counts:{intents:2,entryFills:2,exitFills:3},trades:[]};
 const url=await serve(t,{timeline:async(date:string)=>{reads++;assert.equal(date,'2026-11-18');return stub;}});
 const path='/api/research/recorded-dashboard/bnf-shadow-timeline?date=2026-11-18';
 const unauthorized=await fetch(url+path);assert.equal(unauthorized.status,401);assert.equal(reads,0);
 assert.equal((await fetch(url+path,{headers:{Authorization:'Bearer wrong'}})).status,401);assert.equal(reads,0);
 assert.equal((await fetch(url+path,{method:'POST',headers:{Authorization:'Bearer synthetic-admin-secret-not-real'}})).status,405);assert.equal(reads,0);
 assert.equal((await fetch(url+path.replace('2026-11-18','2026-11-32'),{headers:{Authorization:'Bearer synthetic-admin-secret-not-real'}})).status,400);assert.equal(reads,0);
 const r=await fetch(url+path,{headers:{Authorization:'Bearer synthetic-admin-secret-not-real'}});
 assert.equal(r.status,200);
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(r.headers.get('x-optionpilot-mode'),'RECORDED_READ_ONLY');
 assert.deepEqual(await r.json(),stub);
 assert.equal(reads,1);
});
test('missing admin token blocks the private timeline (no automatic public fallback)',async t=>{
 const old=process.env.RESEARCH_ADMIN_TOKEN;delete process.env.RESEARCH_ADMIN_TOKEN;
 t.after(()=>old===undefined?delete process.env.RESEARCH_ADMIN_TOKEN:process.env.RESEARCH_ADMIN_TOKEN=old);
 let reads=0;const url=await serve(t,{timeline:async()=>{reads++;return {ok:true};}});
 const response=await fetch(url+'/api/research/recorded-dashboard/bnf-shadow-timeline?date=2026-11-18');
 assert.equal(response.status,503);assert.equal(reads,0);
});
test('dedicated SHADOW page contains the private timeline with no credential auto-send',()=>{
 const pages=[renderBnfShadowPage()];
 for(const html of pages){
  assert.equal((html.match(/id="bnf-shadow-timeline"/g)||[]).length,1);
  assert.match(html,/BANKNIFTY · SHADOW Signal/);
  assert.match(html,/bnf-shadow-timeline-key/);
  assert.match(html,/bnf-shadow-timeline-load/);
  assert.match(html,/installBnfShadowTimeline/);
  assert.doesNotMatch(html,/value="synthetic-admin-secret-not-real"/);
  for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(script));
 }
});
