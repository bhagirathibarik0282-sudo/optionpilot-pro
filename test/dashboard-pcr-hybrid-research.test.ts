import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePcrCaches} from '../dashboard-pcr-hybrid-research.js';
import type {LiveEntry} from '../dashboard-live-feed.js';
const date='2026-11-26',now=Date.parse(date+'T11:00:00+05:30');
const entries:LiveEntry[]=[{token:1,label:'C',role:'OPTION',symbol:'NIFTY',expiry:'2026-12-01',strike:26000,side:'CE'},{token:2,label:'P',role:'OPTION',symbol:'NIFTY',expiry:'2026-12-01',strike:26000,side:'PE'}];
const row=(e:LiveEntry,oi:number,age:number)=>({token:e.token,responseToken:e.token,symbol:e.symbol,expiry:e.expiry,strike:e.strike,side:e.side,oi,sourceAt:new Date(now-age*1000).toISOString(),batchReceivedAt:new Date(now-1000).toISOString()});
test('fresh WS recovers only the exact stale REST leg',()=>{
 const r=[row(entries[0],100,1),row(entries[1],200,60)],w=[row(entries[0],100,60),row(entries[1],150,2)];
 const q=comparePcrCaches(entries,r,w,date,now);
 assert.equal(q.complete,true);assert.equal(q.pcr,1.5);assert.equal(q.restOnly,1);assert.equal(q.wsOnly,1);
 assert.equal(q.researchOnly,true);assert.equal(r[1].oi,200);
});
test('rejects same-timestamp disagreement, absent legs and token mismatch',()=>{
 const r=[row(entries[0],100,1),row(entries[1],200,1)];
 const w=[row(entries[0],101,1),row(entries[1],200,1)];
 assert.equal(comparePcrCaches(entries,r,w,date,now).sameTimestampConflict,1);
 assert.equal(comparePcrCaches(entries,r,w,date,now).pcr,null);
 assert.equal(comparePcrCaches(entries,r.slice(0,1),w,date,now).pcr,null);
 const stale=[r[0],row(entries[1],200,90)];
 const wrong={...w[1],responseToken:99};
 assert.equal(comparePcrCaches(entries,stale,[wrong],date,now).pcr,null);
});
test('rejects stale receipt, prior-session data, and greater-than-30s cross-source skew',()=>{
 const r=[row(entries[0],100,30),row(entries[1],200,60)];
 const w=[row(entries[0],100,60),row(entries[1],200,-2)];
 assert.equal(comparePcrCaches(entries,r,w,date,now).pcr,null);
 const staleReceipt={...row(entries[1],200,1),batchReceivedAt:new Date(now-31000).toISOString()};
 assert.equal(comparePcrCaches(entries,r,[staleReceipt],date,now).pcr,null);
 const prior={...row(entries[1],200,1),sourceAt:'2026-11-25T09:30:00+05:30'};
 assert.equal(comparePcrCaches(entries,r,[prior],date,now).pcr,null);
});
