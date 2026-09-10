import { ImmediateAbnormalChangeDetector } from "./immediate-abnormal-change-detector.js";
import { buildImmediateExpansionTelegramRuntime } from "./immediate-expansion-telegram-runtime.js";
import { registerKiteTickObserver, type KiteGlobalTickObserver } from "./kite-websocket-transport.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import type { KiteImmediateTokenEntry } from "./kite-immediate-token-registry.js";
import type { ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";

type Symbol = "NIFTY" | "SENSEX" | "BANKNIFTY";
type Side = "CE" | "PE" | "NONE";

const SOURCE = "H1_EXACT_LIVE_KITE_WS";
const CLUSTER_MAX_AGE_MS = 12_000;
const SAME_SIDE_COOLDOWN_MS = 60_000;

export type SweetSpotLiveStatus = {
  version: "SWEET_SPOT_LIVE_OBSERVER_V1";
  installed: boolean;
  observedTicks: number;
  detectorEvents: number;
  sent: number;
  suppressed: number;
  lastAlertAt: string | null;
  lastAlertSymbol: Symbol | null;
  affectsSelector: false;
  affectsExecution: false;
  createsOrders: false;
};

const detectorByKey = new Map<string, ImmediateAbnormalChangeDetector>();
const previousSpot = new Map<Symbol, number>();
const lockedSide = new Map<Symbol, Side>();
const recentEvents = new Map<Symbol, ImmediateVerifiedEvent[]>();
const lastSent = new Map<Symbol, { side: Side; at: number; fingerprint: string }>();
let unsubscribe: (() => void) | null = null;
let status: SweetSpotLiveStatus = { version:"SWEET_SPOT_LIVE_OBSERVER_V1", installed:false, observedTicks:0, detectorEvents:0, sent:0, suppressed:0, lastAlertAt:null, lastAlertSymbol:null, affectsSelector:false, affectsExecution:false, createsOrders:false };

function detector(key:string) { let d=detectorByKey.get(key); if(!d){ d=new ImmediateAbnormalChangeDetector(); detectorByKey.set(key,d); } return d; }
function chatId(symbol:Symbol): string { return symbol === "NIFTY" ? process.env.TELEGRAM_NIFTY_CHAT_ID||"" : symbol === "SENSEX" ? process.env.TELEGRAM_SENSEX_CHAT_ID||"" : process.env.TELEGRAM_BANKNIFTY_CHAT_ID||""; }
async function send(symbol:Symbol,text:string):Promise<boolean>{
  if(symbol === "BANKNIFTY") return false;
  const token=process.env.TELEGRAM_BOT_TOKEN||""; const chat=chatId(symbol); if(!token||!chat) return false;
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,text})});
  return r.ok;
}
function primaryExpiry(entries:KiteImmediateTokenEntry[],symbol:Symbol):string|null{
  const xs=entries.filter(e=>e.symbol===symbol&&e.role==="OPTION"&&e.expiry).map(e=>String(e.expiry)).sort(); return xs[0]??null;
}
function sample(entry:KiteImmediateTokenEntry,tick:KiteDecodedPacket,receivedAt:string,side:Side):ImmediateVerifiedEvent|null{
  let family:"SPOT"|"CE_PREMIUM"|"PE_PREMIUM"; let rise:"FAVOURS_CE"|"FAVOURS_PE"; let fall:"FAVOURS_CE"|"FAVOURS_PE";
  if(entry.role==="SPOT"){ family="SPOT"; rise="FAVOURS_CE"; fall="FAVOURS_PE"; }
  else if(entry.role==="OPTION"&&entry.optionSide==="CE"){ family="CE_PREMIUM"; rise="FAVOURS_CE"; fall="FAVOURS_PE"; }
  else if(entry.role==="OPTION"&&entry.optionSide==="PE"){ family="PE_PREMIUM"; rise="FAVOURS_PE"; fall="FAVOURS_CE"; }
  else return null;
  const observed=tick.exchangeTimestamp||tick.lastTradeTimestamp||receivedAt;
  const out=detector(`${entry.symbol}|${entry.instrumentToken}|${family}`).observe({id:`${entry.instrumentToken}:${observed}`,family,occurredAt:observed,value:tick.lastPrice,source:SOURCE,snapshotId:null,effectWhenRising:rise,effectWhenFalling:fall,factLabel:`${entry.instrumentLabel} ${family}`},side,true);
  return out.event;
}

export function getSweetSpotLiveStatus():SweetSpotLiveStatus { return {...status}; }
export function installSweetSpotLiveObserver(entries:KiteImmediateTokenEntry[]):()=>void {
  if(unsubscribe) return unsubscribe;
  const byToken=new Map(entries.map(e=>[e.instrumentToken,e]));
  const primaries=new Map<Symbol,string|null>((["NIFTY","SENSEX","BANKNIFTY"] as Symbol[]).map(s=>[s,primaryExpiry(entries,s)]));
  const observer:KiteGlobalTickObserver=async(ticks,receivedAt)=>{
    const now=Date.parse(receivedAt); if(!Number.isFinite(now)) return;
    for(const tick of ticks){
      const entry=byToken.get(tick.instrumentToken); if(!entry||!Number.isFinite(tick.lastPrice)||tick.lastPrice<=0) continue;
      const symbol=entry.symbol as Symbol; status.observedTicks++;
      if(entry.role==="OPTION"&&entry.expiry!==primaries.get(symbol)) continue;
      let side=lockedSide.get(symbol)??"NONE";
      if(entry.role==="SPOT"){
        const prev=previousSpot.get(symbol); previousSpot.set(symbol,tick.lastPrice);
        if(Number.isFinite(prev)&&tick.lastPrice!==prev){ side=tick.lastPrice>Number(prev)?"CE":"PE"; lockedSide.set(symbol,side); }
      }
      const event=sample(entry,tick,receivedAt,side); if(!event) continue;
      status.detectorEvents++;
      const rows=[...(recentEvents.get(symbol)??[]),event].filter(e=>now-Date.parse(e.occurredAt)<=CLUSTER_MAX_AGE_MS);
      recentEvents.set(symbol,rows);
      const currentSide=lockedSide.get(symbol)??"NONE"; if(currentSide==="NONE") continue;
      const latestByFamily=new Map(rows.map(e=>[e.family,e]));
      const required=["SPOT","CE_PREMIUM","PE_PREMIUM"] as const;
      if(!required.every(f=>latestByFamily.has(f))) continue;
      const cluster=required.map(f=>latestByFamily.get(f)!).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
      if(cluster.some(e=>e.alignment==="CONFLICTS_TREND")) { status.suppressed++; continue; }
      const payload:any={market:{snapshotId:`sweet:${symbol}:${Math.floor(now/1000)}`,symbol,exchangeTimestamp:receivedAt,backendTimestamp:receivedAt,spot:entry.role==="SPOT"?tick.lastPrice:previousSpot.get(symbol)??null,future:null,futureOi:null,futureVolume:null,vwap:null,pdh:null,pdl:null},options:[],verdicts:[],immediateExpansion:{lockedTrendSide:currentSide,trendValid:true,clusterReady:true,events:cluster}};
      const alert=buildImmediateExpansionTelegramRuntime(payload); if(!alert.eligible||!alert.text||!alert.fingerprint){status.suppressed++;continue;}
      const last=lastSent.get(symbol); if(last&&last.side===currentSide&&(now-last.at)<SAME_SIDE_COOLDOWN_MS){status.suppressed++;continue;}
      const ok=await send(symbol,alert.text); if(ok){ lastSent.set(symbol,{side:currentSide,at:now,fingerprint:alert.fingerprint}); status.sent++; status.lastAlertAt=receivedAt; status.lastAlertSymbol=symbol; console.log(`[TELEGRAM_SWEET_SPOT] ${JSON.stringify({symbol,state:"SENT",side:currentSide,clusterFamilies:required,source:SOURCE,selectorAuthorityUnchanged:true,createsOrders:false})}`); }
      else if(symbol==="BANKNIFTY") console.log(`[TELEGRAM_SWEET_SPOT] ${JSON.stringify({symbol,state:"OBSERVATION_ONLY",side:currentSide,createsOrders:false})}`);
      else console.warn(`[TELEGRAM_SWEET_SPOT] ${JSON.stringify({symbol,state:"SEND_FAILED_OR_NOT_CONFIGURED",side:currentSide,createsOrders:false})}`);
    }
  };
  unsubscribe=registerKiteTickObserver(observer); status.installed=true; console.log(`[TELEGRAM_SWEET_SPOT] ${JSON.stringify({state:"ARMED",source:SOURCE,noTimeframeBoundary:true,createsOrders:false})}`);
  return unsubscribe;
}

export function resetSweetSpotLiveObserverForTest(){ if(process.env.NODE_ENV!=="test") throw new Error("TEST_ONLY"); unsubscribe?.(); unsubscribe=null; detectorByKey.clear(); previousSpot.clear(); lockedSide.clear(); recentEvents.clear(); lastSent.clear(); status={version:"SWEET_SPOT_LIVE_OBSERVER_V1",installed:false,observedTicks:0,detectorEvents:0,sent:0,suppressed:0,lastAlertAt:null,lastAlertSymbol:null,affectsSelector:false,affectsExecution:false,createsOrders:false}; }
