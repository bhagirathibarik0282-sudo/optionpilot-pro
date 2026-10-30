import {indianTradingDateAt,indianEquityMarketPhaseAt} from './market-session-calendar.js';
import {dueWindows,renderWindow,renderSummary,renderEod,type MinuteFrame} from './telegram-ladder-v4.js';
import {reportJob,deliverLadderJob,type Job,type LadderOutbox,type DeliveryPart,type TransportResult} from './telegram-ladder-outbox.js';

type Store=LadderOutbox&{pending:(prefix?:string)=>Promise<{job:Job;nextPart:number}[]>};
/** Called by an existing runtime timer. Shadow by default; no timer, pool, transport or cutover is created here.
 * Cache holds at most one session (376 buckets); catch-up reads at most 15 buckets per tick.
 */
export function createLadderRuntime(deps:{
  read:(r:{date:string;from:string;to:string})=>Promise<{frames:MinuteFrame[];failures:string[]}>;
  mode?:'SHADOW'|'DELIVER';activateAt:number;destinationKey:string;
  store?:Store;send?:(part:DeliveryPart)=>Promise<TransportResult>;
  preview?:(job:Job)=>Promise<void>;
}) {
  if(!Number.isFinite(deps.activateAt)||deps.activateAt%60_000||! /^-?[1-9]\d*$/.test(deps.destinationKey))throw Error('INVALID_LADDER_ACTIVATION');
  if(deps.mode==='DELIVER'&&(!deps.store||!deps.send))throw Error('LADDER_DELIVERY_DEPENDENCIES_REQUIRED');
  let busy=false,date='',lastMinute=-1,through=0;
  const cache=new Map<string,MinuteFrame>(),completed=new Set<string>();
  return {async tick(now:number) {
    if(!Number.isFinite(now)||now<deps.activateAt)return {state:'DISABLED'};
    const current=indianTradingDateAt(new Date(now)),phase=indianEquityMarketPhaseAt(new Date(now));
    if(!current.startsWith('2026-')||phase==='HOLIDAY'||phase==='WEEKEND')return {state:'CLOSED_CALENDAR'};
    const open=Date.parse(current+'T09:15:00+05:30'),close=open+375*60_000;
    if(now<open+60_000||now>Date.parse(current+'T16:15:00+05:30'))return {state:'OUTSIDE_REPORT_WINDOW'};
    const minute=Math.floor(now/60_000);
    if(busy||minute===lastMinute)return {state:'SKIPPED'};
    busy=true;
    try {
      if(date!==current){date=current;cache.clear();completed.clear();through=open-60_000;}
      const closed=Math.min(close,(minute-1)*60_000);
      let failures:string[]=[];
      if(through<closed) {
        const from=through+60_000,to=Math.min(closed,from+14*60_000);
        const result=await deps.read({date,from:new Date(from).toISOString(),to:new Date(to).toISOString()});
        const seen=new Set<string>();
        for(const f of result.frames){const t=Date.parse(f.minute);if(!Number.isFinite(t)||t%60_000||t<from||t>to||seen.has(f.minute))throw Error('INVALID_SOURCE_BUCKET');seen.add(f.minute);}
        for(const f of result.frames)cache.set(f.minute,structuredClone(f));
        through=to;failures=result.failures;
      }
      const frames=[...cache.values()],jobs:Job[]=[];
      for(const w of dueWindows(date,now)) {
        // Start at an explicit deployment boundary; do not flood old intraday reports on activation.
        if(Date.parse(w.to)>through||Date.parse(w.from)<deps.activateAt)continue;
        const id=`LADDER_V4|${deps.destinationKey}|${date}|${w.timeframe}|${w.from}|${w.to}`;
        if(!completed.has(id))jobs.push(reportJob(id,renderWindow(frames,w),renderSummary(frames,w)));
      }
      if(through===close&&now>=Date.parse(date+'T16:00:00+05:30')) {
        const id=`LADDER_V4|${deps.destinationKey}|${date}|EOD`;
        if(!completed.has(id))jobs.push(reportJob(id,renderEod(frames,date),renderSummary(frames,{date,from:new Date(open).toISOString(),to:new Date(close).toISOString(),timeframe:'EOD',partial:false})));
      }
      for(const job of jobs) {
        if(deps.mode==='DELIVER')await deps.store!.putIfAbsent(job);
        else await deps.preview?.(job);
        completed.add(job.id);
      }
      let delivery='NONE';
      if(deps.mode==='DELIVER') {
        const prefix=`LADDER_V4|${deps.destinationKey}|${date}|`;
        // 547 normal-session jobs cannot drain at one job per minute. Bound each
        // pass to three jobs, stopping immediately on a retry or ambiguous result.
        for(let n=0;n<3;n++) {
          const next=(await deps.store!.pending(prefix)).find(p=>p.job.id.startsWith(prefix));
          if(!next)break;
          delivery=await deliverLadderJob(deps.store!,next.job,deps.send!,next.nextPart);
          if(delivery!=='ACKED')break;
        }
      }
      lastMinute=minute;
      return {state:deps.mode==='DELIVER'?'DELIVERY_TICK':'SHADOW_TICK',planned:jobs.length,cached:cache.size,through,failures,delivery};
    }finally{busy=false;}
  }};
}
