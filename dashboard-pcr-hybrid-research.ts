import type { LiveEntry } from './dashboard-live-feed.js';
type Row={token:number;responseToken:number|null;symbol?:string;expiry?:string;strike?:number;side?:string;oi:number|null;sourceAt:string|null;batchReceivedAt:string|null};
const day=(t:number)=>new Date(t+19800000).toISOString().slice(0,10);
const time=(s:string|null)=>s?Date.parse(s):NaN;
/** Research only: same-clock comparison, no cache mutation or trading consumer. */
export function comparePcrCaches(entries:LiveEntry[],rest:Row[],ws:Row[],date:string,now:number){
 const open=Date.parse(date+'T09:15:00+05:30');
 const index=(rows:Row[])=>{const m=new Map<number,Row[]>();for(const r of rows){const a=m.get(r.token)||[];a.push(r);m.set(r.token,a);}return m;};
 const rm=index(rest),wm=index(ws),first=entries[0];
 const identityOk=!!first&&entries.length>0&&new Set(entries.map(e=>e.token)).size===entries.length&&new Set(entries.map(e=>e.strike+'|'+e.side)).size===entries.length&&entries.every(e=>e.role==='OPTION'&&e.symbol===first.symbol&&e.expiry===first.expiry&&Number.isSafeInteger(e.token)&&e.token>0&&Number.isFinite(e.strike)&&e.strike!>0&&['CE','PE'].includes(e.side||''));
 const valid=(e:LiveEntry,rows:Row[]|undefined)=>{
  if(rows?.length!==1)return null;const r=rows[0],at=time(r.sourceAt),receipt=time(r.batchReceivedAt);
  return r.responseToken===e.token&&r.symbol===e.symbol&&r.expiry===e.expiry&&r.strike===e.strike&&r.side===e.side&&typeof r.oi==='number'&&Number.isFinite(r.oi)&&r.oi>=0&&Number.isFinite(at)&&Number.isFinite(receipt)&&at>=open&&day(at)===date&&day(receipt)===date&&now-at>=-5000&&now-at<=30000&&now-receipt>=0&&now-receipt<=30000&&at-receipt<=5000?{oi:r.oi,at}:null;
 };
 let both=0,restOnly=0,wsOnly=0,neither=0,sameTimestampConflict=0,differentTimestampOi=0,ce=0,pe=0;
 const times:number[]=[];
 if(identityOk&&Number.isFinite(now)&&day(now)===date&&now>=open)for(const e of entries){
  const r=valid(e,rm.get(e.token)),w=valid(e,wm.get(e.token));
  if(r&&w){both++;if(r.oi!==w.oi){if(r.at===w.at){sameTimestampConflict++;continue;}differentTimestampOi++;}}
  else if(r)restOnly++;else if(w)wsOnly++;else{neither++;continue;}
  const q=r&&w?(w.at>r.at?w:r):(r||w)!;times.push(q.at);if(e.side==='CE')ce+=q.oi;else pe+=q.oi;
 }
 const skew=times.length?Math.max(...times)-Math.min(...times):null;
 const complete=identityOk&&rest.length===entries.length&&rm.size===entries.length&&times.length===entries.length&&sameTimestampConflict===0&&skew!==null&&skew<=30000&&Number.isFinite(ce)&&ce>0&&Number.isFinite(pe)&&entries.some(e=>e.side==='PE');
 return {researchOnly:true,expected:entries.length,restFresh:both+restOnly,wsFresh:both+wsOnly,both,restOnly,wsOnly,neither,sameTimestampConflict,differentTimestampOi,hybridFresh:times.length,sourceSkewMs:skew,complete,pcr:complete?pe/ce:null};
}
