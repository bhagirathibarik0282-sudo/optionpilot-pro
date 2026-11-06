import test from 'node:test';
import assert from 'node:assert/strict';
import {readNextSessionReference} from '../next-session-reference.js';
const date='2026-11-06',at='2026-11-06T09:59:00.000Z',now=new Date('2026-11-06T13:00:00Z');
const dates=(lastMinute=at,tradeDate=date)=>async()=>({ok:true,dates:[{symbol:'NIFTY',tradeDate,lastMinute,markerCount:300,firstMinute:'2026-11-06T03:45:00Z'}]});
const row=(minute_bucket=at)=>({symbol:'NIFTY',minute_bucket,truth_verdict:'TRUE',freshness_status:'TRUE',snapshot_id:'A',
 spot_high:25050,spot_low:24850,spot_ltp:25010,spot_prev_close:24910,vwap:24980,exchange_timestamp:minute_bucket});
const replay=(market:any[]=[row('2026-11-06T09:58:00Z'),row()])=>async(request:any)=>({ok:true,request,market,continuity:{complete:true}});
const deps=(d:any=dates(),r:any=replay())=>({dates:d,replay:r}) as any;
test('strictly recorded levels, no guessed trade entry or win rate',async()=>{
 const p=await readNextSessionReference('NIFTY',deps(),now);assert.equal(p.ok,true);
 if(!p.ok)return;
 assert.equal(p.levels.high,25050);assert.equal(p.levels.low,24850);
 assert.equal(p.sourceTradeDate,date);assert.equal(p.lastRecordedAt,at);
 assert.equal(p.ceScenario.watchAbove,25050);assert.equal(p.peScenario.watchBelow,24850);
 assert.equal(p.tradeEntry,null);assert.equal(p.winRate,null);assert.equal(p.createsOrders,false);
});
test('latest missing close never silently borrows an older day',async()=>{
 let fetches=0;
 const d=async()=>({ok:true,dates:[{symbol:'NIFTY',tradeDate:date,lastMinute:'2026-11-06T08:00:00Z'},
 {symbol:'NIFTY',tradeDate:'2026-11-05',lastMinute:'2026-11-05T09:59:00Z'}]});
 const p=await readNextSessionReference('NIFTY',deps(d,async()=>{fetches++;return {}; }),now);
 assert.equal(p.ok,false);assert.equal(p.reason,'LATEST_SESSION_NO_CLOSE_MARKER');assert.equal(fetches,0);
});
test('invalid price, stale/untrusted marker and other symbols blocked',async()=>{
 assert.equal((await readNextSessionReference('BANKNIFTY',deps(),now)).reason,'INVALID_SYMBOL');
 assert.equal((await readNextSessionReference('NIFTY',deps(),new Date('2026-11-06T07:00:00Z'))).reason,'CLOSING_SESSION_NOT_FINISHED');
 assert.equal((await readNextSessionReference('NIFTY',deps(dates(),replay([{...row(),spot_high:24900}])),now)).reason,'INVALID_RECORDED_PRICE_RANGE');
 assert.equal((await readNextSessionReference('NIFTY',deps(dates(),replay([{...row(),truth_verdict:'FALSE'}])),now)).reason,'NO_VERIFIED_CLOSING_MARKET_ROW');
 assert.equal((await readNextSessionReference('NIFTY',deps(dates(),replay([row(),{...row(),spot_low:24800}])),now)).reason,'CONFLICTING_CLOSING_MARKET_ROWS');
});
test('older reference is explicitly historical; no synthetic date',async()=>{
 const old='2026-10-25',stamp='2026-10-25T09:59:00Z';
 const p=await readNextSessionReference('NIFTY',deps(dates(stamp,old),replay([{...row(stamp),minute_bucket:stamp,exchange_timestamp:stamp}])),now);
 assert.equal(p.ok,true);if(p.ok){assert.equal(p.status,'HISTORICAL_REFERENCE_ONLY');assert(p.warnings.includes('OLDER_THAN_SEVEN_CALENDAR_DAYS_NOT_NEXT_SESSION'));}
});
test('read failures return a reason, never synthetic data',async()=>{
 const p=await readNextSessionReference('NIFTY',deps(async()=>{throw Error('db offline');}),now);
 assert.equal(p.ok,false);assert.equal(p.reason,'RECORDED_DATE_INDEX_UNAVAILABLE');
});
