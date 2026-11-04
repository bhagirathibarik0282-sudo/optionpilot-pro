import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRecordedPremiumSession} from '../recorded-premium-session.js';
const date='2026-11-04',symbol='NIFTY',at=(n:number)=>new Date(Date.parse(date+'T03:45:00Z')+n*60000).toISOString();
function fixture(){
 const market=[0,1,2,3,4,5,375,385,386].map(n=>({symbol,minute_bucket:at(n),truth_verdict:'TRUE',snapshot_id:'s'+n,backend_timestamp:at(n)}));
 const options=market.flatMap((m,i)=>['2026-11-09','2026-11-16'].flatMap(expiry=>['CE','PE'].map(option_type=>({...m,expiry,strike:23900,option_type,ltp:100+i,quote_timestamp:m.minute_bucket,pdh:120,pdl:80}))));
 return {date,symbol,strike:23900,expiry:'2026-11-09',cursor:at(385),sessionEnd:'15:40',cadenceMinutes:1,interval:1,scope:'ALL',market,options};
}
test('full-session axes retain opening, closing and every observed price, without turning samples into candles',()=>{
 const html=renderRecordedPremiumSession(fixture());
 assert.match(html,/09:15–15:40/);assert.match(html,/All 8 eligible premium observations/);
 assert.equal((html.match(/role="img"/g)||[]).length,4);assert.match(html,/DTE 5/);assert.match(html,/DTE 12/);
 assert.match(html,/OHLC unavailable/);assert.match(html,/O=H unavailable/);assert.match(html,/Missing\/excluded 378/);
 assert.match(html,/15:40 IST/);assert.doesNotMatch(html,/15:41 IST/);
});
test('replay cutoff controls values, scales and reference levels for all expiries',()=>{
 const f=fixture();f.cursor=at(1);f.options.find(r=>r.minute_bucket===at(5))!.ltp=999999;
 const html=renderRecordedPremiumSession(f);assert.match(html,/All 2 eligible/);assert.doesNotMatch(html,/999|09:20 IST/);
});
test('missing cadence buckets break lines; coarse display retains complete raw observations',()=>{
 const f=fixture();f.cursor=at(5);f.options=f.options.filter(r=>r.minute_bucket!==at(2));
 const html=renderRecordedPremiumSession(f);assert.equal((html.match(/data-premium-segment/g)||[]).length,12);
 f.interval=5;const coarse=renderRecordedPremiumSession(f);assert.match(coarse,/5m sampled line/);
 assert.match(coarse,/All 5 eligible/);assert.doesNotMatch(coarse,/data-premium-segment/);
});
test('stale quotes, wrong snapshots and conflicting duplicates cannot produce premium points',()=>{
 const f=fixture();f.cursor=at(1);
 for(const r of f.options)if(r.minute_bucket===at(1))r.quote_timestamp=at(0);
 assert.match(renderRecordedPremiumSession(f),/All 1 eligible/);
 for(const r of f.options)if(r.minute_bucket===at(0))r.snapshot_id='different';
 assert.doesNotMatch(renderRecordedPremiumSession(f),/role="img"/);
 const g=fixture();g.cursor=at(0);g.scope='SELECTED';g.options.push({...g.options[0],ltp:300});
 const h=renderRecordedPremiumSession(g);assert.equal((h.match(/role="img"/g)||[]).length,1);
});
test('another expiry with no fixed strike remains visibly unavailable; changing ATM never joins strikes',()=>{
 const f=fixture();f.options.filter(r=>r.expiry==='2026-11-16').forEach(r=>r.strike=24000);
 const html=renderRecordedPremiumSession(f);assert.match(html,/2026-11-16/);
 assert.equal((html.match(/No eligible saved quotes/g)||[]).length,2);
 assert.equal((html.match(/role="img"/g)||[]).length,2);
});
test('late listing does not backfill the opening and historic 3m cadence is explicit',()=>{
 const f=fixture();f.options=f.options.filter(r=>r.minute_bucket!==at(0));f.cursor=at(3);f.cadenceMinutes=3;
 assert.match(renderRecordedPremiumSession(f),/source cadence 3m \(no interpolation\)/);
 assert.match(renderRecordedPremiumSession(f),/1 \/ 2 eligible samples/);
});
