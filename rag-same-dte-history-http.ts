import type { Hono } from 'hono';
import { parseRagEventRequest } from './rag-event-evidence.js';
import { runH1ReplayHttp } from './h1-replay-http.js';
import { listH1TheoryRecordedDates } from './h1-theory-history.js';
import { compareSameDteHistory } from './rag-same-dte-history.js';

export async function readSameDteHistory(query:Record<string,string|undefined>,read=runH1ReplayHttp,list=listH1TheoryRecordedDates){
 const parsed=parseRagEventRequest({...query,kind:'SNAPSHOT',lookback:'3',includeOutcomes:'false'});
 if(!parsed.ok)return {ok:false,status:'BLOCKED',reason:parsed.reason};
 const r=parsed.value;
 const fromTime=new Date(Date.parse(r.date+'T'+r.time+':00+05:30')-180000+19800000).toISOString().slice(11,16);
 if(fromTime<'09:15'||r.time>'15:30')return {ok:false,status:'BLOCKED',reason:'EXACT_REGULAR_3M_PAIR_REQUIRED'};
 const selection={symbol:r.symbol,date:r.date,expiry:r.expiry,strike:r.strike,side:r.side,timeIst:r.time,asOf:Math.min(r.asOf,Date.now())};
 const current=await read({symbol:r.symbol,tradeDate:r.date,fromTime,toTime:r.time,scope:'FULL'});
 const anchorCheck=compareSameDteHistory(selection,current,[]);
 if(!anchorCheck.ok)return anchorCheck;
 const dates=await list();
 if(!dates.ok)return {ok:false,status:'BLOCKED',reason:'HISTORICAL_DATE_INDEX_UNAVAILABLE'};
 const days=[...new Set(dates.dates.filter(d=>d.symbol===r.symbol&&d.tradeDate<r.date).map(d=>d.tradeDate))].sort().reverse().slice(0,6);
 const history=[];const readFailures=[];
 // Bounded sequential retrieval avoids a fan-out against the existing database.
 for(const tradeDate of days){
  try{history.push(await read({symbol:r.symbol,tradeDate,fromTime,toTime:r.time,scope:'FULL'}));}
  catch{readFailures.push(tradeDate);}
 }
 return {...compareSameDteHistory(selection,current,history),retrieval:{maximumPriorDays:6,requestedDays:days,readFailures,source:'EXISTING_H1_REPLAY_AND_RECORDED_DATE_INDEX'}};
}

export function mountSameDteHistoryRoute(app:Hono,read=readSameDteHistory){
 app.get('/rag-same-dte-history',async c=>{
  c.header('Cache-Control','no-store');
  try{const result=await read(c.req.query());return c.json(result,result.ok?200:422);}
  catch{return c.json({ok:false,status:'BLOCKED',reason:'HISTORICAL_SOURCE_UNAVAILABLE'},503);}
 });
}
