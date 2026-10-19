import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import { installDashboardLive,DASHBOARD_LIVE_HTML } from '../dashboard-live-view.js';
import { DashboardLiveStore,type LiveEntry } from '../dashboard-live-feed.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';
function harness(){
 const nodes=new Map<string,any>();for(const m of DASHBOARD_LIVE_HTML.matchAll(/id="([^"]+)"/g))nodes.set(m[1],{innerHTML:'',textContent:'',hidden:false,setAttribute(){},contains(){return true;},querySelector(){return null;}});
 const streams:any[]=[],timers:any[]=[],docEvents:any={},winEvents:any={},contextEvents:any[]=[];let now=Date.parse('2026-10-16T04:30:00Z');
 class Clock extends Date{static now(){return now;}}
 class Stream{closed=false;handlers:any={};constructor(public url:string){streams.push(this);}close(){this.closed=true;}addEventListener(type:string,fn:any){this.handlers[type]=fn;}}
 const document:any={hidden:false,activeElement:null,getElementById:(id:string)=>nodes.get(id),addEventListener:(type:string,fn:any)=>docEvents[type]=fn};
 const ctx:any={document,window:{addEventListener:(type:string,fn:any)=>winEvents[type]=fn,dispatchEvent:(event:any)=>{contextEvents.push(event);return true;}},CustomEvent:class{type:string;detail:any;constructor(type:string,init:any){this.type=type;this.detail=init.detail;}},EventSource:Stream,URLSearchParams,Date:Clock,Map,Set,Number,String,Array,Object,Math,setInterval:(fn:any)=>timers.push(fn)};
 vm.createContext(ctx);const scripts=[...renderBusinessDashboardV1Html({} as any).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);vm.runInContext(scripts[0],ctx);vm.runInContext(scripts.at(-1)!,ctx);
 const entries:LiveEntry[]=[{token:1,role:'SPOT',symbol:'NIFTY',label:'NIFTY 50'},...['CE','PE'].map((side,i)=>({token:2+i,role:'OPTION' as const,symbol:'NIFTY' as const,label:side,side:side as 'CE'|'PE',expiry:'2026-10-19',strike:22000}))];
 const store=new DashboardLiveStore({entries,date:'2026-10-16',missing:[],omittedExpiries:[]});
 const tick=(price=22001)=>{store.ingest(entries.map(e=>({instrumentToken:e.token,lastPrice:e.role==='SPOT'?price:100,exchangeTimestamp:new Date(now).toISOString(),oi:100,mode:'full' as const,isIndex:e.role==='SPOT'})),new Date(now).toISOString());};
 const emit=(patch?:(snapshot:any)=>void)=>{const before=streams.length;const fire=()=>{const snapshot=store.snapshot(now);patch?.(snapshot);streams.at(-1).handlers.snapshot({data:JSON.stringify({connected:true,connectionState:'OPEN',serverTime:new Date(now).toISOString(),snapshot})});};fire();if(streams.length>before)fire();};
 return {nodes,streams,timers,docEvents,winEvents,contextEvents,document,store,tick,emit,advance:(ms:number)=>now+=ms};
}
test('real streamed values change the numbers and chart; selection clears old identity and reconnects exactly once',()=>{
 const h=harness();assert.equal(h.streams.length,1);assert(h.streams[0].url.startsWith('/api/research/dashboard-live/stream?'));
 h.tick();h.emit();let content=h.nodes.get('op-live-indices').innerHTML;assert(content.includes('22,001'));assert(content.includes('FULL PCR'));assert(content.includes('NIFTY SPOT · ₹ / points live chart'));
 h.advance(1000);h.tick(22010);h.emit();content=h.nodes.get('op-live-indices').innerHTML;assert(content.includes('22,010'));assert(content.includes('<line x1='));
 h.nodes.get('op-live-indices').onchange({target:{dataset:{liveIndex:'NIFTY',liveField:'strike'},value:'22000'}});assert.equal(h.streams.length,3);assert(h.streams[1].closed);assert(h.streams[2].url.includes('NIFTY_strike=22000'));assert(!h.nodes.get('op-live-indices').innerHTML.includes('22,010'));
 h.streams[0].handlers.snapshot({data:JSON.stringify({connectionState:'OPEN',snapshot:h.store.snapshot(Date.now())})});assert(!h.nodes.get('op-live-indices').innerHTML.includes('22,010'));
});
test('disconnects, silent stalled stream, hidden/mobile resume and restart never present old prices as live',()=>{
 const h=harness();h.tick();h.emit();h.advance(5000);h.timers[0]();assert(!h.nodes.get('op-live-indices').innerHTML.includes('22,001'));
 h.tick();h.emit();h.streams.at(-1).onerror();assert(h.nodes.get('op-live-status').textContent.includes('Disconnected'));assert(!h.nodes.get('op-live-indices').innerHTML.includes('22,001'));
 const beforeResume=h.streams.length;h.document.hidden=true;h.docEvents.visibilitychange();assert(h.streams.at(-1).closed);h.document.hidden=false;h.docEvents.visibilitychange();assert.equal(h.streams.length,beforeResume+1);
 h.tick();h.emit();h.winEvents.pagehide();assert(h.streams.at(-1).closed);h.winEvents.pageshow();assert.equal(h.streams.length,beforeResume+2);
});
test('disabled feed is explicit and IV/Greeks are never fabricated; original script order stays intact',()=>{
 const h=harness();h.streams[0].handlers.snapshot({data:JSON.stringify({connectionState:'DISABLED',snapshot:null})});assert(h.nodes.get('op-live-status').textContent.includes('DISABLED'));
 const html=renderBusinessDashboardV1Html({} as any),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);assert(scripts[0].includes('installMarketBook'));assert(scripts[1].includes('function load('));assert(scripts.at(-1)!.includes('dashboard-live/stream'));assert.equal((html.match(/id="dashboard-live"/g)||[]).length,1);
});
test('a silently stalled open stream reconnects once and ignores superseded packets',()=>{
 const h=harness();h.tick();h.emit();const old=h.streams.at(-1),count=h.streams.length;
 h.advance(5000);h.timers[0]();
 assert(old.closed,'stalled connection must be closed, not just blanked');
 assert.equal(h.contextEvents.filter((e:any)=>e.type==='optionpilot:live-context').at(-1).detail,null,'every shared chapter must lose stale context');
 assert.equal(h.streams.length,count+1,'reuse one replacement stream');
 h.timers[0]();assert.equal(h.streams.length,count+1,'no reconnect storm while waiting');
 const snapshot=h.store.snapshot(Date.now());
 old.handlers.snapshot({data:JSON.stringify({connected:true,connectionState:'OPEN',snapshot})});
 assert(!h.nodes.get('op-live-indices').innerHTML.includes('22,001'));
 h.tick(22025);h.emit();assert(h.nodes.get('op-live-indices').innerHTML.includes('22,025'));
});
test('two updates inside one source second show real receipt milliseconds and advance the chart',()=>{
 const h=harness();h.tick();h.emit();h.advance(125);
 h.store.ingest([{instrumentToken:1,lastPrice:22007,exchangeTimestamp:'2026-10-16T04:30:00.000Z',mode:'full',isIndex:true}],'2026-10-16T04:30:00.125Z');h.emit();const html=h.nodes.get('op-live-indices').innerHTML;assert(html.includes('22,007'));assert(html.includes('received 10:00:00.125'));assert(html.includes('Chart time = backend receipt'));assert(html.includes('10:00:00.125'));
});

test('one existing live stream shares context with all chapters and clears it on pause/disconnect',()=>{
 const h=harness();h.tick();h.emit();assert.equal(h.contextEvents.at(-1).type,'optionpilot:live-context');assert.equal(h.contextEvents.at(-1).detail.connected,true);const count=h.streams.length;h.nodes.get('op-live-toggle').onclick();assert.equal(h.contextEvents.at(-1).detail,null);assert.equal(h.streams.length,count);
});

test('PCR cadence is independent per index, samples only complete snapshots and does not create another stream',()=>{
 const h=harness();let value=1.5;
 const patch=(s:any)=>{for(const a of s.indices){if(!a.expiry)a.expiry='2026-10-19';a.pcrSnapshot={state:'COMPLETE',fullPcr:value,checkedAt:s.asOf,sourceMinAt:s.asOf,sourceMaxAt:s.asOf,coverage:{complete:true,expected:2,freshOi:2}};}};
 const valueOf=(symbol:string)=>h.nodes.get('op-live-indices').innerHTML.split('<h3>'+symbol)[1].match(/FULL PCR[^<]*<strong>([^<]*)/)[1];
 h.tick();h.emit(patch);const count=h.streams.length;assert.equal(valueOf('NIFTY'),'1.5');
 h.nodes.get('op-live-indices').onchange({target:{dataset:{liveIndex:'NIFTY',liveField:'cadence'},value:'180000'}});
 h.advance(60000);h.tick();value=2;h.emit(patch);assert.equal(valueOf('NIFTY'),'1.5');assert.equal(valueOf('SENSEX'),'2');assert.equal(h.streams.length,count);
 h.advance(120000);h.tick();value=3;h.emit(patch);assert.equal(valueOf('NIFTY'),'3');
 h.emit(s=>{patch(s);s.indices[0].pcrSnapshot.coverage.complete=false;});assert.equal(valueOf('NIFTY'),'—');
 h.nodes.get('op-live-indices').onchange({target:{dataset:{liveIndex:'NIFTY',liveField:'cadence'},value:'0'}});assert.equal(h.streams.length,count);
});
test('15m and FIB overlay exact recorded identities only, with independent per-index switches',()=>{
 const h=harness();h.tick();h.emit();const count=h.streams.length;assert(h.nodes.get('op-live-indices').innerHTML.includes('data-live-reference="spotFib"'));assert(h.nodes.get('op-live-indices').innerHTML.includes('data-live-reference="pcrOpening"'));
 const ref={pivot:{P:22000,R1:22100,at:'2026-10-15T10:00:00Z'},opening:{complete:true,high:22050,low:21900,fromAt:'2026-10-16T03:45:00Z',at:'2026-10-16T04:00:00Z'}};
 h.winEvents['optionpilot:recorded-levels']({detail:{date:'2026-10-16',indices:{NIFTY:{spot:ref,ce:{...ref,expiry:'WRONG',strike:22000,type:'CE'}}}}});
 const click=(key:string)=>h.nodes.get('op-live-indices').onclick({target:{closest:(selector:string)=>selector==='[data-live-reference]'?{dataset:{liveIndex:'NIFTY',liveReference:key}}:null}});
 click('spotFib');click('spotOpening');let html=h.nodes.get('op-live-indices').innerHTML;assert(html.includes('Fib P 22,000'));assert(html.includes('15m H 22,050'));assert(!html.split('<h3>SENSEX')[1].split('</article>')[0].includes('Fib P 22,000'));
 h.nodes.get('op-live-indices').onclick({target:{closest:(selector:string)=>selector==='[data-live-layer]'?{dataset:{liveIndex:'NIFTY',liveLayer:'ce'}}:null}});click('ceFib');html=h.nodes.get('op-live-indices').innerHTML;assert(html.includes('FIB unavailable; load exact previous session'));
 h.winEvents['optionpilot:recorded-levels']({detail:{date:'2026-10-15',indices:{NIFTY:{spot:ref}}}});assert(!h.nodes.get('op-live-indices').innerHTML.includes('Fib P 22,000'));assert.equal(h.streams.length,count);
});

test('streaming patches values without replacing dropdowns; chart cadence retains all receipt observations',()=>{
 const h=harness(),root=h.nodes.get('dashboard-live'),parent=h.nodes.get('op-live-indices'),fragments=new Map<string,any>();let mounted=false,parentWrites=0,parentHtml='';
 Object.defineProperty(parent,'innerHTML',{get:()=>parentHtml,set:(html:string)=>{parentHtml=html;parentWrites++;mounted=html.includes('data-live-card=');}});
 root.querySelector=(selector:string)=>{
  if(selector.startsWith('[data-live-card='))return mounted?{}:null;
  if(!mounted)return null;
  if(!fragments.has(selector)){let html='';const node:any={writes:0};Object.defineProperty(node,'innerHTML',{get:()=>html,set:(next:string)=>{html=next;node.writes++;}});fragments.set(selector,node);}return fragments.get(selector);
 };
 h.tick();h.emit();h.emit();const mountWrites=parentWrites,chart=fragments.get('[data-live-charts="NIFTY"]'),chartWrites=chart.writes;
 h.document.activeElement={tagName:'SELECT'};
 h.advance(100);h.tick(22009);h.emit();assert.equal(parentWrites,mountWrites);assert(fragments.get('[data-live-values="NIFTY"]').innerHTML.includes('22,009'));assert(!fragments.get('[data-live-values="NIFTY"]').innerHTML.includes('data-live-values='),'patch only KPI children, never nest another identity wrapper');assert.equal(chart.writes,chartWrites);
 h.advance(200);h.tick(22011);h.emit();assert.equal(parentWrites,mountWrites);assert(chart.writes>chartWrites);assert(chart.innerHTML.includes('10:00:00.100'));assert(chart.innerHTML.includes('10:00:00.300'));
 const changeInventory=(s:any)=>s.indices[0].strikes.push(22050);h.advance(100);h.tick(22012);h.emit(changeInventory);assert(fragments.get('[data-live-values="NIFTY"]').innerHTML.includes('22,012'));assert.equal(parentWrites,mountWrites,'open selector must survive an inventory change');
 h.document.activeElement=null;h.emit(changeInventory);assert.equal(parentWrites,mountWrites+1,'new inventory mounts once after editing ends');
});

test('pause/resume with an identical next packet still rebuilds the cleared live view',()=>{
 const h=harness();h.tick();h.emit();assert(h.nodes.get('op-live-indices').innerHTML.includes('22,001'));
 h.nodes.get('op-live-toggle').onclick();assert(!h.nodes.get('op-live-indices').innerHTML.includes('22,001'));
 h.nodes.get('op-live-toggle').onclick();h.emit();assert(h.nodes.get('op-live-indices').innerHTML.includes('22,001'));
});

test('one-minute PCR does not skip a cycle when quote completion times are less than 60 seconds apart',()=>{
 const h=harness(),start=Date.parse('2026-10-16T04:30:00Z');let cycle=0,value=1.25;
 const patch=(s:any)=>{s.indices[0].pcrSnapshot={state:'COMPLETE',fullPcr:value,cycleStartedAt:new Date(start+cycle).toISOString(),checkedAt:s.asOf,sourceMinAt:s.asOf,sourceMaxAt:s.asOf,coverage:{complete:true,expected:2,freshOi:2}};};
 const valueOf=()=>h.nodes.get('op-live-indices').innerHTML.split('<h3>NIFTY')[1].match(/FULL PCR[^<]*<strong>([^<]*)/)[1];
 h.advance(10000);h.tick();h.emit(patch);assert.equal(valueOf(),'1.25');
 h.advance(56000);cycle=60000;value=1.5;h.tick();h.emit(patch);assert.equal(valueOf(),'1.5','56s completion gap must not turn minute sampling into 2min sampling');
});
test('Chapter 6 selections reuse the existing EventSource; independent sides and snapshot row deltas retain identity',()=>{
 const h=harness();h.tick();h.emit();const count=h.streams.length;
 h.winEvents['optionpilot:live-selection']({detail:{symbol:'NIFTY',ceStrike:22000,peStrike:22000}});
 assert.equal(h.streams.length,count+1);assert(h.streams.at(-2).closed);assert(h.streams.at(-1).url.includes('NIFTY_ceStrike=22000'));assert(h.streams.at(-1).url.includes('NIFTY_peStrike=22000'));
 h.emit((s:any)=>{s.indices[0].pcrSnapshot={state:'COMPLETE',checkedAt:s.asOf,cycleStartedAt:s.asOf,fullPcr:1,coverage:{complete:true},strikeRows:[{token:2,oi:100}]};});
 h.emit((s:any)=>{s.indices[0].pcrSnapshot={state:'COMPLETE',checkedAt:s.asOf,cycleStartedAt:s.asOf,fullPcr:1,coverage:{complete:true},strikeRowsUnchanged:true};});
 const q=h.contextEvents.at(-1).detail.snapshot.indices[0].pcrSnapshot;assert.equal(q.strikeRows[0].token,2);
 const before=h.streams.length;h.winEvents['optionpilot:live-selection']({detail:{symbol:'NIFTY',ceStrike:-1}});assert.equal(h.streams.length,before);
});


test('PR6 startup pageshow and online reuse one live EventSource without refreshing an active URL',()=>{
 const h=harness(),initial=h.streams[0];
 assert.equal(h.streams.length,1);
 h.winEvents.pageshow();h.winEvents.online({type:'online'});
 assert.equal(h.streams.length,1,'lifecycle events cannot multiply startup subscriptions');
 assert.equal(initial.closed,false,'the original live connection remains active');
 h.tick();h.emit(); // Existing initial contract pin deliberately reconnects with its new query.
 const pinned=h.streams.at(-1),count=h.streams.length;
 assert.notEqual(pinned,initial);
 h.winEvents.pageshow();h.winEvents.online({type:'online'});
 assert.equal(h.streams.length,count,'repeat lifecycle events must preserve pinned stream');
 assert.equal(pinned.closed,false);
 // A genuinely closed EventSource may be replaced even with the same query.
 pinned.readyState=2;
 h.winEvents.pageshow();
 assert.equal(h.streams.length,count+1);
 assert.equal(pinned.closed,true);
});

test('PR6 resumes exactly once after hidden/pagehide, still replaces stale and user-selected streams',()=>{
 const h=harness();
 h.tick();h.emit();const active=h.streams.at(-1),count=h.streams.length;
 h.document.hidden=true;h.docEvents.visibilitychange();assert(active.closed);
 h.document.hidden=false;h.docEvents.visibilitychange();
 assert.equal(h.streams.length,count+1);
 const resumed=h.streams.at(-1);
 h.winEvents.pageshow();h.winEvents.online({type:'online'});
 assert.equal(h.streams.length,count+1,'resume and pageshow share one connection');
 assert.equal(resumed.closed,false);
 h.winEvents.pagehide();assert(resumed.closed);
 h.winEvents.pageshow();
 assert.equal(h.streams.length,count+2,'pagehide pageshow replaces closed stream once');
 h.winEvents.pageshow();assert.equal(h.streams.length,count+2);
 h.tick();h.emit();const selected=h.streams.at(-1),n=h.streams.length;
 h.nodes.get('op-live-indices').onchange({target:{dataset:{liveIndex:'NIFTY',liveField:'strike'},value:'22000'}});
 assert.equal(h.streams.length,n+1,'explicit selection still forces reconnect');
 assert(selected.closed);
 const replacement=h.streams.at(-1);
 h.tick();h.emit(); // The existing 4-second watchdog measures from a received packet.
 h.advance(5000);h.timers[0]();
 assert(replacement.closed,'silent stale stream replaced, not reused');
 assert.equal(h.streams.length,n+2);
});


test('PR7 100 hidden live frames produce zero heavyweight DOM renders but keep the shared feed active',()=>{
 const h=harness(),panel=h.nodes.get('op-live-participation-panel'),node=h.nodes.get('op-live-participation');
 let html='',writes=0,txt='';
 Object.defineProperties(node,{
  innerHTML:{get(){return html;},set(v:string){html=v;txt=v;writes++;}},
  textContent:{get(){return txt;},set(v:string){txt=v;html=v;}}
 });
 panel.open=false;
 const payload=(s:any)=>{s.participation=[{identity:{label:'TEST SECTOR'},price:100,changePct:1,
   state:'LIVE',observedAt:s.asOf,receivedAt:s.asOf}];};
 for(let i=0;i<100;i++){h.advance(100);h.tick(22000+i);h.emit(payload);}
 const liveCount=h.streams.length;
 assert.equal(writes,0,'100 snapshots while collapsed must not build/replace heavyweight HTML');
 assert(h.contextEvents.filter((x:any)=>x.type==='optionpilot:live-context').length>=100,
  'other chapters must keep receiving all live packets');
 assert.match(h.nodes.get('op-live-indices').innerHTML,/22,099/,'live index still updates');
 panel.open=true;panel.ontoggle();assert.equal(writes,1,'opening paints the freshest held frame');
 assert.match(html,/TEST SECTOR/);
 assert.match(html,/received/);
 h.advance(100);h.tick(22222);h.emit(payload);
 assert(writes>=2,'expanded participation continues updating with live snapshots');
 panel.open=false;panel.ontoggle();assert.equal(node.textContent,'','closing releases hidden quote DOM');
 const count=writes;
 for(let i=0;i<100;i++){h.advance(100);h.tick(22500+i);h.emit(payload);}
 assert.equal(writes,count,'closed panel stays idle while shared market stream stays active');
 assert.equal(h.streams.length,liveCount,'no extra EventSource for heavyweight updates');
 panel.open=true;panel.ontoggle();assert.equal(writes,count+1,'reopening must render newly received readings');
 h.streams.at(-1).onerror();
 assert.equal(node.textContent,'Live values unavailable','disconnection revokes expanded heavyweight values');
});

test('PR7 structural memory and cadence audit: 600 chart points max per series, one live SSE, no extra timer',()=>{
 const src=installDashboardLive.toString();
 assert.equal((src.match(/new EventSource\(/g)||[]).length,1);
 assert.equal((src.match(/setInterval\(/g)||[]).length,1);
 assert.match(src,/rows.length>600/);
 assert.match(src,/rows.splice\(0,rows.length-600\)/);
 assert.match(src,/Date.now\(\)-paint.at>=250/);
 assert.match(src,/Date.now\(\)-lastReceived>4000/);
 assert.match(DASHBOARD_LIVE_HTML,/id="op-live-participation-panel"/);
});
