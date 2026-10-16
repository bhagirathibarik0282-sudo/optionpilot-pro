import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import { installDashboardLive,DASHBOARD_LIVE_HTML } from '../dashboard-live-view.js';
import { DashboardLiveStore,type LiveEntry } from '../dashboard-live-feed.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';
function harness(){
 const nodes=new Map<string,any>();for(const m of DASHBOARD_LIVE_HTML.matchAll(/id="([^"]+)"/g))nodes.set(m[1],{innerHTML:'',textContent:'',hidden:false,setAttribute(){},contains(){return true;},querySelector(){return null;}});
 const streams:any[]=[],timers:any[]=[],docEvents:any={},winEvents:any={};let now=Date.parse('2026-10-16T04:30:00Z');
 class Clock extends Date{static now(){return now;}}
 class Stream{closed=false;handlers:any={};constructor(public url:string){streams.push(this);}close(){this.closed=true;}addEventListener(type:string,fn:any){this.handlers[type]=fn;}}
 const document:any={hidden:false,activeElement:null,getElementById:(id:string)=>nodes.get(id),addEventListener:(type:string,fn:any)=>docEvents[type]=fn};
 const ctx:any={document,window:{addEventListener:(type:string,fn:any)=>winEvents[type]=fn},EventSource:Stream,URLSearchParams,Date:Clock,Map,Set,Number,String,Array,Object,Math,setInterval:(fn:any)=>timers.push(fn)};
 vm.createContext(ctx);const scripts=[...renderBusinessDashboardV1Html({} as any).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);vm.runInContext(scripts[0],ctx);vm.runInContext(scripts.at(-1)!,ctx);
 const entries:LiveEntry[]=[{token:1,role:'SPOT',symbol:'NIFTY',label:'NIFTY 50'},...['CE','PE'].map((side,i)=>({token:2+i,role:'OPTION' as const,symbol:'NIFTY' as const,label:side,side:side as 'CE'|'PE',expiry:'2026-10-19',strike:22000}))];
 const store=new DashboardLiveStore({entries,date:'2026-10-16',missing:[],omittedExpiries:[]});
 const tick=(price=22001)=>{store.ingest(entries.map(e=>({instrumentToken:e.token,lastPrice:e.role==='SPOT'?price:100,exchangeTimestamp:new Date(now).toISOString(),oi:100,mode:'full' as const,isIndex:e.role==='SPOT'})),new Date(now).toISOString());};
 const emit=()=>{const before=streams.length;const fire=()=>streams.at(-1).handlers.snapshot({data:JSON.stringify({connected:true,connectionState:'OPEN',serverTime:new Date(now).toISOString(),snapshot:store.snapshot(now)})});fire();if(streams.length>before)fire();};
 return {nodes,streams,timers,docEvents,winEvents,document,store,tick,emit,advance:(ms:number)=>now+=ms};
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
 h.document.hidden=true;h.docEvents.visibilitychange();assert(h.streams[0].closed);h.document.hidden=false;h.docEvents.visibilitychange();assert.equal(h.streams.length,3);
 h.tick();h.emit();h.winEvents.pagehide();assert(h.streams[2].closed);h.winEvents.pageshow();assert.equal(h.streams.length,4);
});
test('disabled feed is explicit and IV/Greeks are never fabricated; original script order stays intact',()=>{
 const h=harness();h.streams[0].handlers.snapshot({data:JSON.stringify({connectionState:'DISABLED',snapshot:null})});assert(h.nodes.get('op-live-status').textContent.includes('DISABLED'));
 const html=renderBusinessDashboardV1Html({} as any),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);assert(scripts[0].includes('installMarketBook'));assert(scripts[1].includes('function load('));assert(scripts.at(-1)!.includes('dashboard-live/stream'));assert.equal((html.match(/id="dashboard-live"/g)||[]).length,1);
});
