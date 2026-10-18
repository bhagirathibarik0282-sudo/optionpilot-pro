import { createHash } from 'node:crypto';
import type { H1ReplayHttpResult } from './h1-replay-http.js';
import { resolveIndexExpiryClock } from './index-expiry-clock.js';

export type SameDteSelection = { symbol:string; date:string; expiry:string; strike:number; side:'CE'|'PE'; timeIst:string; asOf:number };
const n=(v:unknown)=> typeof v==='number'||typeof v==='string'&&v.trim()!=='' ? (Number.isFinite(Number(v))?Number(v):null):null;
const ms=(v:unknown)=>v instanceof Date?v.getTime():Date.parse(String(v??''));
const date=(v:unknown)=>{if(v instanceof Date)return Number.isFinite(v.getTime())?v.toISOString().slice(0,10):null;const raw=String(v??''),s=raw.slice(0,10),t=Date.parse(s+'T00:00:00Z');if(raw.length!==10&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)||!Number.isFinite(Date.parse(raw))))return null;return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null;};
const istDay=(t:number)=>new Date(t+19800000).toISOString().slice(0,10);
const unique=(rows:Record<string,unknown>[])=>{const u=new Map(rows.map(r=>[JSON.stringify(r),r]));return u.size===1?[...u.values()][0]:null;};
const safety={readOnly:true,writesPerformed:false,affectsSelector:false,affectsVerdict:false,affectsTelegram:false,affectsExecution:false};

/** Exact recorded 3m endpoints. No interpolation, outcomes, model Greeks, or synthetic score. */
function pair(replay:H1ReplayHttpResult,s:SameDteSelection,day:string,expiry:string,strike:number,cutoff:number){
 if(!replay.ok||replay.request?.symbol!==s.symbol||replay.request.tradeDate!==day)return null;
 const end=Date.parse(day+'T'+s.timeIst+':00+05:30');
 const points=[end-180000,end].map(t=>{
  const m=unique((replay.market??[]).filter(r=>r.symbol===s.symbol&&ms(r.minute_bucket)===t));
  const q=unique((replay.options??[]).filter(r=>r.symbol===s.symbol&&date(r.expiry)===expiry&&n(r.strike)===strike&&r.option_type===s.side&&ms(r.minute_bucket)===t));
  if(!m||!q||m.truth_verdict!=='TRUE'||q.truth_verdict!=='TRUE'||!m.snapshot_id||m.snapshot_id!==q.snapshot_id)return null;
  const receipt=ms(m.backend_timestamp),quote=ms(q.quote_timestamp),price=n(q.ltp),spot=n(m.spot_ltp);
  if(!Number.isFinite(receipt)||!Number.isFinite(quote)||istDay(receipt)!==day||istDay(quote)!==day||receipt<t||receipt-t>30000||receipt-quote< -5000||receipt-quote>30000||Math.max(t,receipt,quote)>cutoff||price===null||price<=0||spot===null||spot<=0)return null;
  return {bucketAt:new Date(t).toISOString(),receiptAt:new Date(receipt).toISOString(),quoteAt:new Date(quote).toISOString(),snapshotId:String(q.snapshot_id),price,spot};
 });
 if(!points[0]||!points[1])return null;
 const [before,at]=points;
 const clock=resolveIndexExpiryClock(s.symbol,expiry,end);
 if(!clock||clock.expired)return null;
 return {date:day,expiry,strike,side:s.side,before,at,calendarDte:(Date.parse(expiry)-Date.parse(day))/86400000,
  moneynessBps:(strike/at.spot-1)*10000,premiumChange:at.price-before.price,premiumChangePercent:(at.price/before.price-1)*100,
  spotChange:at.spot-before.spot,clock:{closeIst:clock.closeIst,rule:clock.rule,minutesToExpiry:clock.minutesToExpiry,standardSessionOnly:true}};
}

export function compareSameDteHistory(s:SameDteSelection,current:H1ReplayHttpResult,history:H1ReplayHttpResult[]){
 const base={mode:'READ_ONLY_SAME_DTE_HISTORY_V1',safety};
 const fail=(reason:string)=>({...base,ok:false,status:'BLOCKED',reason});
 if(!date(s.date)||!date(s.expiry)||!Number.isFinite(s.asOf)||!Number.isFinite(s.strike)||s.strike<=0||!['CE','PE'].includes(s.side)||!/^\d{2}:\d{2}$/.test(s.timeIst))return fail('INVALID_SELECTION');
 const minute=Number(s.timeIst.slice(0,2))*60+Number(s.timeIst.slice(3));
 // Deliberately bounded to the audited common regular-session grid.
 if(minute<558||minute>930||(minute-555)%3!==0)return fail('EXACT_REGULAR_3M_PAIR_REQUIRED');
 const anchor=pair(current,s,s.date,s.expiry,s.strike,s.asOf);
 if(!anchor)return fail('ANCHOR_PAIR_UNAVAILABLE_AT_CUTOFF');
 const cutoff=Math.min(s.asOf,ms(anchor.at.receiptAt));
 const groups=new Map<string,H1ReplayHttpResult[]>();
 for(const replay of history){const d=replay.request?.tradeDate;if(d&&date(d)&&d<s.date){const g=groups.get(d)??[];g.push(replay);groups.set(d,g);}}
 const matches: Array<NonNullable<ReturnType<typeof pair>>&{moneynessDifferenceBps:number}>=[],blocked:Array<{date:string;reason:string}>=[];
 for(const [d,replays] of groups){
  // Never silently choose one of several conflicting day reads.
  if(replays.length!==1){blocked.push({date:d,reason:'DUPLICATE_DAY_SOURCE'});continue;}
  const replay=replays[0],identities=new Map<string,{expiry:string;strike:number}>();
  for(const q of replay.options??[]){const e=date(q.expiry),k=n(q.strike);if(q.symbol===s.symbol&&q.option_type===s.side&&e&&k!==null&&k>0&&(Date.parse(e)-Date.parse(d))/86400000===anchor.calendarDte)identities.set(e+':'+k,{expiry:e,strike:k});}
  const accepted=[...identities.values()].map(i=>pair(replay,s,d,i.expiry,i.strike,cutoff)).filter((p):p is NonNullable<typeof p>=>!!p&&p.clock.closeIst===anchor.clock.closeIst);
  accepted.sort((a,b)=>Math.abs(a.moneynessBps-anchor.moneynessBps)-Math.abs(b.moneynessBps-anchor.moneynessBps)||a.strike-b.strike||a.expiry.localeCompare(b.expiry));
  if(!accepted.length){blocked.push({date:d,reason:'NO_VERIFIED_SAME_DTE_CLOCK_PAIR'});continue;}
  matches.push({...accepted[0],moneynessDifferenceBps:accepted[0].moneynessBps-anchor.moneynessBps});
 }
 matches.sort((a,b)=>b.date.localeCompare(a.date));
 const evidence={anchor,matches};
 return {...base,ok:true,status:matches.length?'PARTIAL':'UNAVAILABLE',anchor,matches,blocked,cutoff:new Date(cutoff).toISOString(),
  coverage:{suppliedPriorDays:groups.size,matchedDays:matches.length},
  selectionMethod:'ONE_CONTRACT_PER_DAY_CLOSEST_OBSERVED_STRIKE_TO_SPOT_RATIO; SAME_INDEX_SIDE_CALENDAR_DTE_IST_MINUTE_CLOSE_CLOCK',
  provenance:{selectedEvidenceSha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')},
  limitations:['Descriptive comparison only; no candidate, probability, causality or profitability claim.',
   'Closest recorded moneyness is not a validated similarity threshold; differences remain visible.',
   'IV, liquidity, event regime, OI, PCR and wall context are not matched in this stage.',
   'Standard-session model expiry clock; contract-master and special-session validation unavailable.',
   'No future outcomes retrieved; supplied days and recorded contracts are not exhaustive.']};
}
