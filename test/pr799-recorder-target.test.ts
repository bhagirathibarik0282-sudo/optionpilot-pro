import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPr799RecordedTarget as select} from '../pr799-recorder-target.js';
const input={symbol:'NIFTY',date:'2026-10-26',time:'10:24',side:'PE'},at='2026-10-26T04:54:00.000Z';
function fixture():any{
 const receipt='2026-10-26T04:54:24.000Z';
 return {ok:true,request:{symbol:'NIFTY',tradeDate:input.date},market:[{symbol:'NIFTY',minute_bucket:at,spot_ltp:23225,truth_verdict:'TRUE',snapshot_id:'event',backend_timestamp:receipt}],
 options:['2026-10-27','2026-11-03'].flatMap(expiry=>[23200,23250].map(strike=>({symbol:'NIFTY',minute_bucket:at,expiry,strike,option_type:'PE',ltp:100,truth_verdict:'TRUE',snapshot_id:'event',quote_timestamp:receipt})))};
}
test('uses recorded expiry and nearest event strike with an explicit lower-strike tie, never assumed same-day expiry',()=>{
 const replay=fixture(),before=JSON.stringify(replay),r=select(input,replay);assert(r.ok);
 assert.equal(r.target.expiry,'2026-10-27');assert.equal(r.target.strike,'23200');assert.equal(r.admission.reason,'ADMITTED');assert.equal(JSON.stringify(replay),before);
});
test('a rejected chosen contract does not cause later-expiry or alternate-strike replacement',()=>{
 const replay=fixture();replay.options[0].snapshot_id='wrong';const r=select(input,replay);
 assert.equal(r.ok,false);assert.equal(r.admission?.reason,'QUOTE_SNAPSHOT_ID_MISMATCH');
});
test('future/outcome quotes do not change selection; exact market and request identity are required',()=>{
 const replay=fixture();replay.options.push({...replay.options[0],minute_bucket:'2026-10-26T04:57:00Z',expiry:'2026-10-26',strike:23225,ltp:9999});
 const r=select(input,replay);assert(r.ok);assert.equal(r.target.expiry,'2026-10-27');
 replay.market[0].minute_bucket='2026-10-26T04:53:00Z';assert.equal(select(input,replay).reason,'EXACT_EVENT_SPOT_UNAVAILABLE');
 replay.request.tradeDate='2026-10-19';assert.equal(select(input,replay).reason,'TARGET_REPLAY_IDENTITY_MISMATCH');
});
