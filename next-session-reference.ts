import { listH1TheoryRecordedDates } from './h1-theory-history.js';
import { runH1ReplayHttp } from './h1-replay-http.js';

/** Small, read-only, recorded-price reference. Never a trade/forecast authority. */
const VALID=['NIFTY','SENSEX'] as const;
type Sym=typeof VALID[number];
type Dependencies={dates:typeof listH1TheoryRecordedDates;replay:typeof runH1ReplayHttp};
const defaults:Dependencies={dates:listH1TheoryRecordedDates,replay:runH1ReplayHttp};
const istDay=(ms:number)=>new Date(ms+19800000).toISOString().slice(0,10);
const istMinute=(ms:number)=>{const d=new Date(ms+19800000);return d.getUTCHours()*60+d.getUTCMinutes();};
const pos=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
const goodDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export async function readNextSessionReference(input:string|null|undefined,deps:Dependencies=defaults,now=new Date()){
 const base={mode:'RECORDED_NEXT_SESSION_REFERENCE_V1' as const,source:'POSTGRES_H1_REPLAY' as const,
  readOnly:true as const,createsOrders:false as const,affectsExecution:false as const,
  affectsTelegram:false as const,brokerFetches:0 as const};
 const symbol=String(input??'NIFTY').toUpperCase().trim();
 const fail=(reason:string)=>({...base,ok:false as const,symbol,reason});
 if(!VALID.includes(symbol as Sym))return fail('INVALID_SYMBOL');
 if(!Number.isFinite(now.getTime()))return fail('INVALID_CLOCK');
 let index;
 try{index=await deps.dates();}catch{return fail('RECORDED_DATE_INDEX_UNAVAILABLE');}
 if(!index.ok||!Array.isArray(index.dates))return fail('RECORDED_DATE_INDEX_UNAVAILABLE');
 const dates=index.dates.filter(d=>d.symbol===symbol&&typeof d.tradeDate==='string'&&goodDate(d.tradeDate))
  .sort((a,b)=>b.tradeDate.localeCompare(a.tradeDate));
 if(!dates.length)return fail('NO_RECORDED_SESSION');
 const latest=dates[0]; // No fallback from an incomplete newer day to an older day.
 const today=istDay(now.getTime());
 if(latest.tradeDate>today)return fail('RECORD_DATE_IN_FUTURE');
 if(latest.tradeDate===today&&istMinute(now.getTime())<931)return fail('CLOSING_SESSION_NOT_FINISHED');
 const indexedEnd=Date.parse(latest.lastMinute??'');
 if(!Number.isFinite(indexedEnd)||istDay(indexedEnd)!==latest.tradeDate||istMinute(indexedEnd)<925||istMinute(indexedEnd)>930)
  return {...fail('LATEST_SESSION_NO_CLOSE_MARKER'),sourceTradeDate:latest.tradeDate};
 const request={symbol:symbol as Sym,tradeDate:latest.tradeDate,fromTime:'15:00',toTime:'15:30',scope:'CORE' as const};
 let replay;
 try{replay=await deps.replay(request,true);}catch{return fail('CLOSE_ARCHIVE_READ_FAILED');}
 if(!replay.ok||replay.request?.symbol!==symbol||replay.request?.tradeDate!==latest.tradeDate||!Array.isArray(replay.market))
  return fail('CLOSE_ARCHIVE_READ_FAILED');
 const valid=replay.market.filter(r=>r.symbol===symbol&&r.truth_verdict==='TRUE'&&r.freshness_status==='TRUE')
  .map(r=>({...r,at:Date.parse(String(r.minute_bucket??''))}))
  .filter(r=>Number.isFinite(r.at)&&istDay(r.at)===latest.tradeDate&&istMinute(r.at)>=900&&istMinute(r.at)<=930)
  .sort((a,b)=>a.at-b.at);
 const last=valid.at(-1);
 if(!last||istMinute(last.at)<925)return fail('NO_VERIFIED_CLOSING_MARKET_ROW');
 if(valid.some(r=>r.at===last.at&&['spot_ltp','spot_high','spot_low','snapshot_id'].some(k=>r[k]!==last[k])))
  return fail('CONFLICTING_CLOSING_MARKET_ROWS');
 const high=pos(last.spot_high),low=pos(last.spot_low),close=pos(last.spot_ltp);
 if(high===null||low===null||close===null||low>close||close>high)return fail('INVALID_RECORDED_PRICE_RANGE');
 const quoteAt=Date.parse(String(last.exchange_timestamp??''));
 if(Number.isFinite(quoteAt)&&(istDay(quoteAt)!==latest.tradeDate||quoteAt>last.at+60000))return fail('CONFLICTING_EXCHANGE_TIMESTAMP');
 const daysOld=(Date.parse(today+'T00:00:00Z')-Date.parse(latest.tradeDate+'T00:00:00Z'))/86400000;
 const warnings:string[]=[];
 if(daysOld>7)warnings.push('OLDER_THAN_SEVEN_CALENDAR_DAYS_NOT_NEXT_SESSION');
 if(replay.continuity?.complete!==true)warnings.push('CLOSING_WINDOW_MARKER_GAPS');
 if(valid.length<2)warnings.push('ONLY_ONE_VERIFIED_MARKET_ROW');
 const prevClose=pos(last.spot_prev_close),vwap=pos(last.vwap);
 if(prevClose===null)warnings.push('PREVIOUS_CLOSE_NOT_RECORDED');
 if(vwap===null)warnings.push('VWAP_NOT_RECORDED');
 return {...base,ok:true as const,symbol:symbol as Sym,
  status:daysOld>7?'HISTORICAL_REFERENCE_ONLY' as const:'CONDITIONAL_REFERENCE' as const,
  sourceTradeDate:latest.tradeDate,lastRecordedAt:new Date(last.at).toISOString(),
  sourceExchangeAt:Number.isFinite(quoteAt)?new Date(quoteAt).toISOString():null,
  verifiedRows:valid.length,warnings,
  levels:{high,low,lastObserved:close,previousClose:prevClose,vwap},
  ceScenario:{watchAbove:high,requires:'Fresh spot holds above recorded high + live VWAP and matching CE premium/OI confirmation',invalidatedBy:'Price returns below recorded high'},
  peScenario:{watchBelow:low,requires:'Fresh spot holds below recorded low + live VWAP and matching PE premium/OI confirmation',invalidatedBy:'Price recovers above recorded low'},
  tradeEntry:null,stopLoss:null,target:null,winRate:null,liveConfirmationRequired:true as const,
  note:'These are verified recorded references, not the official closing price or a CE/PE buy signal. Mixed-time reported PCR is context, not synchronized confirmation.'};
}
