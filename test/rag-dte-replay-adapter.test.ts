import test from 'node:test';
import assert from 'node:assert/strict';
import {alignRecordedRagDte} from '../rag-dte-replay-adapter.js';
const date='2026-10-13',selection={symbol:'NIFTY',date,strike:22300,side:'PE' as const,timeIst:'09:36'};
const bucket=(time:string)=>new Date(date+'T'+time+':00+05:30').toISOString();
function replay(){
 const market=['09:33','09:36'].map((t,i)=>({symbol:'NIFTY',minute_bucket:bucket(t),truth_verdict:'TRUE',snapshot_id:'s'+i,backend_timestamp:new Date(Date.parse(bucket(t))+24000).toISOString()}));
 const options=['2026-10-13','2026-10-20'].flatMap(expiry=>['09:33','09:36'].map((t,i)=>({symbol:'NIFTY',expiry,strike:22300,option_type:'PE',minute_bucket:bucket(t),truth_verdict:'TRUE',snapshot_id:'s'+i,quote_timestamp:new Date(Date.parse(bucket(t))+20000).toISOString(),ltp:i?12:10})));
 return {ok:true,request:{symbol:'NIFTY',tradeDate:date},market,options} as any;
}
test('replay adapter compares both expiries only with exact market/quote identities',()=>{
 const r=alignRecordedRagDte(replay(),selection);
 assert.equal(r.coverage.verifiedExpiries,2);
 assert.equal(r.direction.agreement,'ALL_VERIFIED_SAME_DIRECTION');
});
test('missing baseline snapshot and cutoff fail closed',()=>{
 const x=replay();x.options[0].snapshot_id='wrong';
 assert.equal(alignRecordedRagDte(x,selection).coverage.verifiedExpiries,1);
 assert.equal(alignRecordedRagDte(replay(),selection,Date.parse(bucket('09:36'))).coverage.verifiedExpiries,0);
});
test('wrong replay session never produces evidence',()=>{
 const x=replay();x.request.tradeDate='2026-10-12';
 assert.equal(alignRecordedRagDte(x,selection).sourceStatus,'REPLAY_UNAVAILABLE_OR_WRONG_IDENTITY');
});
