import { createHash } from 'node:crypto';
import type { H1ReplayHttpResult, H1ReplaySymbol } from './h1-replay-http.js';

export type PremiumResponseSelection = {
  symbol:H1ReplaySymbol; date:string; expiry:string; strike:number; side:'CE'|'PE';
  time:string; lookback?:number; asOf:number;
};
export const PREMIUM_RESPONSE_SOURCES = [
  {id:'OIC_OPTIONS_PRICING',url:'https://prd-web.optionseducation.org/optionsoverview/options-pricing',use:'Spot intrinsic proxy and premium remainder; no attribution to time decay.'},
  {id:'OIC_DELTA',url:'https://prd-web.optionseducation.org/advancedconcepts/delta',use:'Observed premium/spot ratio is not theoretical Delta.'},
  {id:'KITE_QUOTE_TIMES',url:'https://kite.trade/docs/connect/v3/market-quotes/',use:'Keep quote, bucket and receipt times distinct; archived quote timestamp semantics remain unverified.'},
] as const;

/** Pure projection of existing replay rows. No provider/model calls or persistence. */
export function deriveRecordedPremiumResponse(replay:H1ReplayHttpResult,s:PremiumResponseSelection){
  const num=(v:unknown):number|null=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
  const ms=(v:unknown)=>Date.parse(String(v??''));
  const day=(v:number)=>Number.isFinite(v)?new Date(v+19800000).toISOString().slice(0,10):'';
  const calendar=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(ms(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const expiry=(v:unknown)=>Number.isFinite(ms(v))?new Date(ms(v)).toISOString().slice(0,10):'';
  const lookback=s.lookback??3,eventMs=ms(s.date+'T'+s.time+':00+05:30');
  const dte=calendar(s.expiry)&&calendar(s.date)?Math.round((ms(s.expiry)-ms(s.date))/86400000):null;
  const identity={symbol:s.symbol,date:s.date,expiry:s.expiry,strike:s.strike,side:s.side};
  const clock={calendarDte:dte,expiryAt:null,minutesToExpiry:null,reason:'EXPIRY_TIMESTAMP_NOT_RECORDED'};
  const safety={readOnly:true,affectsSelector:false,affectsVerdict:false,affectsTelegram:false,affectsExecution:false};
  const base={version:'RECORDED_PREMIUM_RESPONSE_V1',identity,lookbackMinutes:lookback,clock,safety,
    sources:PREMIUM_RESPONSE_SOURCES,modelAttribution:{status:'UNAVAILABLE',reason:'VERIFIED_GREEK_MODEL_AND_UNITS_NOT_ESTABLISHED'},
    semantics:'Measured exact endpoints. Spot intrinsic is an arithmetic proxy; the remainder is not isolated Theta or IV.'};
  const block=(reason:string)=>({...base,status:'UNAVAILABLE',reason,before:null,current:null,change:null,evidenceSha256:null});
  if(!calendar(s.date)||!calendar(s.expiry)||dte===null||dte<0||!['NIFTY','SENSEX','BANKNIFTY'].includes(s.symbol)||!['CE','PE'].includes(s.side)||!Number.isFinite(s.strike)||s.strike<=0||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)||!Number.isFinite(eventMs)||![1,3,5,6,15,30,45,75,125].includes(lookback)||!(s.asOf===Infinity||Number.isFinite(s.asOf)&&Number.isFinite(new Date(s.asOf).getTime())))return block('INVALID_RESPONSE_SELECTION');
  const minute=Number(s.time.slice(0,2))*60+Number(s.time.slice(3));
  if(minute<555||minute>930||(minute-555)%3!==0)return block('OUTSIDE_RECORDED_SESSION');
  if(!replay.ok||replay.request?.symbol!==s.symbol||replay.request.tradeDate!==s.date)return block('REPLAY_SOURCE_IDENTITY_MISMATCH');
  const unique=(rows:Record<string,unknown>[],fields:string[])=>{
    const groups=new Map(rows.map(r=>[JSON.stringify(fields.map(k=>r[k])),r]));
    return groups.size===1?[...groups.values()][0]:null;
  };
  const point=(bucket:number)=>{
    const missing=(reason:string)=>({ok:false as const,reason,point:null});
    const iso=new Date(bucket).toISOString();
    if(day(bucket)!==s.date||bucket<ms(s.date+'T09:15:00+05:30')||bucket>s.asOf)return missing('EXACT_ENDPOINT_UNAVAILABLE_AT_CUTOFF');
    const m=unique((replay.market??[]).filter(r=>r.symbol===s.symbol&&ms(r.minute_bucket)===bucket),['symbol','minute_bucket','snapshot_id','truth_verdict','backend_timestamp','exchange_timestamp','spot_ltp']);
    if(!m||m.truth_verdict!=='TRUE'||typeof m.snapshot_id!=='string'||!m.snapshot_id)return missing('MARKET_SNAPSHOT_UNVERIFIED');
    const receipt=ms(m.backend_timestamp);
    if(!Number.isFinite(receipt)||receipt<bucket||receipt-bucket>60000||receipt>s.asOf)return missing('RECEIPT_TIME_UNVERIFIED_OR_AFTER_CUTOFF');
    const q=unique((replay.options??[]).filter(r=>r.symbol===s.symbol&&expiry(r.expiry)===s.expiry&&num(r.strike)===s.strike&&r.option_type===s.side&&ms(r.minute_bucket)===bucket),['ltp','oi','snapshot_id','truth_verdict','quote_timestamp','dte','bid','ask','calculation_version']);
    if(!q||q.truth_verdict!=='TRUE'||q.snapshot_id!==m.snapshot_id)return missing('EXACT_CONTRACT_UNVERIFIED_OR_AMBIGUOUS');
    const price=num(q.ltp),quote=ms(q.quote_timestamp),age=(receipt-quote)/1000;
    if(price===null||price<=0||!Number.isFinite(quote)||day(quote)!==s.date||age< -5||age>30||quote>s.asOf)return missing('QUOTE_STALE_INVALID_OR_AFTER_CUTOFF');
    if(q.dte!==null&&q.dte!==undefined&&num(q.dte)!==dte)return missing('STORED_DTE_MISMATCH');
    const spotAt=ms(m.exchange_timestamp),hasSpotTime=m.exchange_timestamp!==null&&m.exchange_timestamp!==undefined;
    const spotTimeOk=!hasSpotTime||Number.isFinite(spotAt)&&day(spotAt)===s.date&&receipt-spotAt>=-5000&&receipt-spotAt<=30000&&spotAt<=s.asOf;
    const rawSpot=num(m.spot_ltp),spot=spotTimeOk&&rawSpot!==null&&rawSpot>0?rawSpot:null;
    const intrinsic=spot===null?null:Math.max(s.side==='CE'?spot-s.strike:s.strike-spot,0);
    const remainder=intrinsic===null?null:price-intrinsic;
    const oi=num(q.oi),bid=num(q.bid),ask=num(q.ask),twoSided=bid!==null&&ask!==null&&bid>0&&ask>=bid;
    return {ok:true as const,reason:null,point:{bucketAt:iso,quoteAt:new Date(quote).toISOString(),receiptAt:new Date(receipt).toISOString(),
      availableAt:new Date(Math.max(receipt,quote)).toISOString(),snapshotId:m.snapshot_id,quoteAgeSeconds:age,
      optionCalculationVersion:q.calculation_version??null,marketCalculationVersion:m.calculation_version??null,
      price,spot,oi:oi!==null&&oi>=0?oi:null,
      spotBasis:'RECORDED_SAME_SNAPSHOT; SPOT_TRADE_FRESHNESS_UNVERIFIED',spotExchangeAt:Number.isFinite(spotAt)?new Date(spotAt).toISOString():null,
      spotIntrinsicProxy:intrinsic,spotRemainder:remainder,remainderStatus:remainder===null?'SPOT_UNAVAILABLE':remainder<0?'NEGATIVE_SPOT_REMAINDER':'ARITHMETIC_PROXY',
      liquidity:{bid:bid!==null&&bid>0?bid:null,ask:ask!==null&&ask>0?ask:null,spread:twoSided?ask!-bid!:null,status:twoSided?'RECORDED_TWO_SIDED_QUOTE':'UNAVAILABLE_OR_CROSSED',executionPriceVerified:false}}};
  };
  const beforeResult=point(eventMs-lookback*60000),currentResult=point(eventMs),before=beforeResult.point,current=currentResult.point;
  const finite=(v:number)=>Number.isFinite(v)?v:null;
  const subtract=(a:number|null,b:number|null)=>a!==null&&b!==null?finite(a-b):null;
  const validPair=!!before&&!!current&&before.snapshotId!==current.snapshotId&&ms(before.quoteAt)<ms(current.quoteAt);
  const spotChange=validPair?subtract(current!.spot,before!.spot):null;
  const priceChange=validPair?current!.price-before!.price:null;
  const change=validPair?{price:priceChange,pricePercent:finite((current!.price/before!.price-1)*100),spot:spotChange,
    spotPercent:spotChange!==null?finite(spotChange/before!.spot!*100):null,
    spotIntrinsicProxy:subtract(current!.spotIntrinsicProxy,before!.spotIntrinsicProxy),spotRemainder:subtract(current!.spotRemainder,before!.spotRemainder),
    oi:subtract(current!.oi,before!.oi),observedPremiumPerSpotPoint:spotChange!==null&&spotChange!==0?finite(priceChange!/spotChange):null}:null;
  const reason=!current?currentResult.reason:!before?beforeResult.reason:!validPair?'REUSED_OR_NONFORWARD_SOURCE':spotChange===null?'SPOT_PAIR_UNAVAILABLE':null;
  const evidence={version:base.version,identity,lookbackMinutes:lookback,cutoff:s.asOf===Infinity?null:new Date(s.asOf).toISOString(),before,current,change};
  return {...base,status:validPair&&spotChange!==null?'MEASURED':'PARTIAL',reason,before,current,change,
    endpointReasons:{before:beforeResult.reason,current:currentResult.reason},evidenceSha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')};
}
