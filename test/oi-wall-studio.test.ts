import {renderMarketBookLiveContext} from '../market-book-reading-guide.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {measurePcrSnapshot} from '../dashboard-pcr-sampler.js';
import {deriveOiStudioSnapshot,installOiWallStudio,OI_WALL_STUDIO_HTML,OI_WALL_STUDIO_CSS} from '../oi-wall-studio.js';
import {DashboardLiveStore} from '../dashboard-live-feed.js';
import {Hono} from 'hono';
import {mountDashboardLiveRoutes} from '../dashboard-live-http.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
const date='2026-10-16',expiry='2026-10-19',base=Date.parse(date+'T04:00:00Z');
const iso=(at:number)=>new Date(at).toISOString();
export function fixture(minute=0,bump=0){
 const now=base+minute*60000;
 const indices=['NIFTY','SENSEX','BANKNIFTY'].map((symbol,ix)=>{
  const center=[24000,79000,56000][ix],entries=Array.from({length:15},(_,i)=>['CE','PE'].map((side,j)=>({token:ix*1000+i*2+j+1,exchange:'NFO',label:symbol+i+side,role:'OPTION' as const,symbol:symbol as any,expiry,strike:center+(i-7)*50,side:side as 'CE'|'PE'}))).flat();
  const quotes=Object.fromEntries(entries.map(e=>[e.exchange+':'+e.label,{instrument_token:e.token,oi:(e.side==='CE'?100:140)+e.strike%17+bump,last_price:80+minute+(e.side==='CE'?bump:-bump),last_trade_time:iso(now),timestamp:iso(now)}]));
  const spot={identity:{role:'SPOT',symbol},price:center,state:'LIVE',observedAt:iso(now),receivedAt:iso(now)};
  const quote=(side:string,strike=center)=>{const entry=entries.find(e=>e.side===side&&e.strike===strike)!;return {identity:entry,price:quotes[entry.exchange+':'+entry.label].last_price,oi:quotes[entry.exchange+':'+entry.label].oi,state:'LIVE',observedAt:iso(now),receivedAt:iso(now)};};
  return {symbol,expiry,expiries:[expiry,'2026-10-26'],strikes:[...new Set(entries.map(e=>e.strike))],strike:center,ceStrike:center,peStrike:center,spot,studioCE:quote('CE'),studioPE:quote('PE'),oiQuotes:entries.map(e=>quote(e.side,e.strike)),pcrSnapshot:measurePcrSnapshot(entries,quotes,date,now,now,spot)};
 });return {connected:true,connectionState:'OPEN',source:'KITE_WEBSOCKET_FULL',serverTime:iso(now),snapshot:{asOf:iso(now),runtimeId:'runtime',tradeDate:date,indices}};
}

test('full-chain Max Pain sweep equals brute force and keeps ties, zero PE and exact scope',()=>{
 for(let i=0;i<6;i++){
  const p=fixture(i,i*3),s=deriveOiStudioSnapshot(p,'NIFTY')!;assert(s);const payouts=s.rows.map(r=>({strike:r.strike,value:s.rows.reduce((sum,q)=>sum+q.CE.oi*Math.max(r.strike-q.strike,0)+q.PE.oi*Math.max(q.strike-r.strike,0),0)}));const min=Math.min(...payouts.map(r=>r.value));assert.deepEqual(s.mp,payouts.filter(r=>r.value===min).map(r=>r.strike));assert.equal(s.rows.length,15);assert.equal(s.pcr,s.pe/s.ce);
 }
 const p=fixture(),a=p.snapshot.indices[0];for(const r of a.pcrSnapshot.strikeRows)if(r.side==='PE')r.oi=0;a.pcrSnapshot.peTotal=0;a.pcrSnapshot.fullPcr=0;const s=deriveOiStudioSnapshot(p,'NIFTY')!;assert(s);assert.equal(s.pcr,0);assert(s.mp.includes(s.rows[0].strike));
});
test('rejects mixed identities, duplicate tokens, partial/stale/full totals, disconnected and replay masquerading as live',()=>{
 for(const mutate of [
  (p:any)=>p.connected=false,(p:any)=>p.source='RECORDED',(p:any)=>p.snapshot.asOf=iso(base-5000),(p:any)=>p.snapshot.tradeDate='2026-10-15',
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.strikeRows.pop(),
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.strikeRows[0].symbol='SENSEX',
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.strikeRows[0].expiry='2026-10-26',
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.strikeRows[0].sourceAt=iso(base-31000),
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.strikeRows[0].oi=-1,
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.strikeRows[0].token=p.snapshot.indices[0].pcrSnapshot.strikeRows[1].token,
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.ceTotal++,
  (p:any)=>p.snapshot.indices[0].pcrSnapshot.fullPcr=2,
  (p:any)=>p.serverTime=iso(base+91000),
 ]){const p=fixture();mutate(p);assert.equal(deriveOiStudioSnapshot(p,'NIFTY'),null);}
 const p=fixture();p.snapshot.indices[0].spot.state='STALE';const s=deriveOiStudioSnapshot(p,'NIFTY')!;assert(s);assert.equal(s.spot,null);assert.equal(s.anchor,null);assert(s.mp.length);
});
test('sampler exposes only qualified exact contract rows and separately qualifies option trade-price age',()=>{
 const p=fixture(),q=p.snapshot.indices[0].pcrSnapshot;assert.equal(q.strikeRows.length,q.coverage.expected);assert(q.strikeRows.every(r=>r.priceAt===p.serverTime));
 const entries:any[]=[{token:1,exchange:'NFO',label:'CE',role:'OPTION',symbol:'NIFTY',expiry,strike:24000,side:'CE'},{token:2,exchange:'NFO',label:'PE',role:'OPTION',symbol:'NIFTY',expiry,strike:24000,side:'PE'}];
 const quotes={'NFO:CE':{instrument_token:1,oi:100,timestamp:iso(base),last_price:90,last_trade_time:iso(base-31000)},'NFO:PE':{instrument_token:2,oi:100,timestamp:iso(base),last_price:90}};
 const result=measurePcrSnapshot(entries,quotes,date,base);assert.equal(result.state,'COMPLETE');assert(result.strikeRows.every(r=>r.price===null));delete (quotes as any)['NFO:PE'];assert.deepEqual(measurePcrSnapshot(entries,quotes,date,base).strikeRows,[]);
});
class Node {value='';writes=0;private html='';get innerHTML(){return this.html;}set innerHTML(value:string){this.writes++;this.html=value;}textContent='';hidden=false;onclick:any;onchange:any;nodes:any[]=[];setAttribute(){}querySelectorAll(){return this.nodes;}}
function harness(){
 const nodes=new Map<string,Node>();for(const m of OI_WALL_STUDIO_HTML.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],new Node());
 const events:any[]=[];let now=base,fn:any;const timers=new Map<number,any>();let id=0;
 class Clock extends Date{static now(){return now;}}
 const ctx:any={__name:(f:any)=>f,document:{getElementById:(id:string)=>nodes.get(id)},window:{dispatchEvent:(e:any)=>events.push(e)},CustomEvent:class{type:any;detail:any;constructor(type:any,data:any){this.type=type;this.detail=data.detail;}},Date:Clock,setTimeout:(f:any)=>{timers.set(++id,f);return id;},clearTimeout:(i:number)=>timers.delete(i),fetch:async()=>{throw Error('Network not mocked');},AbortSignal};
 vm.createContext(ctx);ctx.renderMarketBookLiveContext=renderMarketBookLiveContext;ctx.deriveOiStudioSnapshot=deriveOiStudioSnapshot;vm.runInContext('const install='+installOiWallStudio.toString()+';var studio=install();',ctx);const studio=ctx.studio;studio.setPage(5);
 const click=(id:string,key:string,value:string)=>nodes.get('ows-'+id)!.onclick({target:{closest:()=>({dataset:{[key]:value}})}});
 return {nodes,events,ctx,studio,click,setNow:(n:number)=>now=n,timers};
}
test('all index/expiry/independent strikes, five windows, three chart views and research tabs work without a second stream',async()=>{
 const h=harness();h.studio.update(fixture());
 assert(h.nodes.get('ows-chart')!.innerHTML.includes('ows-ladder'));
 for(const index of ['SENSEX','BANKNIFTY','NIFTY']){h.nodes.get('ows-index')!.value=index;h.nodes.get('ows-index')!.onchange();assert(h.nodes.get('ows-source')!.innerHTML.includes(index));}
 for(const window of ['1','3','6','15','30']){h.click('windows','owsWindow',window);assert(h.nodes.get('ows-research-result')!.innerHTML.includes('Collecting '+window+'m history'));}
 for(const view of ['columns','wheel','ladder']){h.click('view-tabs','owsView',view);assert(h.nodes.get('ows-chart')!.innerHTML.includes('ows-'+(view==='wheel'?'wheel-row':view)));}
 h.nodes.get('ows-ce')!.value='24050';h.nodes.get('ows-ce')!.onchange();assert.equal(h.events.at(-1).detail.ceStrike,24050);assert.equal(h.events.at(-1).type,'optionpilot:live-selection');
 h.nodes.get('ows-pe')!.value='23950';h.nodes.get('ows-pe')!.onchange();assert.equal(h.events.at(-1).detail.peStrike,23950);
 h.nodes.get('ows-expiry')!.value='2026-10-26';h.nodes.get('ows-expiry')!.onchange();assert.equal(h.events.at(-1).detail.expiry,'2026-10-26');
 h.click('research-tabs','owsResearch','outcome');assert(h.nodes.get('ows-research-result')!.innerHTML.includes('RECORDED'));assert(h.nodes.get('ows-research-result')!.innerHTML.includes('Load recorded'));
 h.nodes.get('ows-index')!.value='BANKNIFTY';h.nodes.get('ows-index')!.onchange();h.click('research-tabs','owsResearch','candidate');assert(h.nodes.get('ows-research-result')!.innerHTML.includes('MONTHLY OBSERVATION ONLY'));
 h.studio.setPage(2);assert.equal(h.nodes.get('oi-wall-studio')!.hidden,true);
});
test('real OI change blinks affected strikes for 1.8s; duplicate packets and view/window switches do not restart it',()=>{
 const h=harness();h.studio.update(fixture());h.setNow(base+60000);h.studio.update(fixture(1,5));const chart=h.nodes.get('ows-chart')!;assert(chart.innerHTML.includes('ows-blink'));assert(chart.innerHTML.includes('ADDING'));
 h.setNow(base+61000);h.studio.update(fixture(1,5));assert(chart.innerHTML.includes('animation-delay:-1000ms'));h.click('view-tabs','owsView','wheel');h.click('view-tabs','owsView','ladder');assert(chart.innerHTML.includes('animation-delay:-1000ms'));
 h.setNow(base+62000);h.studio.update(fixture(1,5));assert(!chart.innerHTML.includes('ows-blink'));h.click('windows','owsWindow','1');assert(h.nodes.get('ows-research-result')!.innerHTML.includes('09:30:00'));
 h.studio.update(null);assert(!chart.innerHTML.includes('ows-ladder'));assert(!h.nodes.get('ows-premiums')!.innerHTML.includes('₹86'));assert(OI_WALL_STUDIO_CSS.includes('prefers-reduced-motion'));
});
test('all five lookbacks use exact same-contract endpoints; gaps and changed inventory do not interpolate',()=>{
 const h=harness();for(let i=0;i<=30;i++){h.setNow(base+i*60000);h.studio.update(fixture(i,i));}
 for(const w of ['1','3','6','15','30']){h.click('windows','owsWindow',w);assert(!h.nodes.get('ows-research-result')!.innerHTML.includes('Collecting'));}
 const g=harness();g.studio.update(fixture());g.studio.update(fixture(2));g.click('windows','owsWindow','1');assert(g.nodes.get('ows-research-result')!.innerHTML.includes('Collecting 1m'));
});
test('After event uses existing recorded exact identity and real response values; candidate is read-only canonical, never research-generated',async()=>{
 const h=harness();h.studio.update(fixture());h.studio.recorded({NIFTY:{expiry,positioning:{timeline:[{minute_bucket:iso(base),previousAt:iso(base-60000),side:'CALL',responseStrike:24000,responses:[1,3,6,15,30].map(minutes=>({minutes,sides:[{percent:minutes,state:'Recorded exact endpoints'},{percent:-minutes,state:'Recorded exact endpoints'}]}))}]}}},date);
 h.click('research-tabs','owsResearch','outcome');assert(h.nodes.get('ows-research-result')!.innerHTML.includes('30%'));assert(h.nodes.get('ows-research-result')!.innerHTML.includes('RECORDED'));
 h.ctx.fetch=async()=>({ok:true,json:async()=>({symbol:'NIFTY',version:'BUSINESS_DASHBOARD_V1',readOnly:true,selector:{reasonCodes:['DIRECTION_PENDING']},decisionCard:{state:'WAIT',authority:'NONE',identityLocked:false}})});
 h.click('research-tabs','owsResearch','candidate');await new Promise(r=>setImmediate(r));assert(h.nodes.get('ows-research-result')!.innerHTML.includes('DIRECTION_PENDING'));assert(h.nodes.get('ows-research-result')!.innerHTML.includes('WAIT · canonical'));
});
test('new per-side selection validates at HTTP boundary; old shared strike contract remains unchanged',async()=>{
 const app=new Hono();let selected:any;mountDashboardLiveRoutes(app,((s:any)=>{selected=s;return {ok:true};}) as any);
 assert.equal((await app.request('/dashboard-live?NIFTY_ceStrike=24050&NIFTY_peStrike=23950')).status,200);assert.deepEqual(selected.NIFTY,{ceStrike:24050,peStrike:23950});
 for(const query of ['NIFTY_ceStrike=-1','NIFTY_peStrike=Infinity','NIFTY_ceStrike=abc'])assert.equal((await app.request('/dashboard-live?'+query)).status,400);
 const p=fixture(),a=p.snapshot.indices[0],entries:any[]=a.oiQuotes.map(q=>q.identity);entries.push({token:999,role:'SPOT',symbol:'NIFTY',label:'NIFTY 50'});
 const store=new DashboardLiveStore({date,entries,missing:[],omittedExpiries:[]});
 const s=store.snapshot(base,{NIFTY:{expiry,strike:24000,ceStrike:24050,peStrike:23950}}).indices[0];assert.equal(s.ce.identity?.strike,24000);assert.equal(s.pe.identity?.strike,24000);assert.equal(s.studioCE.identity?.strike,24050);assert.equal(s.studioPE.identity?.strike,23950);
});
test('actual dashboard serializes the full component with no undefined browser dependencies',()=>{
 const html=renderBusinessDashboardV1Html({} as any);assert(html.includes('id="oi-wall-studio"'));for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);assert(html.includes('data-ows-research="evidence"'));assert(html.includes('data-ows-view="wheel"'));
});
test('mutated same-cycle chain and reversed server clocks revoke studio values instead of repainting another history',()=>{
 const h=harness();h.studio.update(fixture());const p=fixture(0,5);h.studio.update(p);assert(!h.nodes.get('ows-chart')!.innerHTML.includes('ows-ladder'));
 const g=harness();g.studio.update(fixture(2));g.studio.update(fixture(1));assert(!g.nodes.get('ows-chart')!.innerHTML.includes('ows-ladder'));
});
test('source heartbeats preserve the After event DOM so an open event can be read without closing',()=>{
 const h=harness();h.studio.update(fixture());h.studio.recorded({NIFTY:{expiry,expiries:[expiry],positioning:{timeline:[{minute_bucket:iso(base),responseStrike:24000,side:'CALL',responses:[]}]}}},date);h.click('research-tabs','owsResearch','outcome');
 const node=h.nodes.get('ows-research-result')!,writes=node.writes;node.innerHTML=node.innerHTML.replace('<details','<details open');const editedWrites=node.writes;
 h.studio.update(fixture());h.studio.recorded({NIFTY:{expiry,expiries:[expiry],positioning:{timeline:[{minute_bucket:iso(base),responseStrike:24000,side:'CALL',responses:[]}]}}},date);
 assert.equal(node.writes,editedWrites);assert(node.innerHTML.includes('<details open'));assert(editedWrites>writes);
});
test('disconnected live entry exposes saved-record recovery instead of a screen of blank premium cards',()=>{
 const h=harness();assert.equal(h.nodes.get('ows-live-empty')!.hidden,false);assert.match(OI_WALL_STUDIO_HTML,/Open saved records/);
 assert(!OI_WALL_STUDIO_CSS.includes('[data-live-empty="true"] #ows-live-workspace{display:none!important}'));assert(OI_WALL_STUDIO_CSS.includes(':not(#ows-wheel-tabs)'));assert(OI_WALL_STUDIO_CSS.includes(':not(#ows-chart)'));
 h.studio.update(fixture());assert.equal(h.nodes.get('ows-live-empty')!.hidden,true);
 h.studio.update({...fixture(),connected:false,connectionState:'MARKET_CLOSED'});assert.equal(h.nodes.get('ows-live-empty')!.hidden,false);
 h.nodes.get('ows-live-workspace')!.hidden=true;h.studio.recorded({},date);assert.equal(h.nodes.get('ows-live-empty')!.hidden,true,'recorded mode has no live warning');
});

test('wheel switches independent quote breadth even when complete option OI is unavailable',()=>{
 const h=harness(),p:any=fixture();p.snapshot.participation=[{identity:{role:'STOCK',label:'HDFC'},price:100,changePct:1,state:'LIVE',observedAt:p.serverTime,receivedAt:p.serverTime},{identity:{role:'SECTOR',label:'BANK'},price:100,changePct:-2,state:'LIVE',observedAt:p.serverTime,receivedAt:p.serverTime}];
 p.snapshot.indices[0].pcrSnapshot=null;h.studio.update(p);h.click('view-tabs','owsView','wheel');h.click('wheel-tabs','owsWheel','stocks');
 const chart=h.nodes.get('ows-chart')!;assert(chart.innerHTML.includes('mb-breadth-wheel'));assert(chart.innerHTML.includes('HDFC'));assert(!chart.innerHTML.includes('Sector quotes'));
 h.click('wheel-tabs','owsWheel','sectors');assert(chart.innerHTML.includes('BANK'));assert(!chart.innerHTML.includes('Heavyweight quote subset'));
 h.studio.update(null);assert(!chart.innerHTML.includes('mb-breadth-wheel'));assert(!chart.innerHTML.includes('-2%'));
});

test('participation wheel interval uses exact token endpoints, not day %; disconnect, identity and elapsed delivery revoke it',()=>{
 const h=harness();const make=(minute:number,price:number,token=99)=>{const p:any=fixture(minute);p.snapshot.participation=[{identity:{role:'STOCK',token,label:'HDFC'},price,changePct:-8,state:'LIVE',observedAt:p.serverTime,receivedAt:p.serverTime}];return p;};
 h.studio.update(make(0,100));h.click('view-tabs','owsView','wheel');h.click('wheel-tabs','owsWheel','stocks');h.nodes.get('ows-participation-window')!.value='1';h.nodes.get('ows-participation-window')!.onchange();
 assert(h.nodes.get('ows-chart')!.innerHTML.includes('Building 1m history'));
 h.setNow(base+60000);h.studio.update(make(1,110));let html=h.nodes.get('ows-chart')!.innerHTML;assert(html.includes('+10%'));assert(html.includes('100%'));assert(!html.includes('-8%'));
 h.setNow(base+64001);h.nodes.get('ows-participation-window')!.onchange();assert(!h.nodes.get('ows-chart')!.innerHTML.includes('+10%'));
 h.setNow(base+120000);h.studio.update(make(2,120,100));assert(h.nodes.get('ows-chart')!.innerHTML.includes('Building 1m history'));
 h.studio.update(null);assert(!h.nodes.get('ows-chart')!.innerHTML.includes('mb-breadth-wheel'));
});

test('all participation intervals preserve their own source endpoints and clear on runtime changes',()=>{
 for(const minutes of [1,3,6,15,30]){
  const h=harness();const sample=(minute:number,price:number,runtime='runtime')=>{const p:any=fixture(minute);p.snapshot.runtimeId=runtime;p.snapshot.participation=[{identity:{role:'SECTOR',token:555,label:'BANK'},price,changePct:99,state:'LIVE',observedAt:p.serverTime,receivedAt:p.serverTime}];return p;};
  h.studio.update(sample(0,200));h.setNow(base+minutes*60000);h.studio.update(sample(minutes,220));h.click('view-tabs','owsView','wheel');h.click('wheel-tabs','owsWheel','sectors');
  h.nodes.get('ows-participation-window')!.value=String(minutes);h.nodes.get('ows-participation-window')!.onchange();let html=h.nodes.get('ows-chart')!.innerHTML;
  assert(html.includes('+10%'),minutes+'m uses the exact earlier price, not day change');assert(html.includes('09:30:00 IST →'));assert(!html.includes('+99%'));
  h.studio.update(sample(minutes,220,'new-runtime'));html=h.nodes.get('ows-chart')!.innerHTML;assert(html.includes('Building '+minutes+'m history'));assert(!html.includes('+10%'));
 }
});
