import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createSellerResearchRunner } from '../seller-research-runtime.js';
import { mountSellerResearchRoutes } from '../seller-research-http.js';
import { DashboardLiveStore } from '../dashboard-live-feed.js';
import { createSellerKiteBasketMarginReader } from '../seller-kite-basket-margin-reader.js';

const NOW=Date.parse('2026-10-19T05:00:00Z'),at=new Date(NOW).toISOString(),expiry='2026-10-22';
const viewer={accessToken:'TEST_TOKEN',userId:'TEST_USER'};
const session={...viewer,sessionIdFingerprint:'TEST_SESSION',expiresAt:NOW+60000,loginTime:NOW-1000,email:null,source:'SHARED_DB_AUTHORITY' as const};
const request={symbol:'NIFTY' as const,shortToken:11,longToken:12,quantity:65,product:'NRML' as const,estimatedRoundTripCosts:50};
const entries=[{token:11,label:'NIFTY26OCT25000CE',role:'OPTION' as const,symbol:'NIFTY' as const,exchange:'NFO',expiry,strike:25000,side:'CE' as const,lotSize:65},
 {token:12,label:'NIFTY26OCT25100CE',role:'OPTION' as const,symbol:'NIFTY' as const,exchange:'NFO',expiry,strike:25100,side:'CE' as const,lotSize:65}];
function fixture(changes:any={}){
 let clock=NOW,marginCalls=0,fundsCalls=0,contextCalls=0;
 const store=new DashboardLiveStore({date:'2026-10-19',entries,missing:[],omittedExpiries:[]});
 const tick=(token:number,extra:any={})=>({instrumentToken:token,mode:'full' as const,isIndex:false,lastPrice:token===11?90:50,
  exchangeTimestamp:at,marketDepth:{buy:[{price:token===11?90:49,quantity:100,orders:2}],sell:[{price:token===11?91:50,quantity:100,orders:2}]},...extra});
 store.ingest([tick(11),tick(12)],at);
 const authority=async()=>({status:{active:true},session:{...session,...changes.session}} as any);
 const margin=createSellerKiteBasketMarginReader({now:()=>clock,apiKey:()=>'TEST_KEY',authority,fetchImpl:(async(url)=>{
  if(String(url).endsWith('/user/profile'))return Response.json({status:'success',data:{user_id:'TEST_USER'}});
  if(String(url).endsWith('/instruments'))return new Response('instrument_token,tradingsymbol,name,expiry,strike,instrument_type,segment,exchange,lot_size\n'+entries.map(e=>[e.token,e.label,e.symbol,e.expiry,e.strike,e.side,'NFO-OPT','NFO',65].join(',')).join('\n'),{headers:{'Content-Type':'text/csv'}});
  return Response.json({status:'success',data:{initial:{total:24000},final:{total:18000},orders:entries.map(e=>({exchange:e.exchange,tradingsymbol:e.label}))}});
 }) as typeof fetch});
 const context=()=>{contextCalls++;return {connected:true,connectionState:'OPEN',runtimeId:changes.restart&&contextCalls>1?'other':store.runtimeId,
  sessionToken:viewer.accessToken,short:store.sellerLeg(11,65),long:store.sellerLeg(12,65),...changes.context};};
 const run=createSellerResearchRunner({now:()=>clock,marketOpen:()=>changes.closed?false:true,authority,context,
  margin:async input=>{marginCalls++;let r=await margin(input);if(changes.margin&&r.status==='PARTIAL')r={...r,...changes.margin};if(changes.afterMargin)changes.afterMargin({setClock:(t:number)=>clock=t,store,tick});return r;},
  funds:async()=>{fundsCalls++;return Object.hasOwn(changes,'capital')?changes.capital:100000;}});
 return {run,store,tick,setClock:(t:number)=>clock=t,counts:()=>({marginCalls,fundsCalls})};
}
test('exact FULL packets → margin request/response → existing seller economics, with no authority',async()=>{
 const f=fixture(),r=await f.run(viewer,request);assert.equal(r.status,'PARTIAL');
 if(r.status!=='PARTIAL')return;
 assert.equal(r.source,'TEST_ONLY');assert.equal(r.card.status,'RESEARCH_ONLY');assert.equal(r.createsOrders,false);assert.equal(r.affectsSelector,false);assert.equal(r.executionReady,false);
 assert.equal(r.quotes.shortBid,90);assert.equal(r.quotes.longAsk,50);assert.equal(r.margin.initial,24000);assert.equal(r.margin.final,18000);
 assert.equal(r.card.economics.grossCredit,2600);assert.equal(r.card.economics.estimatedNetCredit,2550);assert.equal(r.card.economics.estimatedMaxLoss,3950);
 assert.equal(r.validUntilMs,NOW+5000);assert.ok(!JSON.stringify(r).includes('TEST_TOKEN'));
});
for(const [name,changes,code] of [
 ['market closed',{closed:true},'MARKET_CLOSED'],
 ['feed disconnected',{context:{connected:false}},'LIVE_FEED_SESSION_MISMATCH'],
 ['old feed account',{context:{sessionToken:'OTHER'}},'LIVE_FEED_SESSION_MISMATCH'],
 ['missing leg',{context:{long:null}},'EXACT_TWO_LEG_DEPTH_MISSING'],
 ['wrong account',{session:{userId:'OTHER'}},'KITE_ACCOUNT_SESSION_MISMATCH'],
 ['feed restart',{restart:true},'LIVE_FEED_RESTARTED'],
 ['missing capital',{capital:null},'BROKER_AVAILABLE_CAPITAL_MISSING'],
 ['insufficient capital',{capital:100},'CAPITAL_INSUFFICIENT'],
 ['margin account mismatch',{margin:{accountBinding:'other'}},'MARGIN_ACCOUNT_OR_SNAPSHOT_MISMATCH'],
 ['margin snapshot mismatch',{margin:{snapshotId:'other'}},'MARGIN_ACCOUNT_OR_SNAPSHOT_MISMATCH'],
 ['margin contract mismatch',{margin:{shortLeg:{instrumentToken:99}}},'MARGIN_EXACT_PAIR_MISMATCH'],
 ['margin product mismatch',{margin:{basket:[{product:'MIS',quantity:65}]}},'MARGIN_EXACT_PAIR_MISMATCH'],
 ['margin aged out',{margin:{requestedAtMs:NOW-11000}},'MARGIN_RESPONSE_STALE'],
] as const)test(`integrated fail closed: ${name}`,async()=>{
 const r=await fixture(changes).run(viewer,request);assert.equal(r.status,'BLOCKED');if(r.status==='BLOCKED')assert.ok(r.blockers.includes(code));assert.equal(r.createsOrders,false);
});
test('rejects insufficient displayed quantity before any margin call',async()=>{
 const f=fixture();f.store.ingest([f.tick(11,{marketDepth:{buy:[{price:90,quantity:0,orders:1}],sell:[{price:91,quantity:100,orders:1}]}})],at);
 const r=await f.run(viewer,request);assert.equal(r.status,'BLOCKED');if(r.status==='BLOCKED')assert.deepEqual(r.blockers,['SELLER_DEPTH_QUANTITY_INSUFFICIENT']);assert.equal(f.counts().marginCalls,0);
});
test('rechecks depth after awaiting broker response rather than reusing frozen quote',async()=>{
 const f=fixture({afterMargin:({setClock}:any)=>setClock(NOW+6000)}),r=await f.run(viewer,request);
 assert.equal(r.status,'BLOCKED');if(r.status==='BLOCKED')assert.deepEqual(r.blockers,['SELLER_DEPTH_STALE_OR_FUTURE']);
});
test('independent leg time skew blocks',async()=>{
 const f=fixture();f.store.ingest([f.tick(12,{exchangeTimestamp:new Date(NOW+2000).toISOString()})],new Date(NOW+2000).toISOString());f.setClock(NOW+2000);
 const r=await f.run(viewer,request);assert.equal(r.status,'BLOCKED');if(r.status==='BLOCKED')assert.deepEqual(r.blockers,['SELLER_LEG_TIME_SKEW']);
});
test('missing cost never becomes a zero-cost assumption',async()=>{
 const f=fixture(),r=await f.run(viewer,{...request,estimatedRoundTripCosts:undefined});assert.equal(r.status,'BLOCKED');assert.equal(f.counts().marginCalls,0);
});
function app(loggedIn=true,runner=fixture().run){const a=new Hono();mountSellerResearchRoutes(a,()=>loggedIn?viewer:null,runner,()=>({connectionState:'OPEN',rows:entries}),()=>NOW);return a;}
const post=(extra:any={})=>({method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost',...extra.headers},body:extra.body??JSON.stringify(request)});
test('account routes reject anonymous reads and checks before broker calls',async()=>{
 const f=fixture(),a=app(false,f.run);for(const [path,init] of [['/api/account/kite/seller/options',undefined],['/api/account/kite/seller/research',post()]] as const)assert.equal((await a.request(path,init)).status,401);assert.equal(f.counts().marginCalls,0);
});
test('POST requires same origin and JSON; GET options never invokes margin',async()=>{
 const f=fixture(),a=app(true,f.run);assert.equal((await a.request('/api/account/kite/seller/options')).status,200);assert.equal(f.counts().marginCalls,0);
 for(const [headers,status] of [[{Origin:'https://evil.example'},403],[{Origin:''},403],[{'Content-Type':'text/plain'},415]] as const)assert.equal((await a.request('/api/account/kite/seller/research',post({headers}))).status,status);
 assert.equal(f.counts().marginCalls,0);
});
test('one protected check reaches integrated card, then cooldown bounds broker load',async()=>{
 const f=fixture(),a=app(true,f.run),r=await a.request('/api/account/kite/seller/research',post());assert.equal(r.status,200);assert.equal((await r.json()).status,'PARTIAL');
 assert.equal((await a.request('/api/account/kite/seller/research',post())).status,429);assert.equal(f.counts().marginCalls,1);
});

test('future exchange timestamps are rejected by the reused exact adapter',async()=>{
 const f=fixture();f.store.ingest([f.tick(11,{exchangeTimestamp:new Date(NOW+1000).toISOString()})],at);
 const r=await f.run(viewer,request);assert.equal(r.status,'BLOCKED');if(r.status==='BLOCKED')assert.deepEqual(r.blockers,['EXACT_TWO_LEG_DEPTH_MISSING']);
});
test('request schema rejects array-valued fields and non-finite or negative estimates',async()=>{
 for(const change of [{symbol:['NIFTY']},{product:['NRML']},{estimatedRoundTripCosts:NaN},{estimatedRoundTripCosts:-1},{quantity:1.5}]){
  const f=fixture(),r=await f.run(viewer,{...request,...change});assert.equal(r.status,'BLOCKED');assert.equal(f.counts().marginCalls,0);
 }
});
test('HTTP parsing failures never reach the broker',async()=>{
 const f=fixture(),a=app(true,f.run);
 assert.equal((await a.request('/api/account/kite/seller/research',post({body:'{'}))).status,400);
 assert.equal((await a.request('/api/account/kite/seller/research',post({body:'x'.repeat(4097)}))).status,413);
 assert.equal(f.counts().marginCalls,0);
});
