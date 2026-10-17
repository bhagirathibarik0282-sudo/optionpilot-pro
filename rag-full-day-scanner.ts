import type {H1ReplayHttpResult} from './h1-replay-http.js';
import {alignRecordedRagDte} from './rag-dte-replay-adapter.js';

export type RagScanSelection={symbol:string;date:string;side:'CE'|'PE'|'BOTH';minExpiries:number};
const dateKey=(v:unknown)=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?new Date(n).toISOString().slice(0,10):null};
const iso=(v:unknown)=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?new Date(n).toISOString():null};
const clockIst=(v:string)=>new Date(Date.parse(v)+19800000).toISOString().slice(11,16);
/** Recorded-only, 3-minute full-session event discovery. Never interpolates or asserts a trading edge. */
export function scanRecordedRagDay(replay:H1ReplayHttpResult,selection:RagScanSelection){
 const safety={readOnly:true,affectsSelector:false,affectsTelegram:false,createsOrders:false};
 const fail=(reason:string)=>({ok:false,status:'BLOCKED',reason,safety,events:[]});
 if(!replay.ok||replay.request?.symbol!==selection.symbol||replay.request.tradeDate!==selection.date||replay.request.scope!=='FULL')return fail('FULL_REPLAY_IDENTITY_UNAVAILABLE');
 if(replay.request.fromTime!=='09:15'||replay.request.toTime!=='15:30')return fail('FULL_DAY_RANGE_REQUIRED');
 if(!Number.isInteger(selection.minExpiries)||selection.minExpiries<2)return fail('INVALID_MIN_EXPIRIES');
 const markets=new Map((replay.market??[]).filter(m=>m.symbol===selection.symbol&&m.truth_verdict==='TRUE'&&m.snapshot_id).map(m=>[iso(m.minute_bucket),m]));
 const grouped=new Map<string,{strike:number;side:'CE'|'PE';time:string;expiries:Set<string>}>();
 for(const q of replay.options??[]){
  if(q.symbol!==selection.symbol||q.truth_verdict!=='TRUE'||!q.snapshot_id||!(Number(q.ltp)>0)||!Number.isFinite(Number(q.strike)))continue;
  if(selection.side!=='BOTH'&&q.option_type!==selection.side)continue;
  if(q.option_type!=='CE'&&q.option_type!=='PE')continue;
  const bucket=iso(q.minute_bucket),m=markets.get(bucket),expiry=dateKey(q.expiry);
  if(!bucket||!expiry||!m||m.snapshot_id!==q.snapshot_id)continue;
  const key=[bucket,q.strike,q.option_type].join('|');
  if(!grouped.has(key))grouped.set(key,{strike:Number(q.strike),side:q.option_type as 'CE'|'PE',time:clockIst(bucket),expiries:new Set()});
  grouped.get(key)!.expiries.add(expiry);
 }
 const events=[];
 for(const g of grouped.values()){
  if(g.expiries.size<selection.minExpiries)continue;
  const comparison=alignRecordedRagDte(replay,{symbol:selection.symbol,date:selection.date,strike:g.strike,side:g.side,timeIst:g.time});
  if(comparison.coverage.verifiedExpiries<selection.minExpiries)continue;
  events.push({timeIst:g.time,strike:g.strike,side:g.side,expiries:[...g.expiries].sort(),comparison});
 }
 events.sort((a,b)=>a.timeIst.localeCompare(b.timeIst)||a.strike-b.strike||a.side.localeCompare(b.side));
 return {ok:true,status:events.length?'PARTIAL':'NO_VERIFIED_PAIRS',mode:'READ_ONLY_RAG_FULL_DAY_SCAN_V1',date:selection.date,symbol:selection.symbol,coverage:{truthMarketBuckets:markets.size,eligibleMultiDteEvents:events.length},events,safety,limitations:['Only exact recorded 3-minute pair buckets; no interpolation.','Not an exhaustive 1-minute or tick scan.','No causality or trading authority.']};
}
