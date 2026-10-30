import test from 'node:test';import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';import { runInNewContext } from 'node:vm';import { transformSync } from 'esbuild';
import { isIndianEquityMarketOpenAt,indianTradingDateAt,indianEquityMarketPhaseAt } from '../market-session-calendar.js';
import { createParticipationMinuteRecorder } from '../participation-minute-recorder.js';
const source=readFileSync(new URL('../dashboard-live-runtime.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'');
const code=transformSync(source,{loader:'ts'}).code;
function harness(at='2026-10-19T04:00:00Z'){
 let now=Date.parse(at),checks=0,rejected=0,masterReads=0,active=true;const sockets:any[]=[],samplers:any[]=[],listeners:Function[]=[];
 class Clock extends Date{constructor(...args:any[]){super(args.length?args[0]:now);}static now(){return now;}}
 class Store{inventory:any;constructor(inventory:any){this.inventory=inventory;}snapshot(){return {indices:[],vix:{},participation:[]};}premiums(){return {rows:[]};}}
 class Socket{lastActivityAt=now;disconnected=false;constructor(public config:any){sockets.push(this);}connect(){this.config.onState('OPEN');}disconnect(){this.disconnected=true;}}
 class Sampler{constructor(_inventory:any,public deps:any){samplers.push(this);}read(){return null;}tick(){}version(){return 0;}}
 const context:any={Date:Clock,process:{env:{DASHBOARD_LIVE_ENABLED:'true',KITE_API_KEY:'fixture',NODE_ENV:'production'}},
  DashboardLiveStore:Store,KiteWebSocketTransport:Socket,DashboardPcrSampler:Sampler,QUOTE_SYMBOLS:[],
  createParticipationMinuteRecorder,tickTelegramLadderShadow:async()=>{},dbSaveParticipationMinuteOnce:async()=>{throw Error('Unexpected participation DB write in recovery tests');},
  buildDashboardLiveInventory:()=>({date:indianTradingDateAt(new Clock()),entries:[{token:1}]}),
  fetchH1KiteLiveInstrumentMaster:async()=>{masterReads++;return {ready:true,rows:[]};},
  resolveVerifiedKiteAuthoritySession:async()=>{checks++;return {session:active?{accessToken:'fixture-token'}:null,status:{active,code:active?'ACTIVE':'RECONNECT_REQUIRED'}};},
  subscribeKiteAuthoritySessionPersisted:(fn:Function)=>listeners.push(fn),readKiteBrokerSessionCheck:()=>({code:rejected?'RECONNECT_REQUIRED':'VERIFIED'}),
  markKiteBrokerSessionRejected:()=>{rejected++;active=false;},isIndianEquityMarketOpenAt,indianTradingDateAt,indianEquityMarketPhaseAt,
  setInterval:()=>({unref(){}}),setTimeout,URLSearchParams,AbortSignal,console:{info(){}},fetch:async()=>new Response('',{status:403})};
 const runtime=runInNewContext(code+';({reconcileDashboardLiveRuntime,readDashboardLiveSnapshot,startDashboardLiveRuntime})',context);
 return {runtime,sockets,samplers,context,listeners,counts:()=>({checks,rejected,masterReads}),advance:(ms:number)=>now+=ms,block:()=>active=false};
}
test('08:30 weekday preflight checks broker acceptance without opening a market socket',async()=>{
 const h=harness('2026-10-19T03:00:00Z');await h.runtime.reconcileDashboardLiveRuntime();
 assert.equal(h.counts().checks,1);assert.equal(h.sockets.length,0);assert.equal(h.runtime.readDashboardLiveSnapshot().connectionState,'MARKET_CLOSED');
 await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.counts().checks,1);h.advance(60000);await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.counts().checks,2);
 const weekend=harness('2026-10-18T03:00:00Z');await weekend.runtime.reconcileDashboardLiveRuntime();assert.equal(weekend.counts().checks,0);
});
test('invalid broker session never fetches an instrument master or opens a socket',async()=>{
 const h=harness();h.block();await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.counts().masterReads,0);assert.equal(h.sockets.length,0);assert.equal(h.runtime.readDashboardLiveSnapshot().connectionState,'KITE_SESSION_REQUIRED');
});
test('silent socket is replaced after bounded cooldown; fresh broker heartbeats prevent churn',async()=>{
 const h=harness();await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.sockets.length,1);
 h.advance(60001);h.sockets[0].lastActivityAt+=60001;await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.sockets.length,1);
 h.advance(60001);await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.sockets.length,2);assert(h.sockets[0].disconnected);
 await h.runtime.reconcileDashboardLiveRuntime();assert.equal(h.sockets.length,2);
});
test('PCR 403 revokes the session immediately and cannot leak credentials through public snapshots',async()=>{
 const h=harness();await h.runtime.reconcileDashboardLiveRuntime();
 await assert.rejects(h.samplers[0].deps.fetchQuotes(['NFO:fixture']),/PCR_QUOTE_HTTP_403/);
 const value=h.runtime.readDashboardLiveSnapshot();assert.equal(value.connected,false);assert.equal(value.connectionState,'KITE_SESSION_REQUIRED');assert.equal(value.snapshot,null);
 assert.equal(h.counts().rejected,1);assert(!JSON.stringify(value).includes('fixture-token'));
});
