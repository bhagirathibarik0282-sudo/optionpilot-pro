import { mapKiteFullPacketToH1ExactDepth } from './h1-kite-exact-depth-adapter.js';
import { KiteImmediateTokenRegistry } from './kite-immediate-token-registry.js';
import type { KiteInstrumentMasterRow } from './kite-immediate-registry-builder.js';
import type { KiteDecodedPacket } from './kite-websocket-binary-decoder.js';

export const LIVE_INDICES = ['NIFTY','SENSEX','BANKNIFTY'] as const;
export type LiveIndex = typeof LIVE_INDICES[number];
export type LiveEntry = { token:number; label:string; exchange?:string; lotSize?:number; role:'SPOT'|'FUTURE'|'OPTION'|'VIX'|'STOCK'|'SECTOR'; symbol?:LiveIndex; expiry?:string; strike?:number; side?:'CE'|'PE' };
export type LiveInventory = { entries:LiveEntry[]; omittedExpiries:string[]; missing:string[]; date:string };
const dateOf=(at:number)=>new Date(at+19800000).toISOString().slice(0,10);
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;

/** Whole expiry inventories only; never labels ATM/CORE as full chain. */
export function buildDashboardLiveInventory(rows:KiteInstrumentMasterRow[],date:string,quoteKeys:string[],limit=3000):LiveInventory {
 const entries:LiveEntry[]=[],missing:string[]=[],omittedExpiries:string[]=[];
 const add=(row:KiteInstrumentMasterRow,entry:Omit<LiveEntry,'token'|'label'>)=>{if(!entries.some(e=>e.token===row.instrument_token))entries.push({token:row.instrument_token,label:row.tradingsymbol,...entry});};
 const exact=(key:string)=>{const [exchange,...parts]=key.split(':');const matches=rows.filter(r=>r.exchange===exchange&&r.tradingsymbol===parts.join(':'));return matches.length===1?matches[0]:null;};
 const spotKeys={NIFTY:'NSE:NIFTY 50',SENSEX:'BSE:SENSEX',BANKNIFTY:'NSE:NIFTY BANK'};
 for(const symbol of LIVE_INDICES){
  const spot=exact(spotKeys[symbol]);if(spot)add(spot,{symbol,role:'SPOT'});else missing.push(symbol+':SPOT');
  const fs=rows.filter(r=>r.name===symbol&&r.instrument_type==='FUT'&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.expiry))&&String(r.expiry)>=date).sort((a,b)=>String(a.expiry).localeCompare(String(b.expiry)));
  const nearest=fs[0];if(nearest&&fs.filter(r=>r.expiry===nearest.expiry).length===1)add(nearest,{symbol,role:'FUTURE',expiry:String(nearest.expiry)});else missing.push(symbol+':FUTURE');
 }
 const vix=exact('NSE:INDIA VIX');if(vix)add(vix,{role:'VIX'});else missing.push('VIX');
 for(const key of [...new Set(quoteKeys)]){const r=exact(key);if(r)add(r,{role:r.segment==='INDICES'?'SECTOR':'STOCK'});else missing.push(key);}
 const groups=new Map<LiveIndex,Array<{expiry:string;rows:KiteInstrumentMasterRow[]}>>();
 for(const symbol of LIVE_INDICES){
  const options=rows.filter(r=>r.name===symbol&&(r.instrument_type==='CE'||r.instrument_type==='PE')&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.expiry))&&String(r.expiry)>=date);
  const expiries=[...new Set(options.map(r=>String(r.expiry)))].sort().slice(0,4);
  groups.set(symbol,expiries.map(expiry=>({expiry,rows:options.filter(r=>r.expiry===expiry)})));
 }
 // Give each index a complete nearest expiry before spending capacity on later ones.
 for(let i=0;i<4;i++)for(const symbol of LIVE_INDICES){const group=groups.get(symbol)?.[i];if(!group)continue;
  const identities=new Set(group.rows.map(r=>r.strike+'|'+r.instrument_type));
  const tokens=new Set(group.rows.map(r=>r.instrument_token));
  const collision=group.rows.some(r=>entries.some(e=>e.token===r.instrument_token));
  if(collision||identities.size!==group.rows.length||tokens.size!==group.rows.length||group.rows.some(r=>!Number.isInteger(r.instrument_token)||r.instrument_token<=0||!Number.isFinite(r.strike)||Number(r.strike)<=0)||entries.length+group.rows.length>limit){omittedExpiries.push(symbol+'|'+group.expiry);continue;}
  for(const r of group.rows)add(r,{symbol,exchange:r.exchange,lotSize:Number(r.lot_size)||undefined,role:'OPTION',expiry:group.expiry,strike:Number(r.strike),side:r.instrument_type as 'CE'|'PE'});
 }
 for(const symbol of LIVE_INDICES)if(!entries.some(e=>e.symbol===symbol&&e.role==='OPTION'))missing.push(symbol+':FULL_EXPIRY_INVENTORY');
 if(entries.length>limit||new Set(entries.map(e=>e.token)).size!==entries.length)throw Error('LIVE_INVENTORY_LIMIT_OR_IDENTITY');
 return {entries,omittedExpiries,missing,date};
}

type Tick = {packet:KiteDecodedPacket;price:number|null;oi:number|null;volume:number|null;bid:number|null;ask:number|null;close:number|null;observedAt:string|null;receivedAt:string;mode:string};
/** Latest value per subscribed token only: no database writes or unbounded tick history. */
export class DashboardLiveStore {
 private ticks=new Map<number,Tick>();
 private entries:Map<number,LiveEntry>;
 private sequence=0;
 readonly runtimeId=globalThis.crypto.randomUUID();
 constructor(readonly inventory:LiveInventory){this.entries=new Map(inventory.entries.map(e=>[e.token,e]));}
 ingest(packets:KiteDecodedPacket[],receivedAt:string){
  const receipt=Date.parse(receivedAt);if(!Number.isFinite(receipt)||dateOf(receipt)!==this.inventory.date)return;
  for(const p of packets){if(!this.entries.has(p.instrumentToken)||p.mode!=='full')continue;
   const at=Date.parse(p.exchangeTimestamp||'');
   if(!Number.isFinite(at)||at>receipt+5000||dateOf(at)!==this.inventory.date)continue;
   const previous=this.ticks.get(p.instrumentToken);if(previous&&at<Date.parse(previous.observedAt||''))continue;
   const price=number(p.lastPrice),oi=number(p.oi),volume=number(p.volume),bid=number(p.marketDepth?.buy[0]?.price),ask=number(p.marketDepth?.sell[0]?.price);
   this.ticks.set(p.instrumentToken,{packet:p,price:price!==null&&price>0?price:null,oi:oi!==null&&oi>=0?oi:null,volume:volume!==null&&volume>=0?volume:null,bid:bid!==null&&bid>0?bid:null,ask:ask!==null&&ask>0?ask:null,close:number(p.close),observedAt:p.exchangeTimestamp||null,receivedAt,mode:p.mode});this.sequence++;
  }
 }
 revision(){return this.sequence;}
 /** Exact packet adapter reused for seller research; never infers depth from LTP. */
 sellerLeg(token:number,quantity:number){
  const entry=this.entries.get(token),tick=this.ticks.get(token);
  if(!entry||entry.role!=='OPTION'||!entry.symbol||!tick)return null;
  const registry=new KiteImmediateTokenRegistry([{instrumentToken:entry.token,symbol:entry.symbol,
   role:'OPTION',instrumentLabel:entry.label,expiry:entry.expiry,strike:entry.strike,optionSide:entry.side}]);
  const depth=mapKiteFullPacketToH1ExactDepth(tick.packet,registry,tick.receivedAt,quantity);
  return depth?{entry:{...entry},depth}:null;
 }

 private quote(e:LiveEntry|undefined,now:number){
   const t=e?this.ticks.get(e.token):null,age=t?now-Date.parse(t.observedAt||''):null,receiptAge=t?now-Date.parse(t.receivedAt):null;
   const fresh=!!t&&age!==null&&receiptAge!==null&&age>=-5000&&age<=30000&&receiptAge>=0&&receiptAge<=30000&&dateOf(now)===this.inventory.date;
   return {identity:e||null,price:fresh?t!.price:null,oi:fresh?t!.oi:null,volume:fresh?t!.volume:null,bid:fresh?t!.bid:null,ask:fresh?t!.ask:null,pdc:fresh?t!.close:null,changePct:fresh&&t!.price!==null&&t!.close!==null&&t!.close>0?(t!.price/t!.close-1)*100:null,state:!t?'WAITING':fresh?'LIVE':'STALE',observedAt:t?.observedAt||null,receivedAt:t?.receivedAt||null,ageMs:age};
 }

 /** Existing cache only; used to freeze the ATM reference at each OI snapshot. */
 spotQuote(symbol:string,now:number){
  return this.quote(this.inventory.entries.find(e=>e.role==='SPOT'&&e.symbol===symbol),now);
 }

 snapshot(now:number,selection:Partial<Record<LiveIndex,{expiry?:string;strike?:number}>>={}){
  const quote=(e:LiveEntry|undefined)=>this.quote(e,now);
  const all=this.inventory.entries;
  const indices=LIVE_INDICES.map(symbol=>{
   const spot=quote(all.find(e=>e.symbol===symbol&&e.role==='SPOT')),future=quote(all.find(e=>e.symbol===symbol&&e.role==='FUTURE'));
   const options=all.filter(e=>e.symbol===symbol&&e.role==='OPTION'),expiries=[...new Set(options.map(e=>e.expiry!))].sort();
   const requestedExpiry=selection[symbol]?.expiry;
   const expiry=requestedExpiry?(expiries.includes(requestedExpiry)?requestedExpiry:null):expiries[0]||null;
   const contracts=options.filter(e=>e.expiry===expiry),strikes=[...new Set(contracts.map(e=>e.strike!))].sort((a,b)=>a-b);
   const requested=selection[symbol]?.strike;
   const strike=requested!==undefined?(strikes.includes(requested)?requested:null):spot.price!==null?strikes.reduce<number|null>((best,k)=>best===null||Math.abs(k-spot.price!)<Math.abs(best-spot.price!)?k:best,null):null;
   const calls=contracts.filter(e=>e.side==='CE'),puts=contracts.filter(e=>e.side==='PE');
   const cq=calls.map(e=>({entry:e,quote:quote(e)})),pq=puts.map(e=>({entry:e,quote:quote(e)}));
   const usable=(q:ReturnType<typeof quote>)=>q.state==='LIVE'&&q.oi!==null;
   const covered=[...cq,...pq].filter(r=>usable(r.quote)).length;
   const sourceTimes=[...cq,...pq].filter(r=>usable(r.quote)).map(r=>Date.parse(r.quote.observedAt!));
   const synced=sourceTimes.length>0&&Math.max(...sourceTimes)-Math.min(...sourceTimes)<=30000;
   const complete=calls.length>0&&puts.length>0&&covered===contracts.length&&synced;
   const ceTotal=complete?cq.reduce((s,r)=>s+r.quote.oi!,0):null,peTotal=complete?pq.reduce((s,r)=>s+r.quote.oi!,0):null;
   const wall=(qs:typeof cq)=>{if(!complete)return null;const sorted=[...qs].sort((a,b)=>b.quote.oi!-a.quote.oi!||a.entry.strike!-b.entry.strike!);return sorted[0]?.quote.oi!>0?{strike:sorted[0].entry.strike,oi:sorted[0].quote.oi,tiedStrikes:sorted.filter(r=>r.quote.oi===sorted[0].quote.oi).map(r=>r.entry.strike)}:null;};
   return {symbol,spot,future,futuresBasis:spot.price!==null&&future.price!==null&&Math.abs(Date.parse(spot.observedAt!)-Date.parse(future.observedAt!))<=5000?future.price-spot.price:null,expiries,expiry,strikes,strike,
    ce:quote(contracts.find(e=>e.strike===strike&&e.side==='CE')),pe:quote(contracts.find(e=>e.strike===strike&&e.side==='PE')),
    pcrAt:complete?new Date(Math.max(...sourceTimes)).toISOString():null,pcrReceivedAt:complete?new Date(Math.max(...[...cq,...pq].map(r=>Date.parse(r.quote.receivedAt!)))).toISOString():null,fullPcr:ceTotal!==null&&ceTotal>0&&peTotal!==null?peTotal/ceTotal:null,ceTotal,peTotal,callWall:wall(cq),putWall:wall(pq),coverage:{expected:contracts.length,freshOi:covered,complete,sourceSkewMs:sourceTimes.length?Math.max(...sourceTimes)-Math.min(...sourceTimes):null},
    greeks:{iv:null,delta:null,gamma:null,theta:null,vega:null,state:'UNAVAILABLE_FROM_KITE_TICK'}};
  });
  return {runtimeId:this.runtimeId,sequence:this.sequence,asOf:new Date(now).toISOString(),tradeDate:this.inventory.date,indices,vix:quote(all.find(e=>e.role==='VIX')),participation:all.filter(e=>e.role==='STOCK'||e.role==='SECTOR').map(quote),missing:this.inventory.missing,omittedExpiries:this.inventory.omittedExpiries,source:'KITE_WEBSOCKET_FULL',persistence:'BOUNDED_LATEST_TOKEN_MEMORY',affectsExecution:false,affectsSelector:false,affectsTelegram:false,createsOrders:false};
 }
 /** Filter the existing token cache; no provider call or persistence. */
 premiums(now:number,filter:PremiumWatchFilter={}){
  const options=this.inventory.entries.filter(e=>e.role==='OPTION'&&(!filter.symbol||e.symbol===filter.symbol));
  const expiries=[...new Set(options.map(e=>e.expiry!))].sort(),strikes=[...new Set(options.map(e=>e.strike!))].sort((a,b)=>a-b);
  const dte=(e:LiveEntry)=>Math.round((Date.parse(e.expiry!+'T00:00:00Z')-Date.parse(this.inventory.date+'T00:00:00Z'))/86400000);
  const nearbyCache=new Map<string,Set<number>>();
  const nearby=(e:LiveEntry)=>{if(!filter.nearby||e.side==='CE'&&filter.ceStrike!==undefined||e.side==='PE'&&filter.peStrike!==undefined)return true;const spot=this.quote(this.inventory.entries.find(r=>r.role==='SPOT'&&r.symbol===e.symbol),now).price;if(spot===null)return false;const key=e.symbol+'|'+e.expiry;let allowed=nearbyCache.get(key);if(!allowed){const ks=[...new Set(options.filter(x=>x.symbol===e.symbol&&x.expiry===e.expiry).map(x=>x.strike!))].sort((a,b)=>a-b),atm=ks.reduce((a,k)=>Math.abs(k-spot)<Math.abs(a-spot)?k:a,ks[0]),at=ks.indexOf(atm);allowed=new Set(ks.slice(Math.max(0,at-filter.nearby),at+filter.nearby+1));nearbyCache.set(key,allowed);}return allowed.has(e.strike!);};
  const selected=options.filter(e=>nearby(e)&&(!filter.expiries?.length||filter.expiries.includes(e.expiry!))&&(!filter.side||e.side===filter.side)&&
   (filter.minDte===undefined||dte(e)>=filter.minDte)&&(filter.maxDte===undefined||dte(e)<=filter.maxDte)&&
   (e.side==='CE'?filter.ceStrike===undefined||e.strike===filter.ceStrike:filter.peStrike===undefined||e.strike===filter.peStrike))
   .sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol))||a.strike!-b.strike!||String(a.expiry).localeCompare(String(b.expiry))||String(a.side).localeCompare(String(b.side)));
  const offset=filter.offset||0,limit=Math.min(120,filter.limit||60);
  return {tradeDate:this.inventory.date,runtimeId:this.runtimeId,total:selected.length,offset,limit,expiries,strikes,
   rows:selected.slice(offset,offset+limit).map(e=>({...this.quote(e,now),dte:dte(e)})),omittedExpiries:this.inventory.omittedExpiries};
 }

}

export type PremiumWatchFilter={symbol?:LiveIndex;nearby?:number;expiries?:string[];side?:'CE'|'PE';ceStrike?:number;peStrike?:number;minDte?:number;maxDte?:number;offset?:number;limit?:number};
