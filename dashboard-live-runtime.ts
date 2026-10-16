import { DashboardLiveStore, buildDashboardLiveInventory, type LiveIndex } from './dashboard-live-feed.js';
import { fetchH1KiteLiveInstrumentMaster } from './h1-kite-live-instrument-master-adapter.js';
import { resolveKiteAuthoritySession, subscribeKiteAuthoritySessionPersisted } from './kite-session-authority.js';
import { KiteWebSocketTransport } from './kite-websocket-transport.js';
import { QUOTE_SYMBOLS } from './dashboard-background-quotes.js';
import { isIndianEquityMarketOpenAt, indianTradingDateAt } from './market-session-calendar.js';

export const DASHBOARD_LIVE_ENV='DASHBOARD_LIVE_ENABLED';
let store:DashboardLiveStore|null=null,socket:KiteWebSocketTransport|null=null;
let state='DISABLED',generation=0,busy=false,credential:string|null=null,lastAttempt=0;
let timer:ReturnType<typeof setInterval>|null=null;
const enabled=()=>process.env[DASHBOARD_LIVE_ENV]?.trim().toLowerCase()==='true';
function stop(next:string){generation++;socket?.disconnect();socket=null;store=null;credential=null;state=next;}
/** One display-only socket per server process. Never sends ticks to trading observers. */
export async function reconcileDashboardLiveRuntime(force=false){
 if(busy)return;
 if(!enabled()){if(socket||store)stop('DISABLED');else state='DISABLED';return;}
 const now=new Date();if(!isIndianEquityMarketOpenAt(now)){if(socket||store)stop('MARKET_CLOSED');else state='MARKET_CLOSED';return;}
 if(!force&&Date.now()-lastAttempt<60000)return;busy=true;lastAttempt=Date.now();
 try{
  const authority=await resolveKiteAuthoritySession(),apiKey=process.env.KITE_API_KEY?.trim();
  if(!authority.session||!authority.status.active||!apiKey){stop('KITE_SESSION_REQUIRED');return;}
  const date=indianTradingDateAt(now);
  if(socket&&['OPEN','CONNECTING','RECONNECTING'].includes(state)&&credential===authority.session.accessToken&&store?.inventory.date===date)return;
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
  socket.connect();
 }catch{stop('FEED_UNAVAILABLE');}finally{busy=false;}
}
export function startDashboardLiveRuntime(){
 if(timer||process.env.NODE_ENV==='test')return;
 timer=setInterval(()=>void reconcileDashboardLiveRuntime(),30000);timer.unref();
 subscribeKiteAuthoritySessionPersisted(()=>{stop('RECONNECTING');void reconcileDashboardLiveRuntime(true);});
 void reconcileDashboardLiveRuntime(true);
}
export function readDashboardLiveSnapshot(selection:Partial<Record<LiveIndex,{expiry?:string;strike?:number}>>={}){
 const connected=state==='OPEN';
 const snapshot=store?.snapshot(Date.now(),selection)||null;
 // Socket closure must immediately revoke numeric live values, even before age expiry.
 if(snapshot&&!connected){for(const index of snapshot.indices){for(const q of [index.spot,index.future,index.ce,index.pe]){q.price=null;q.oi=null;q.volume=null;q.bid=null;q.ask=null;q.changePct=null;q.state='STALE';}index.futuresBasis=null;index.fullPcr=null;index.ceTotal=null;index.peTotal=null;index.callWall=null;index.putWall=null;index.coverage.complete=false;}for(const q of [snapshot.vix,...snapshot.participation]){q.price=null;q.oi=null;q.volume=null;q.bid=null;q.ask=null;q.changePct=null;q.state='STALE';}}
 return {enabled:enabled(),connectionState:state,connected,serverTime:new Date().toISOString(),snapshot,source:'KITE_WEBSOCKET_FULL',createsOrders:false,affectsTelegram:false,affectsSelector:false,affectsExecution:false};
}
