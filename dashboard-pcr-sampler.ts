import type { LiveEntry, LiveInventory } from './dashboard-live-feed.js';

export const PCR_REFRESH_MS = 60_000;
const day = (at:number) => new Date(at + 19800000).toISOString().slice(0,10);
const finite = (v:unknown):v is number => typeof v === 'number' && Number.isFinite(v);
// Kite's timezone-less quote timestamps are IST, never the host timezone.
export function quoteTime(value:unknown):number {
 if(typeof value !== 'string')return NaN;
 const at=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)?value.replace(' ','T')+'+05:30':value;
 return /(?:Z|[+-]\d{2}:\d{2})$/.test(at)?Date.parse(at):NaN;
}
export function measurePcrSnapshot(entries:LiveEntry[],quotes:Record<string,any>,date:string,now:number,cycleStartedAt=now){
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
 return {state:complete&&ce>0?'COMPLETE':'INCOMPLETE',fullPcr:complete&&ce>0?pe/ce:null,ceTotal:complete?ce:null,peTotal:complete?pe:null,callWall:wall(calls),putWall:wall(puts),coverage:{expected:entries.length,freshOi:times.length,complete,sourceSkewMs:skew,missing:missing.length,stale:stale.length,invalid:invalid.length},
  // Bounded diagnostics, no credentials or raw broker responses.
  unavailable:[...missing.map(identity=>({identity,reason:'MISSING'})),...stale.map(identity=>({identity,reason:'STALE_TIMESTAMP'})),...invalid.map(identity=>({identity,reason:'INVALID_IDENTITY_OR_OI'}))].slice(0,12),
  sourceMinAt:times.length?new Date(Math.min(...times)).toISOString():null,sourceMaxAt:times.length?new Date(Math.max(...times)).toISOString():null,checkedAt:new Date(now).toISOString(),cycleStartedAt:new Date(cycleStartedAt).toISOString(),source:'KITE_REST_FULL_EXPIRY_SNAPSHOT'};
}
export class DashboardPcrSampler {
 private busy=false;private due=0;private revision=0;private results=new Map<string,ReturnType<typeof measurePcrSnapshot>>();
 constructor(readonly inventory:LiveInventory,private deps:{now():number;active():boolean;fetchQuotes(keys:string[]):Promise<Record<string,any>>;wait(ms:number):Promise<void>}){}
 async tick(){
  const now=this.deps.now();if(this.busy||now<this.due||!this.deps.active()||day(now)!==this.inventory.date)return;
  this.busy=true;this.due=now+PCR_REFRESH_MS;
  const entries=this.inventory.entries.filter(e=>e.role==='OPTION'),quotes:Record<string,any>={};
  try{
   // At most 3,000 subscribed tokens, six sequential requests per minute/process.
   // No retries on 429; the next regular cycle is the retry.
   for(let i=0;i<entries.length;i+=500){
    if(i)await this.deps.wait(1100);if(!this.deps.active())return;
    const keys=entries.slice(i,i+500).filter(e=>e.exchange).map(e=>e.exchange+':'+e.label);
    if(keys.length)Object.assign(quotes,await this.deps.fetchQuotes(keys));
   }
  }catch{ /* Publish incomplete coverage, never retain a prior cycle as current. */ }
  finally{
   if(this.deps.active()){
    const keys=[...new Set(entries.map(e=>e.symbol+'|'+e.expiry))],at=this.deps.now();
    for(const key of keys)this.results.set(key,measurePcrSnapshot(entries.filter(e=>e.symbol+'|'+e.expiry===key),quotes,this.inventory.date,at,now));
    this.revision++;
   }
   this.busy=false;
  }
 }
 read(symbol:string,expiry:string|null){
  const result=this.results.get(symbol+'|'+expiry);if(!result)return null;
  if(this.deps.now()-Date.parse(result.checkedAt)>90_000||day(this.deps.now())!==this.inventory.date)return {...result,state:'STALE',fullPcr:null,ceTotal:null,peTotal:null,callWall:null,putWall:null,coverage:{...result.coverage,complete:false}};
  return result;
 }
 version(){return this.revision;}
}
