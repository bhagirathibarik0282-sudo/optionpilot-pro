import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEventBuyerSession} from '../event-buyer-batch-audit.js';
const date='2026-11-24',symbol='NIFTY',expiries=['2026-11-26','2026-12-03'],t=(m:number)=>new Date(Date.parse(date+'T09:15:00+05:30')+m*60000).toISOString();
test('missing source is unavailable rather than zero-trade performance',()=>{const r=auditEventBuyerSession({date,symbol,expiries});assert.equal(r.status,'UNAVAILABLE');assert.equal(r.netPnl,null);assert.equal(r.profitFactor,null);});
test('partial three-minute archive and missing memory availability remain explicit',()=>{
 const market=Array.from({length:126},(_,i)=>({symbol,minute_bucket:t(i*3),truth_verdict:'TRUE'}));
 const recorded={ok:true,request:{symbol,tradeDate:date},market,options:[],chain:[]};
 const memory={ok:true,tradeDate:date,events:[],responses:[],availability:{events:{},responses:{}}};
 const r=auditEventBuyerSession({date,symbol,expiries,recorded,memory});assert.equal(r.trueMarketMinutes,126);assert.equal(r.status,'PARTIAL_MARKET_GRID');assert.equal(r.sampled.meanR,null);assert.equal(r.netPnl,null);assert.equal(r.timingComparison.matchedClosedEvents,0);assert.equal(r.timingComparison.policies.length,4);assert.ok(r.timingComparison.policies.every((p:any)=>p.meanSampledR===null&&p.matchedMeanSampledR===null));
 assert.equal(auditEventBuyerSession({date,symbol,expiries,recorded,memory:{...memory,availability:null}}).status,'UNAVAILABLE');
 assert.equal(auditEventBuyerSession({date,symbol,expiries:[expiries[0],expiries[0]],recorded,memory}).status,'UNAVAILABLE');
});
