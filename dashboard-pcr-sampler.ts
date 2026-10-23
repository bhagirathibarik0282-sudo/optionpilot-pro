import type { LiveEntry, LiveInventory } from './dashboard-live-feed.js';

export const PCR_REFRESH_MS = 60_000;
// Broker /quote accepts <=500 instruments, but long exchange:symbol values can exceed
// the HTTP request-target limit much earlier. Leave headroom for base URL and proxies.
export const PCR_MAX_QUOTE_KEYS = 500;
export const PCR_MAX_QUERY_CHARS = 6800;
/** Only partitions existing subscribed option identities; no universe expansion or new source. */
export function partitionPcrQuoteKeys(entries:LiveEntry[],maxKeys=PCR_MAX_QUOTE_KEYS,maxChars=PCR_MAX_QUERY_CHARS):string[][]{
 if(!Number.isInteger(maxKeys)||maxKeys<1||maxKeys>500||!Number.isInteger(maxChars)||maxChars<100)throw Error('INVALID_PCR_BATCH_LIMIT');
 const batches:string[][]=[];let current:string[]=[],size=0;
 for(const entry of entries){
  if(!entry.exchange||!entry.label)continue;
  const key=entry.exchange+':'+entry.label,part=new URLSearchParams([['i',key]]).toString(),extra=part.length+(current.length?1:0);
  if(part.length>maxChars)throw Error('PCR_QUOTE_IDENTITY_TOO_LONG');
  if(current.length&&(current.length>=maxKeys||size+extra>maxChars)){batches.push(current);current=[];size=0;}
  current.push(key);size+=part.length+(current.length>1?1:0);
 }
 if(current.length)batches.push(current);
 return batches;
}
const day = (at:number) => new Date(at + 19800000).toISOString().slice(0,10);
const finite = (v:unknown):v is number => typeof v === 'number' && Number.isFinite(v);
function quoteVolumes(entries:LiveEntry[],quotes:Record<string,any>){
 if(!entries.length||entries.some(e=>!['CE','PE'].includes(e.side||'')||!Number.isSafeInteger(quotes[e.exchange+':'+e.label]?.volume)||quotes[e.exchange+':'+e.label].volume<0))return null;
 const total=(side:string)=>entries.filter(e=>e.side===side).reduce((sum,e)=>sum+quotes[e.exchange+':'+e.label].volume,0);
 const ceTotal=total('CE'),peTotal=total('PE');if(!Number.isSafeInteger(ceTotal)||!Number.isSafeInteger(peTotal))return null;
 return {ceTotal,peTotal,expected:entries.length,value:ceTotal>0?peTotal/ceTotal:null};
}
// Kite's timezone-less quote timestamps are IST, never the host timezone.
export function quoteTime(value:unknown):number {
 if(typeof value !== 'string')return NaN;
 const at=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)?value.replace(' ','T')+'+05:30':value;
 return /(?:Z|[+-]\d{2}:\d{2})$/.test(at)?Date.parse(at):NaN;
}
/** Latest reported OI from one complete REST attempt. Mixed exchange times are
 * explicit; this is never the fresh/synchronised Full PCR or an alignment input. */
export function measureReportedPcr(entries:LiveEntry[],quotes:Record<string,any>,date:string,now:number){
 const first=entries[0],times:number[]=[],tokens=new Set<number>(),keys=new Set<string>(),ids=new Set<string>();
 let ce=0,pe=0,calls=0,puts=0;
 if(!first||day(now)!==date||!['NIFTY','SENSEX','BANKNIFTY'].includes(first.symbol||'')||!/^\d{4}-\d{2}-\d{2}$/.test(first.expiry||'')||String(first.expiry)<date||!Number.isFinite(Date.parse(first.expiry+'T00:00:00Z'))||new Date(first.expiry+'T00:00:00Z').toISOString().slice(0,10)!==first.expiry)return null;
 const open=Date.parse(date+'T09:15:00+05:30');
 for(const e of entries){
  const key=e.exchange+':'+e.label,q=quotes[key],at=quoteTime(q?.timestamp),id=e.strike+'|'+e.side;
  if(e.role!=='OPTION'||e.symbol!==first.symbol||e.expiry!==first.expiry||!e.exchange||!e.label||!Number.isInteger(e.token)||e.token<=0||!finite(e.strike)||e.strike<=0||!['CE','PE'].includes(e.side||'')||tokens.has(e.token)||keys.has(key)||ids.has(id)||q?.instrument_token!==e.token||!finite(q.oi)||q.oi<0||!Number.isFinite(at)||at<open||day(at)!==date||at>now+5000)return null;
  tokens.add(e.token);keys.add(key);ids.add(id);times.push(at);
  if(e.side==='CE'){ce+=q.oi;calls++;}else{pe+=q.oi;puts++;}
 }
 if(!calls||!puts||!finite(ce)||ce<=0||!finite(pe)||!finite(pe/ce))return null;
 const lo=Math.min(...times),hi=Math.max(...times);
 return {basis:'LATEST_REPORTED_MIXED_TIMESTAMPS',symbol:first.symbol,expiry:first.expiry,value:pe/ce,ceTotal:ce,peTotal:pe,volume:quoteVolumes(entries,quotes),expected:entries.length,reported:times.length,olderThan30s:times.filter(t=>now-t>30000).length,sourceMinAt:new Date(lo).toISOString(),sourceMaxAt:new Date(hi).toISOString(),checkedAt:new Date(now).toISOString()};
}
export function measurePcrSnapshot(entries:LiveEntry[],quotes:Record<string,any>,date:string,now:number,cycleStartedAt=now,spot?:any){
 let ce=0,pe=0;const times:number[]=[],missing:string[]=[],stale:string[]=[],invalid:string[]=[],calls:LiveEntry[]=[],puts:LiveEntry[]=[];
 const seen=new Set<string>();
 for(const e of entries){
  const key=e.exchange+':'+e.label,q=quotes[key],identity=e.strike+'|'+e.side;
  if(seen.has(identity)||!e.exchange||!finite(e.strike)||e.strike<=0||!['CE','PE'].includes(e.side||'')){invalid.push(key);continue;}seen.add(identity);
  if(!q){missing.push(key);continue;}
  if(q.instrument_token!==e.token||!finite(q.oi)||q.oi<0){invalid.push(key);continue;}
  const at=quoteTime(q.timestamp);
  if(!Number.isFinite(at)||day(at)!==date||now-at>30_000||at-now>5_000){stale.push(key);continue;}
  times.push(at);if(e.side==='CE'){ce+=q.oi;calls.push(e);}else{pe+=q.oi;puts.push(e);}
 }
 const skew=times.length?Math.max(...times)-Math.min(...times):null;
 const complete=entries.length>0&&times.length===entries.length&&calls.length>0&&puts.length>0&&skew!==null&&skew<=30_000&&day(now)===date&&Number.isFinite(ce)&&Number.isFinite(pe);
 const wall=(rows:LiveEntry[])=>{if(!complete)return null;const sorted=[...rows].sort((a,b)=>quotes[b.exchange+':'+b.label].oi-quotes[a.exchange+':'+a.label].oi||a.strike!-b.strike!),first=sorted[0],oi=quotes[first.exchange+':'+first.label].oi;return oi>0?{strike:first.strike,oi,tiedStrikes:sorted.filter(e=>quotes[e.exchange+':'+e.label].oi===oi).map(e=>e.strike)}:null;};
 // ATM +/-7 listed strikes = 15 strikes, not a seven-strike or full-chain ratio.
 // Anchor is frozen with this completed OI snapshot, never moved by later ticks.
 const bandPcr:any={state:'INCOMPLETE',value:null,halfWidth:7,strikeCount:15,anchorStrike:null,fromStrike:null,toStrike:null,ceTotal:null,peTotal:null,expected:30,freshOi:0,anchorAt:null};
 const spotAt=quoteTime(spot?.observedAt),receipt=quoteTime(spot?.receivedAt);
 const spotOk=day(now)===date&&spot?.state==='LIVE'&&spot.identity?.role==='SPOT'&&spot.identity.symbol===entries[0]?.symbol&&finite(spot.price)&&spot.price>0&&Number.isFinite(spotAt)&&day(spotAt)===date&&now-spotAt>=-5000&&now-spotAt<=30000&&Number.isFinite(receipt)&&day(receipt)===date&&now-receipt>=0&&now-receipt<=30000;
 if(spotOk){
  const strikes=[...new Set(entries.map(e=>e.strike!).filter(k=>finite(k)&&k>0))].sort((a,b)=>a-b);
  const anchor=strikes.reduce((best,k)=>Math.abs(k-spot.price)<Math.abs(best-spot.price)?k:best,strikes[0]),index=strikes.indexOf(anchor);
  bandPcr.anchorStrike=anchor;bandPcr.anchorAt=new Date(spotAt).toISOString();
  if(index>=7&&index+7<strikes.length){
   const allowed=new Set(strikes.slice(index-7,index+8)),band=entries.filter(e=>allowed.has(e.strike!));
   const bandCe=band.filter(e=>e.side==='CE'),bandPe=band.filter(e=>e.side==='PE');
   const sum=(xs:LiveEntry[])=>xs.reduce((total,e)=>total+(quotes[e.exchange+':'+e.label]?.oi??NaN),0);
   const ceTotal=sum(bandCe),peTotal=sum(bandPe);
   const bandTimes=band.map(e=>quoteTime(quotes[e.exchange+':'+e.label]?.timestamp));
   const validBand=band.every(e=>{const q=quotes[e.exchange+':'+e.label],t=quoteTime(q?.timestamp);return e.role==='OPTION'&&e.symbol===entries[0]?.symbol&&e.expiry===entries[0]?.expiry&&q?.instrument_token===e.token&&finite(q.oi)&&q.oi>=0&&Number.isFinite(t)&&day(t)===date&&now-t>=-5000&&now-t<=30000;});
   if(band.length===30&&bandCe.length===15&&bandPe.length===15&&new Set(band.map(e=>e.strike+'|'+e.side)).size===30&&new Set(band.map(e=>e.token)).size===30&&validBand&&Math.max(...bandTimes,spotAt)-Math.min(...bandTimes,spotAt)<=30000&&finite(ceTotal)&&ceTotal>0&&finite(peTotal)&&peTotal>=0){
    Object.assign(bandPcr,{state:'COMPLETE',value:peTotal/ceTotal,fromStrike:strikes[index-7],toStrike:strikes[index+7],strikes:[...allowed],membershipKey:band.map(e=>[e.token,e.strike,e.side].join(':')).sort().join('|'),volume:quoteVolumes(band,quotes),ceTotal,peTotal,freshOi:30,sourceMinAt:new Date(Math.min(...bandTimes)).toISOString(),sourceMaxAt:new Date(Math.max(...bandTimes)).toISOString()});
   }
  }
 }
 // Exact contracts from this already fetched batch; never backfill missing rows.
 const strikeRows=complete?entries.map(e=>{
  const q=quotes[e.exchange+':'+e.label],tradeAt=quoteTime(q.last_trade_time);
  const priceOk=finite(q.last_price)&&q.last_price>0&&Number.isFinite(tradeAt)&&day(tradeAt)===date&&now-tradeAt>=-5000&&now-tradeAt<=30000;
  return {symbol:e.symbol,expiry:e.expiry,strike:e.strike,side:e.side,token:e.token,oi:q.oi,sourceAt:new Date(quoteTime(q.timestamp)).toISOString(),price:priceOk?q.last_price:null,priceAt:priceOk?new Date(tradeAt).toISOString():null};
 }):[];
 const reason=!entries.length?'NO_OPTION_INVENTORY':invalid.length?'INVALID_IDENTITY_OR_OI':missing.length?'MISSING_QUOTES':stale.length?'STALE_OI_TIMESTAMPS':skew!==null&&skew>30000?'OI_TIME_SKEW':ce<=0?'CE_OI_ZERO':complete?'COMPLETE':'INCOMPLETE';
 return {state:complete&&ce>0?'COMPLETE':'INCOMPLETE',reason,reportedPcr:measureReportedPcr(entries,quotes,date,now),volume:complete?quoteVolumes(entries,quotes):null,fullPcr:complete&&ce>0?pe/ce:null,ceTotal:complete?ce:null,peTotal:complete?pe:null,bandPcr,strikeRows,callWall:wall(calls),putWall:wall(puts),coverage:{expected:entries.length,freshOi:times.length,complete,sourceSkewMs:skew,missing:missing.length,stale:stale.length,invalid:invalid.length},
  // Bounded diagnostics, no credentials or raw broker responses.
  unavailable:[...missing.map(identity=>({identity,reason:'MISSING'})),...stale.map(identity=>({identity,reason:'STALE_TIMESTAMP'})),...invalid.map(identity=>({identity,reason:'INVALID_IDENTITY_OR_OI'}))].slice(0,12),
  sourceMinAt:times.length?new Date(Math.min(...times)).toISOString():null,sourceMaxAt:times.length?new Date(Math.max(...times)).toISOString():null,checkedAt:new Date(now).toISOString(),cycleStartedAt:new Date(cycleStartedAt).toISOString(),source:'KITE_REST_FULL_EXPIRY_SNAPSHOT'};
}
export class DashboardPcrSampler {
 private lastDiagnostic='';private lastDiagnosticAt=0;
 private busy=false;private due=0;private revision=0;private results=new Map<string,ReturnType<typeof measurePcrSnapshot>&{fetchState:string;batchesRequested:number;batchesCompleted:number}>();
 constructor(readonly inventory:LiveInventory,private deps:{now():number;active():boolean;fetchQuotes(keys:string[]):Promise<Record<string,any>>;wait(ms:number):Promise<void>;readSpot?(symbol:string):any;onDiagnostic?(summary:any):void}){}
 async tick(){
  const now=this.deps.now();if(this.busy||now<this.due||!this.deps.active()||day(now)!==this.inventory.date)return;
  this.busy=true;this.due=now+PCR_REFRESH_MS;
  const entries=this.inventory.entries.filter(e=>e.role==='OPTION'),quotes:Record<string,any>={};
  let fetchState='OK',batchesRequested=0,batchesCompleted=0;
  const completedAt=new Map<string,number>(),completedSpot=new Map<string,any>();
  try{
   // Sequential requests at <=1 req/s, with bounded encoded URL size as well as count.
   // Never retry 429 or borrow a quote from a previous cycle.
   const batches=partitionPcrQuoteKeys(entries);
   // Close an expiry's freshness clock at its last quote batch, not after
   // unrelated later expiries finish downloading.
   const quoteGroup=new Map(entries.map(e=>[e.exchange+':'+e.label,e.symbol+'|'+e.expiry]));
   const lastBatch=new Map<string,number>();
   batches.forEach((keys,i)=>keys.forEach(key=>{const group=quoteGroup.get(key);if(group)lastBatch.set(group,i);}));
   for(const [i,keys] of batches.entries()){
    if(batchesRequested)await this.deps.wait(1100);if(!this.deps.active())return;
    batchesRequested++;Object.assign(quotes,await this.deps.fetchQuotes(keys));batchesCompleted++;
    for(const [group,last] of lastBatch)if(last===i){
     completedAt.set(group,this.deps.now());
     try{completedSpot.set(group,this.deps.readSpot?.(group.split('|')[0]));}catch{/* Band stays unavailable without matching spot. */}
    }
   }
  }catch(error){
   const code=error instanceof Error?error.message:'';
   fetchState=code==='PCR_QUOTE_HTTP_429'?'RATE_LIMITED':
    code==='PCR_QUOTE_HTTP_414'||code==='PCR_QUOTE_HTTP_400'?'REQUEST_REJECTED':
    code==='PCR_QUOTE_HTTP_401'||code==='PCR_QUOTE_HTTP_403'?'SESSION_REQUIRED':
    code==='PCR_QUOTE_IDENTITY_TOO_LONG'?'IDENTITY_TOO_LONG':'UPSTREAM_UNAVAILABLE';
   // Fail closed on partial REST cycles. The following regular cycle is the retry.
  }finally{
   if(this.deps.active()){
    const keys=[...new Set(entries.map(e=>e.symbol+'|'+e.expiry))],at=this.deps.now();
    for(const key of keys){
     const group=entries.filter(e=>e.symbol+'|'+e.expiry===key);let spot:any=completedSpot.get(key)??null;
     if(!completedAt.has(key))try{spot=this.deps.readSpot?.(group[0].symbol!);}catch{/* Missing cache reference only withholds band PCR. */}
     const measured=measurePcrSnapshot(group,quotes,this.inventory.date,completedAt.get(key)??at,now,spot);
     // A later failed batch invalidates the entire attempt; never publish
     // an earlier expiry from a partially failed REST cycle.
     const result=fetchState==='OK'?measured:{...measured,state:'INCOMPLETE',reason:'INCOMPLETE',reportedPcr:null,volume:null,fullPcr:null,ceTotal:null,peTotal:null,bandPcr:null,strikeRows:[],callWall:null,putWall:null,coverage:{...measured.coverage,complete:false}};
     // No network errors are surfaced verbatim (credentials and URLs are excluded).
     this.results.set(key,{...result,fetchState,batchesRequested,batchesCompleted});
    }
    this.revision++;
    const rows=[...this.results].map(([identity,q])=>({identity,state:q.state,reason:q.reason,fetchState:q.fetchState,coverage:q.coverage,unavailable:q.unavailable.slice(0,2)}));
    const signature=JSON.stringify(rows);
    if(signature!==this.lastDiagnostic||at-this.lastDiagnosticAt>=300000){
     this.lastDiagnostic=signature;this.lastDiagnosticAt=at;
     try{this.deps.onDiagnostic?.({checkedAt:new Date(at).toISOString(),batchesRequested,batchesCompleted,rows});}catch{/* A log sink must not break quote collection. */}
    }
   }
   this.busy=false;
  }
 }
 read(symbol:string,expiry:string|null){
  const result=this.results.get(symbol+'|'+expiry);if(!result)return null;
  if(this.deps.now()-Date.parse(result.checkedAt)>90_000||day(this.deps.now())!==this.inventory.date)return {...result,state:'STALE',reason:'PCR_SNAPSHOT_STALE',reportedPcr:null,volume:null,fullPcr:null,ceTotal:null,peTotal:null,bandPcr:null,strikeRows:[],callWall:null,putWall:null,coverage:{...result.coverage,complete:false}};
  return result;
 }
 version(){return this.revision;}
}
