import test from 'node:test';
import assert from 'node:assert/strict';
import {scanRecordedRagDay} from '../rag-full-day-scanner.js';

test('full day scanner fails closed for incomplete replay',()=>{
 const x:any={ok:true,request:{symbol:'NIFTY',tradeDate:'2026-10-16',scope:'FULL',fromTime:'09:15',toTime:'09:30'},market:[],options:[]};
 const r=scanRecordedRagDay(x,{symbol:'NIFTY',date:'2026-10-16',side:'BOTH',minExpiries:2});
 assert.equal(r.ok,false);
 assert.equal(r.reason,'FULL_DAY_RANGE_REQUIRED');
});
test('full day scanner returns no fabricated events from empty data',()=>{
 const x:any={ok:true,request:{symbol:'NIFTY',tradeDate:'2026-10-16',scope:'FULL',fromTime:'09:15',toTime:'15:30'},market:[],options:[]};
 const r=scanRecordedRagDay(x,{symbol:'NIFTY',date:'2026-10-16',side:'BOTH',minExpiries:2});
 assert.equal(r.ok,true);
 assert.equal(r.events.length,0);
 assert.equal(r.status,'NO_VERIFIED_PAIRS');
});
