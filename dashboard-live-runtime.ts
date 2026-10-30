import { DashboardPcrSampler } from './dashboard-pcr-sampler.js';
import { tickTelegramLadderShadow } from './telegram-ladder-shadow-host.js';
import { createParticipationMinuteRecorder } from './participation-minute-recorder.js';
import { dbSaveParticipationMinuteOnce } from './db.js';
import { DashboardLiveStore, buildDashboardLiveInventory, type LiveSelection, type PremiumWatchFilter } from './dashboard-live-feed.js';
import { fetchH1KiteLiveInstrumentMaster } from './h1-kite-live-instrument-master-adapter.js';
import { subscribeKiteAuthoritySessionPersisted } from './kite-session-authority.js';
import { resolveVerifiedKiteAuthoritySession, readKiteBrokerSessionCheck, markKiteBrokerSessionRejected } from './kite-broker-session-guard.js';
import { KiteWebSocketTransport } from './kite-websocket-transport.js';
import { QUOTE_SYMBOLS } from './dashboard-background-quotes.js';
import { isIndianEquityMarketOpenAt, indianTradingDateAt, indianEquityMarketPhaseAt } from './market-session-calendar.js';

export const DASHBOARD_LIVE_ENV='DASHBOARD_LIVE_ENABLED';
let store:DashboardLiveStore|null=null,socket:KiteWebSocketTransport|null=null;
let pcrSampler:DashboardPcrSampler|null=null;
let state='DISABLED',generation=0,busy=false,credential:string|null=null,lastAttempt=0;
let timer:ReturnType<typeof setInterval>|null=null;
let preflightAt=0;
let sessionRefreshQueued=false;
let sessionCheckLog='';
const participationRecorder=createParticipationMinuteRecorder(dbSaveParticipationMinuteOnce);
function noteSessionCheck(){const value=JSON.stringify(readKiteBrokerSessionCheck());if(value!==sessionCheckLog){sessionCheckLog=value;console.info('[DASHBOARD_LIVE_SESSION_CHECK] '+value);}}
const enabled=()=>process.env[DASHBOARD_LIVE_ENV]?.trim().toLowerCase()==='true';
function stop(next:string){generation++;socket?.disconnect();socket=null;store=null;pcrSampler=null;credential=null;state=next;}
/** One display-only socket per server process. Never sends ticks to trading observers. */
export async function reconcileDashboardLiveRuntime(force=false){
 if(busy)return;
 if(!enabled()){if(socket||store)stop('DISABLED');else state='DISABLED';return;}
 const now=new Date();if(!isIndianEquityMarketOpenAt(now)){
  if(socket||store)stop('MARKET_CLOSED');else state='MARKET_CLOSED';
  const ist=new Date(now.getTime()+19800000),minutes=ist.getUTCHours()*60+ist.getUTCMinutes();
  if(indianEquityMarketPhaseAt(now)==='PREMARKET'&&minutes>=510&&Date.now()-preflightAt>=60000){
   busy=true;preflightAt=Date.now();try{await resolveVerifiedKiteAuthoritySession();noteSessionCheck();}catch{/* Next bounded preflight retries transient storage failures. */}finally{busy=false;if(sessionRefreshQueued){sessionRefreshQueued=false;void reconcileDashboardLiveRuntime(true);}}
  }return;
 }
 if(!force&&Date.now()-lastAttempt<60000)return;busy=true;lastAttempt=Date.now();
 try{
  const authority=await resolveVerifiedKiteAuthoritySession(),apiKey=process.env.KITE_API_KEY?.trim();
  noteSessionCheck();
  if(!authority.session||!authority.status.active||!apiKey){stop(authority.status.code==='BROKER_UNAVAILABLE'?'BROKER_SESSION_UNAVAILABLE':'KITE_SESSION_REQUIRED');return;}
  const date=indianTradingDateAt(now);
  if(socket&&['OPEN','CONNECTING','RECONNECTING'].includes(state)&&Date.now()-socket.lastActivityAt<30000&&credential===authority.session.accessToken&&store?.inventory.date===date)return;
  stop('CONNECTING');const attempt=generation;
  const master=await fetchH1KiteLiveInstrumentMaster({apiKey,accessToken:authority.session.accessToken,fetchImpl:((url:any,init:any)=>fetch(url,{...init,signal:AbortSignal.timeout(25000)})) as typeof fetch});
  if(attempt!==generation)return;if(!master.ready){state='INSTRUMENT_MASTER_UNAVAILABLE';return;}
  const inventory=buildDashboardLiveInventory(master.rows,date,QUOTE_SYMBOLS);
  if(!inventory.entries.length){state='INVENTORY_UNAVAILABLE';return;}
  const target=new DashboardLiveStore(inventory);store=target;credential=authority.session.accessToken;
  socket=new KiteWebSocketTransport({apiKey,accessToken:credential,instrumentTokens:inventory.entries.map(e=>e.token),mode:'full',broadcastObservers:false,
   reconnect:{enabled:true,delayMs:2000,maxAttempts:10},
   onTicks:(ticks,receivedAt)=>{if(attempt===generation)target.ingest(ticks,receivedAt);},
   onState:next=>{if(attempt===generation)state=next;}});
  const sessionToken=credential;
  pcrSampler=new DashboardPcrSampler(inventory,{
   now:()=>Date.now(),active:()=>attempt===generation&&enabled()&&state==='OPEN'&&isIndianEquityMarketOpenAt(new Date()),
   wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
   readSpot:symbol=>target.spotQuote(symbol,Date.now()),
   fetchQuotes:async keys=>{
    const params=new URLSearchParams();for(const key of keys)params.append('i',key);
    const response=await fetch('https://api.kite.trade/quote?'+params,{headers:{'X-Kite-Version':'3',Authorization:'token '+apiKey+':'+sessionToken},signal:AbortSignal.timeout(8000)});
    if(response.status===401||response.status===403){markKiteBrokerSessionRejected(apiKey,sessionToken);if(attempt===generation)stop('KITE_SESSION_REQUIRED');}
    if(!response.ok)throw Error('PCR_QUOTE_HTTP_'+response.status);const body=await response.json() as any;
    if(body?.status!=='success'||!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw Error('PCR_QUOTE_INVALID_RESPONSE');return body.data;
   },onDiagnostic:summary=>console.info('[DASHBOARD_LIVE_PCR_DIAGNOSTIC] '+JSON.stringify(summary))
  });
  socket.connect();
 }catch{stop('FEED_UNAVAILABLE');}finally{busy=false;if(sessionRefreshQueued){sessionRefreshQueued=false;void reconcileDashboardLiveRuntime(true);}}
}
export function startDashboardLiveRuntime(){
 if(timer||process.env.NODE_ENV==='test')return;
 timer=setInterval(()=>{void reconcileDashboardLiveRuntime();void pcrSampler?.tick();
  void tickTelegramLadderShadow().catch(()=>console.warn('[TELEGRAM_LADDER_SHADOW] TICK_FAILED'));
  if(isIndianEquityMarketOpenAt(new Date()))void participationRecorder.capture(readDashboardLiveSnapshot).then(result=>{
   if(result==='FAILED')console.warn('[PARTICIPATION_MINUTE] SAVE_FAILED_RETRY_NEXT_TICK');
  });
 },5000);timer.unref();
 subscribeKiteAuthoritySessionPersisted(()=>{stop('RECONNECTING');if(busy)sessionRefreshQueued=true;else void reconcileDashboardLiveRuntime(true);});
 void reconcileDashboardLiveRuntime(true);
}
export function readDashboardLiveSnapshot(selection:LiveSelection={}){
 const connected=state==='OPEN';
 const snapshot=store?.snapshot(Date.now(),selection)||null;
 if(snapshot)for(const index of snapshot.indices)(index as any).pcrSnapshot=connected?pcrSampler?.read(index.symbol,index.expiry)||null:null;
 // Socket closure must immediately revoke numeric live values, even before age expiry.
 if(snapshot&&!connected){for(const index of snapshot.indices){for(const q of [index.spot,index.future,index.ce,index.pe,index.studioCE,index.studioPE,...index.oiQuotes]){q.price=null;q.oi=null;q.volume=null;q.bid=null;q.ask=null;q.changePct=null;q.pdc=null;q.state='STALE';}index.futuresBasis=null;index.fullPcr=null;index.ceTotal=null;index.peTotal=null;index.callWall=null;index.putWall=null;index.coverage.complete=false;}for(const q of [snapshot.vix,...snapshot.participation]){q.price=null;q.oi=null;q.volume=null;q.bid=null;q.ask=null;q.changePct=null;q.pdc=null;q.state='STALE';}}
 return {enabled:enabled(),connectionState:state,connected,brokerSession:readKiteBrokerSessionCheck(),serverTime:new Date().toISOString(),snapshot,source:'KITE_WEBSOCKET_FULL',createsOrders:false,affectsTelegram:false,affectsSelector:false,affectsExecution:false};
}

/** Cheap dirty check: no full-chain projection until a tick/state changes or heartbeat is due. */
export function dashboardLiveRevision(){return state+':'+(store?.runtimeId||'none')+':'+(store?.revision()||0)+':'+(pcrSampler?.version()||0);}

/** Display-only view of the same socket cache; disconnection revokes all values. */
export function readDashboardPremiumSnapshot(filter:PremiumWatchFilter={}){
 const connected=state==='OPEN',snapshot=store?.premiums(Date.now(),filter)||null;
 if(snapshot&&!connected)for(const q of snapshot.rows){q.price=null;q.oi=null;q.volume=null;q.bid=null;q.ask=null;q.changePct=null;q.pdc=null;q.state='STALE';if('modelDelta' in q)q.modelDelta=null;}
 return {connected,connectionState:state,brokerSession:readKiteBrokerSessionCheck(),serverTime:new Date().toISOString(),snapshot,createsOrders:false,affectsSelector:false,affectsTelegram:false,affectsExecution:false};
}

/** Internal authenticated seller consumer only; never exposes account values in the public stream. */
export function readDashboardSellerContext(shortToken:number,longToken:number,quantity:number){
 return {connected:state==='OPEN',connectionState:state,runtimeId:store?.runtimeId||null,
  sessionToken:credential,short:state==='OPEN'?store?.sellerLeg(shortToken,quantity)||null:null,
  long:state==='OPEN'?store?.sellerLeg(longToken,quantity)||null:null};
}
export function readDashboardSellerOptions(){
 return {connectionState:state,rows:store?.inventory.entries.filter(e=>e.role==='OPTION'&&
  (e.symbol==='NIFTY'||e.symbol==='SENSEX')).map(e=>({...e}))||[]};
}
