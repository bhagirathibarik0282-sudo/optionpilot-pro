import type {H1ReplayHttpResult} from './h1-replay-http.js';
import {alignRagDteEvidence,type DteEvidencePoint} from './rag-dte-alignment.js';

/** Convert exact 3-minute FULL replay rows into independently verified expiry pairs. */
export function alignRecordedRagDte(replay:H1ReplayHttpResult,selection:{symbol:string;date:string;strike:number;side:'CE'|'PE';timeIst:string},asOf=Infinity){
 const empty=()=>alignRagDteEvidence([],selection,asOf);
 if(!replay.ok||replay.request?.symbol!==selection.symbol||replay.request.tradeDate!==selection.date)return {...empty(),sourceStatus:'REPLAY_UNAVAILABLE_OR_WRONG_IDENTITY'};
 const event=Date.parse(selection.date+'T'+selection.timeIst+':00+05:30');
 if(!Number.isFinite(event)||event>Date.parse(selection.date+'T15:30:00+05:30')||event<Date.parse(selection.date+'T09:18:00+05:30'))return {...empty(),sourceStatus:'INVALID_EVENT_TIME'};
 const eventBucket=new Date(event).toISOString(),beforeBucket=new Date(event-180000).toISOString();
 const market=(bucket:string)=>{
  const rows=(replay.market??[]).filter(m=>m.symbol===selection.symbol&&Date.parse(String(m.minute_bucket))===Date.parse(bucket));
  return rows.length===1&&rows[0].truth_verdict==='TRUE'&&rows[0].snapshot_id?rows[0]:null;
 };
 const mNow=market(eventBucket),mBefore=market(beforeBucket);
 if(!mNow||!mBefore)return {...empty(),sourceStatus:'MARKET_SNAPSHOT_UNVERIFIED'};
 const expiries=new Set((replay.options??[]).filter(o=>o.symbol===selection.symbol&&Number(o.strike)===selection.strike&&o.option_type===selection.side&&[eventBucket,beforeBucket].includes(new Date(o.minute_bucket).toISOString())).map(o=>String(o.expiry).slice(0,10)));
 const points:DteEvidencePoint[]=[];
 for(const expiry of expiries){
  const find=(bucket:string,m:any)=>{
   const rows=(replay.options??[]).filter(o=>o.symbol===selection.symbol&&String(o.expiry).slice(0,10)===expiry&&Number(o.strike)===selection.strike&&o.option_type===selection.side&&new Date(o.minute_bucket).toISOString()===bucket);
   if(rows.length!==1)return null;
   const q=rows[0],quote=Date.parse(String(q.quote_timestamp)),receipt=Date.parse(String(m.backend_timestamp));
   if(q.truth_verdict!=='TRUE'||q.snapshot_id!==m.snapshot_id||!Number.isFinite(quote)||!Number.isFinite(receipt)||quote>receipt+5000||receipt-quote>30000)return null;
   return {price:Number(q.ltp),quoteAt:new Date(quote).toISOString(),receiptAt:new Date(receipt).toISOString(),snapshotId:String(q.snapshot_id)};
  };
  const current=find(eventBucket,mNow),previous=find(beforeBucket,mBefore);
  points.push({...selection,expiry,price:current?.price??null,previousPrice:previous?.price??null,quoteAt:current?.quoteAt??null,receiptAt:current?.receiptAt??null,snapshotId:current?.snapshotId??null,previousQuoteAt:previous?.quoteAt??null,previousReceiptAt:previous?.receiptAt??null,previousSnapshotId:previous?.snapshotId??null});
 }
 return {...alignRagDteEvidence(points,selection,asOf),sourceStatus:'EXACT_REPLAY_READ'};
}
