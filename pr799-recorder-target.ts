import {parseRagEventRequest,inspectRagSnapshotAdmission} from './rag-event-evidence.js';
import type {H1ReplayHttpResult} from './h1-replay-http.js';

export const PR799_TARGET_SELECTION_POLICY='EARLIEST_RECORDED_EXPIRY_NEAREST_EVENT_SPOT_LOWER_STRIKE_TIE_V1';
/** Source-validation target only, selected before any historical/outcome read.
 * No guessed expiry calendar, nearest time, admission-based replacement or outcome input. */
export function selectPr799RecordedTarget(input:{symbol:string;date:string;time:string;side:string},replay:H1ReplayHttpResult){
 const fail=(reason:string,admission:any=null)=>({ok:false as const,reason,policy:PR799_TARGET_SELECTION_POLICY,admission});
 if(!replay.ok||replay.request?.symbol!==input.symbol||replay.request.tradeDate!==input.date)return fail('TARGET_REPLAY_IDENTITY_MISMATCH');
 const ms=Date.parse(input.date+'T'+input.time+':00+05:30');
 if(!Number.isFinite(ms)||!['CE','PE'].includes(input.side))return fail('INVALID_TARGET_SELECTION');
 const iso=(v:unknown)=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?new Date(n).toISOString():null;};
 const at=new Date(ms).toISOString();
 const market=[...new Map((replay.market??[]).filter(r=>r.symbol===input.symbol&&iso(r.minute_bucket)===at).map(r=>[JSON.stringify(r),r])).values()];
 const spot=market[0]?.spot_ltp;
 if(market.length!==1||market[0].truth_verdict!=='TRUE'||typeof spot!=='number'||!Number.isFinite(spot)||spot<=0)return fail('EXACT_EVENT_SPOT_UNAVAILABLE');
 const rows=(replay.options??[]).filter(r=>r.symbol===input.symbol&&iso(r.minute_bucket)===at);
 const expiries=[...new Set(rows.map(r=>iso(r.expiry)?.slice(0,10)).filter((d):d is string=>!!d&&d>=input.date))].sort();
 const expiry=expiries[0];if(!expiry)return fail('NO_RECORDED_EVENT_EXPIRY');
 const strikes=[...new Set(rows.filter(r=>iso(r.expiry)?.slice(0,10)===expiry).map(r=>Number(r.strike)).filter(s=>Number.isInteger(s)&&s>0))]
  .sort((a,b)=>Math.abs(a-spot)-Math.abs(b-spot)||a-b);
 if(!strikes.length)return fail('NO_RECORDED_EVENT_STRIKE');
 const target={...input,expiry,strike:String(strikes[0])};
 const parsed=parseRagEventRequest({...target,kind:'SNAPSHOT',lookback:'3',includeOutcomes:'false'});
 if(!parsed.ok)return fail(parsed.reason);
 const admission=inspectRagSnapshotAdmission(parsed.value,replay);
 if(!admission.admitted)return fail('SELECTED_RECORDED_TARGET_NOT_ADMITTED',admission);
 return {ok:true as const,target,policy:PR799_TARGET_SELECTION_POLICY,admission};
}
