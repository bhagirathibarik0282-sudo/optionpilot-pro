import {framesFromH1} from './telegram-ladder-recorder-adapter.js';
import {SYMBOLS,type MinuteFrame} from './telegram-ladder-v4.js';
import type {H1ReplayRequest,H1ReplayHttpResult} from './h1-replay-http.js';

const M=60_000;
type Range={date:string;from:string;to:string};
/** One bounded retry for failed reads; validation failures are not retried. */
async function retryRead<T>(read:()=>Promise<T>,accepted:(result:T)=>boolean=()=>true):Promise<T> {
  try {const result=await read();if(accepted(result))return result;}catch{/* Retry only this source once. */}
  return read();
}
/** One bounded read, using the existing replay and participation readers. No timers or sockets. */
export function createLadderRecorderSource(deps:{
  replay:(r:H1ReplayRequest)=>Promise<H1ReplayHttpResult>;
  participation:(r:Range)=>Promise<any[]>;
}) {
  return async function read(range:Range):Promise<{frames:MinuteFrame[];failures:string[]}> {
    const start=Date.parse(range.from),end=Date.parse(range.to);
    const open=Date.parse(range.date+'T09:15:00+05:30'),close=Date.parse(range.date+'T15:30:00+05:30');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(range.date)||!Number.isFinite(open)||new Date(open+330*M).toISOString().slice(0,10)!==range.date||!Number.isFinite(start)||!Number.isFinite(end)
      ||!/(Z|[+-]\d{2}:\d{2})$/.test(range.from)||!/(Z|[+-]\d{2}:\d{2})$/.test(range.to)
      ||start%M||end%M||start<open||end>close||end<start||end-start>14*M)throw Error('INVALID_BOUNDED_LADDER_RANGE');
    const clock=(n:number)=>new Date(n+330*M).toISOString().slice(11,16);
    const results=await Promise.allSettled(SYMBOLS.map(symbol=>retryRead(()=>deps.replay({symbol,tradeDate:range.date,fromTime:clock(start),toTime:clock(end),scope:'FULL'}),result=>result.ok===true)));
    const failures:string[]=[],frames=new Map<string,MinuteFrame>();
    function merge(xs:MinuteFrame[]) {
      // Validate the whole result before adding any of it, so malformed sources are isolated.
      for(const f of xs)if(Date.parse(f.minute)<start||Date.parse(f.minute)>end)throw Error('SOURCE_OUTSIDE_REQUEST');
      for(const f of xs){const old=frames.get(f.minute);if(old){old.indices.push(...f.indices);old.participation.push(...f.participation);}else frames.set(f.minute,f);}
    }
    for(let i=0;i<results.length;i++) {
      const r=results[i];
      try {
        if(r.status!=='fulfilled'||!r.value.ok)throw Error('REPLAY_UNAVAILABLE');
        const request=r.value.request;
        if(!request||request.symbol!==SYMBOLS[i]||request.tradeDate!==range.date||request.scope!=='FULL'
          ||request.fromTime!==clock(start)||request.toTime!==clock(end))throw Error('SOURCE_REQUEST_MISMATCH');
        if([...(r.value.market??[]),...(r.value.options??[]),...(r.value.chain??[])].some(row=>row.symbol!==SYMBOLS[i]))throw Error('SOURCE_SYMBOL_MISMATCH');
        merge(framesFromH1([r.value]));
      }catch{failures.push(SYMBOLS[i]+'_SOURCE_UNAVAILABLE');}
    }
    try{merge(framesFromH1([],await retryRead(()=>deps.participation(range))));}catch{failures.push('PARTICIPATION_SOURCE_UNAVAILABLE');}
    return {frames:[...frames.values()].sort((a,b)=>a.minute.localeCompare(b.minute)),failures};
  };
}
