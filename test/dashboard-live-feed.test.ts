import test from 'node:test';import assert from 'node:assert/strict';
import { buildDashboardLiveInventory,DashboardLiveStore,LIVE_INDICES,type LiveEntry } from '../dashboard-live-feed.js';
import type { KiteInstrumentMasterRow } from '../kite-immediate-registry-builder.js';
import type { KiteDecodedPacket } from '../kite-websocket-binary-decoder.js';
import { Hono } from 'hono';import { mountDashboardLiveRoutes } from '../dashboard-live-http.js';
import { KiteWebSocketTransport,registerKiteTickObserver } from '../kite-websocket-transport.js';
import { deriveDashboardModelDelta } from '../dashboard-model-delta.js';
const date='2026-10-16',at='2026-10-16T04:30:00.000Z',now=Date.parse(at),expiry='2026-10-19';
const entries:LiveEntry[]=[{token:1,label:'NIFTY 50',symbol:'NIFTY',role:'SPOT'},{token:2,label:'FUT',symbol:'NIFTY',role:'FUTURE',expiry:'2026-10-27'},...['CE','PE'].flatMap((side,i)=>[22000,22100].map((strike,j)=>({token:10+i*2+j,label:side+strike,symbol:'NIFTY' as const,role:'OPTION' as const,expiry,strike,side:side as 'CE'|'PE'})))];
function packet(token:number,extra:Partial<KiteDecodedPacket>={}):KiteDecodedPacket{return {mode:'full',isIndex:token===1,instrumentToken:token,lastPrice:token===1?22005:token===2?22015:100,exchangeTimestamp:at,oi:100,close:90,...extra};}
function fixture(){const store=new DashboardLiveStore({entries,missing:[],omittedExpiries:[],date});store.ingest(entries.map(e=>packet(e.token)),at);return store;}
test('opt-in Model Delta reuses exact cached full packets and never changes the default feed',()=>{
 const store=fixture(),normal=store.premiums(now,{view:'ladder'});assert(normal.rows.every(r=>!('modelDelta' in r)));
 const modeled=store.premiums(now,{view:'ladder',modelDelta:true});assert(modeled.rows.some(r=>r.modelDelta?.source==='BLACK_SCHOLES_MODEL'));
 for(const row of modeled.rows){if(!row.modelDelta)continue;assert.equal(row.modelDelta.token,row.identity!.token);assert.equal(row.modelDelta.premium,row.price);assert.equal(row.modelDelta.annualRiskFreeRate,.05);assert.equal(row.modelDelta.annualDividendYield,0);assert.equal(Math.sign(row.modelDelta.delta),row.identity!.side==='CE'?1:-1);}
 assert.strictEqual(store.premiums(now+1,{view:'ladder',modelDelta:true}).rows[0].modelDelta,modeled.rows[0].modelDelta,'bounded same-second computation cache');
 assert(store.premiums(now+5001,{view:'ladder',modelDelta:true}).rows.every(r=>r.modelDelta===null));
 assert(store.premiums(now+5001,{view:'ladder',modelDelta:true}).rows.some(r=>r.price!==null),'price remains independently live');
 const oldSpot=fixture();oldSpot.ingest(entries.filter(e=>e.role==='OPTION').map(e=>packet(e.token,{exchangeTimestamp:new Date(now+2500).toISOString()})),new Date(now+2500).toISOString());assert(oldSpot.premiums(now+2500,{view:'ladder',modelDelta:true}).rows.every(r=>r.modelDelta===null),'Spot skew >2s cannot create a model');
});
test('Model Delta rejects wrong identity, stale/future/partial packets, expiry and impossible premium',()=>{
 const entry=entries[2],spotEntry=entries[0],spot=packet(1),option=packet(entry.token);
 assert(deriveDashboardModelDelta(entry,option,at,spotEntry,spot,at,now));
 for(const patch of [{instrumentToken:999},{mode:'quote'},{exchangeTimestamp:null},{exchangeTimestamp:new Date(now+1).toISOString()},{lastPrice:1e9}])assert.equal(deriveDashboardModelDelta(entry,{...option,...patch} as any,at,spotEntry,spot,at,now),null);
 assert.equal(deriveDashboardModelDelta({...entry,expiry:'2026-10-15'},option,at,spotEntry,spot,at,now),null);
 assert.equal(deriveDashboardModelDelta(entry,option,at,{...spotEntry,symbol:'SENSEX'},spot,at,now),null);
 assert.equal(deriveDashboardModelDelta(entry,option,at,spotEntry,{...spot,isIndex:false},at,now),null);
});
test('model request flag is explicit, ladder-only and rejects malformed values',async()=>{
 const app=new Hono();mountDashboardLiveRoutes(app);
 for(const path of ['/dashboard-live/premiums?modelDelta=1','/dashboard-live/premiums?view=ladder&modelDelta=0','/dashboard-live/premiums?view=ladder&modelDelta=true'])assert.equal((await app.request(path)).status,400);
 assert.equal((await app.request('/dashboard-live/premiums?view=ladder&modelDelta=1')).status,200);
});
test('full PCR and walls require the complete exact-expiry inventory; zero OI is valid',()=>{
 const s=fixture(),a=s.snapshot(now).indices[0];assert.equal(a.fullPcr,1);assert.equal(a.ceTotal,200);assert.equal(a.peTotal,200);assert.deepEqual(a.callWall?.tiedStrikes,[22000,22100]);assert.equal(a.strike,22000);assert.equal(a.futuresBasis,10);
 s.ingest([packet(12,{oi:0})],at);assert.equal(s.snapshot(now).indices[0].fullPcr,.5);
 assert.equal(s.snapshot(now).indices[0].greeks.iv,null);
 const missing=new DashboardLiveStore({entries,missing:[],omittedExpiries:[],date});missing.ingest(entries.slice(0,-1).map(e=>packet(e.token)),at);assert.equal(missing.snapshot(now).indices[0].fullPcr,null);assert.equal(missing.snapshot(now).indices[0].callWall,null);
});
test('stale, missing source time, old session, out-of-order, invalid prices and partial modes fail closed',()=>{
 const s=fixture();assert.equal(s.snapshot(now+31000).indices[0].spot.price,null);assert.equal(s.snapshot(now+86400000).indices[0].fullPcr,null);
 s.ingest([packet(1,{exchangeTimestamp:'2026-10-16T04:29:59Z',lastPrice:1})],at);assert.equal(s.snapshot(now).indices[0].spot.price,22005);
 s.ingest([packet(1,{exchangeTimestamp:null,lastPrice:2}),packet(1,{mode:'quote',lastPrice:3}),packet(1,{exchangeTimestamp:'2026-10-15T04:30:00Z',lastPrice:4}),packet(1,{exchangeTimestamp:'2026-10-16T04:31:00Z',lastPrice:5})],at);assert.equal(s.snapshot(now).indices[0].spot.price,22005);
 s.ingest([packet(1,{lastPrice:0})],at);assert.equal(s.snapshot(now).indices[0].spot.price,null);
 s.ingest([packet(10,{oi:undefined})],at);assert.equal(s.snapshot(now).indices[0].fullPcr,null);
});
test('selection never substitutes a missing exact strike and independent expiry inventory remains explicit',()=>{
 const s=fixture();assert.equal(s.snapshot(now,{NIFTY:{expiry:'2026-10-01',strike:22000}}).indices[0].expiry,null);const a=s.snapshot(now,{NIFTY:{expiry,strike:99999}}).indices[0];assert.equal(a.strike,null);assert.equal(a.ce.price,null);assert.equal(a.pe.oi,null);
 assert.equal(s.snapshot(now,{NIFTY:{expiry,strike:22100}}).indices[0].ce.identity?.strike,22100);
});
function master(){let token=1;const rows:KiteInstrumentMasterRow[]=[];for(const [symbol,label,exchange] of [['NIFTY','NIFTY 50','NSE'],['SENSEX','SENSEX','BSE'],['BANKNIFTY','NIFTY BANK','NSE']]){rows.push({instrument_token:token++,tradingsymbol:label,exchange,segment:'INDICES'});rows.push({instrument_token:token++,tradingsymbol:symbol+'FUT',exchange,instrument_type:'FUT',name:symbol,expiry:'2026-10-27'});for(const exp of [expiry,'2026-10-26'])for(const side of ['CE','PE'])rows.push({instrument_token:token++,tradingsymbol:symbol+exp+side,exchange,name:symbol,expiry:exp,strike:22000,instrument_type:side});}rows.push({instrument_token:token++,tradingsymbol:'INDIA VIX',exchange:'NSE',segment:'INDICES'});return rows;}
test('capacity retains whole chains across indices, reports omitted expiries and rejects ambiguous identities',()=>{
 const rows=master(),inventory=buildDashboardLiveInventory(rows,date,[],13);assert.equal(inventory.entries.length,13);assert.equal(inventory.omittedExpiries.length,3);
 for(const s of LIVE_INDICES)assert.equal(inventory.entries.filter(e=>e.symbol===s&&e.role==='OPTION').length,2);
 const ambiguous=master();ambiguous.push({...ambiguous.find(r=>r.name==='NIFTY'&&r.instrument_type==='CE')!,instrument_token:9999});const other=buildDashboardLiveInventory(ambiguous,date,[]);assert(other.omittedExpiries.includes('NIFTY|'+expiry));
});
test('read routes validate selection and default runtime has no live numbers when disabled',async()=>{
 const app=new Hono();mountDashboardLiveRoutes(app);let r=await app.request('/dashboard-live');assert.equal(r.status,200);const body=await r.json();assert.equal(body.connectionState,'DISABLED');assert.equal(body.snapshot,null);assert.equal(body.createsOrders,false);
 for(const path of ['/dashboard-live?NIFTY_strike=NaN','/dashboard-live/stream?NIFTY_expiry=bad']){r=await app.request(path);assert.equal(r.status,400);}
});
test('display-only socket does not broadcast into existing Telegram/selector tick observers',()=>{
 let callback:any,seen=0,ingested=0;const unsubscribe=registerKiteTickObserver(()=>{seen++;});
 const socket:any={binaryType:'',readyState:1,send(){},close(){},addEventListener(type:string,fn:any){if(type==='message')callback=fn;}};
 const transport=new KiteWebSocketTransport({apiKey:'test',accessToken:'test',instrumentTokens:[257],broadcastObservers:false,socketFactory:()=>socket,onTicks:()=>{ingested++;}});
 transport.connect();const frame=new ArrayBuffer(14),v=new DataView(frame);v.setUint16(0,1);v.setUint16(2,8);v.setInt32(4,257);v.setInt32(8,10000);callback({data:frame});assert.equal(ingested,1);assert.equal(seen,0);transport.disconnect();unsubscribe();
});
test('SSE sends a real snapshot envelope and respects stream cancellation',async()=>{
 const app=new Hono();const sample:any={connectionState:'DISABLED',snapshot:null,createsOrders:false};mountDashboardLiveRoutes(app,()=>sample);
 const controller=new AbortController();const response=await app.request('/dashboard-live/stream',{signal:controller.signal});assert.equal(response.status,200);assert(response.headers.get('Content-Type')?.includes('text/event-stream'));const reader=response.body!.getReader();const value=await reader.read();const text=new TextDecoder().decode(value.value);assert(text.includes('event: snapshot'));assert(text.includes('"connectionState":"DISABLED"'));controller.abort();await reader.cancel();
});
test('same-second packets retain real millisecond receipt times without inventing exchange precision',()=>{
 const store=fixture(),before=store.revision(),received='2026-10-16T04:30:00.125Z';store.ingest([packet(1,{lastPrice:22006})],received);const a=store.snapshot(now+125).indices[0];assert(store.revision()>before);assert.equal(a.spot.price,22006);assert.equal(a.spot.observedAt,at);assert.equal(a.spot.receivedAt,received);
});
test('SSE publishes changed revisions without waiting for its idle heartbeat',async()=>{
 const app=new Hono();let version=1,reads=0;mountDashboardLiveRoutes(app,()=>({connectionState:'OPEN',snapshot:{sequence:version},reads:++reads}) as any,()=>String(version));
 const controller=new AbortController(),response=await app.request('/dashboard-live/stream',{signal:controller.signal}),reader=response.body!.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert(first.includes('"sequence":1'));version=2;const next=new TextDecoder().decode((await reader.read()).value);assert(next.includes('"sequence":2'));assert.equal(reads,2);controller.abort();await reader.cancel();
});
test('band ATM reader reuses the exact existing spot cache and cannot refresh a stale quote',()=>{
 const store=fixture(),before=store.revision();assert.deepEqual(store.spotQuote('NIFTY',now),store.snapshot(now).indices[0].spot);assert.equal(store.revision(),before);
 assert.equal(store.spotQuote('NIFTY',now+31000).price,null);assert.equal(store.spotQuote('SENSEX',now).price,null);assert.equal(store.revision(),before);
});

test('one ATM CE/PE pair per actual listed expiry; never treat expiry dates as numbered DTE rows',()=>{
 const other='2026-10-26';
 const extra:LiveEntry[]=[21900,22100].flatMap((strike,i)=>[
  {token:200+i, label:'NIFTY'+other+strike+'CE',symbol:'NIFTY' as const,role:'OPTION' as const,expiry:other,strike,side:'CE' as const},
  {token:210+i, label:'NIFTY'+other+strike+'PE',symbol:'NIFTY' as const,role:'OPTION' as const,expiry:other,strike,side:'PE' as const}
 ]);
 const all=[...entries,...extra],store=new DashboardLiveStore({entries:all,missing:[],omittedExpiries:[],date});
 store.ingest(all.map(e=>packet(e.token)),at);
 const view=store.snapshot(now,{NIFTY:{expiry:other,strike:22100}});
 const ladder=view.atmExpiryLadder.find(g=>g.symbol==='NIFTY')!;
 assert.deepEqual(ladder.rows.map(r=>r.expiry),[expiry,other]);
 assert.deepEqual(ladder.rows.map(r=>r.strike),[22000,22100]);
 assert(ladder.rows.every(r=>r.ce?.identity?.expiry===r.expiry&&r.pe?.identity?.expiry===r.expiry));
 assert(ladder.rows.every(r=>r.ce?.identity?.strike===r.strike&&r.pe?.identity?.strike===r.strike));
 assert(ladder.rows.every(r=>r.ce?.price===100&&r.pe?.price===100));
 assert(ladder.rows.every(r=>!('dte' in r)),'display identity is exact expiry, not a guessed weekly DTE');
 assert.equal(view.indices[0].expiry,other,'selected single-expiry chart remains separate');
 const old=store.snapshot(now+31000).atmExpiryLadder[0].rows;
 assert(old.every(r=>r.strike===null&&r.ce===null&&r.pe===null),'stale spot cannot select an ATM strike');
});
test('no invented opposite premium or ATM strike without an exact same-expiry paired strike',()=>{
 const solo:LiveEntry={token:250,label:'CE unmatched',symbol:'NIFTY',role:'OPTION',expiry:'2026-11-02',side:'CE',strike:22200};
 const store=new DashboardLiveStore({entries:[...entries,solo],missing:[],omittedExpiries:[],date});
 store.ingest([...entries,solo].map(e=>packet(e.token)),at);
 const row=store.snapshot(now).atmExpiryLadder[0].rows.find(r=>r.expiry===solo.expiry)!;
 assert.equal(row.strike,null);assert.equal(row.ce,null);assert.equal(row.pe,null);
});
