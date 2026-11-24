import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEventBuyerHypothesis as evaluate} from '../event-buyer-hypothesis.js';
const date='2026-11-24',t=(m:number)=>new Date(Date.parse(date+'T10:00:00+05:30')+m*60000).toISOString();
const event={tradeDate:date,symbol:'NIFTY',strike:25500,expiry:'2026-11-26',at:t(0)};
const pair=(offset:number,price:number,weak=90)=>({offset,at:t(offset),pe:{price,pdl:50},ce:{price:weak,pdl:100},spot:25000-offset,fullPcr:1-offset*.01,fullPcrSource:'Normalized full-chain source'});
const rows=[pair(-3,90,110),pair(0,100)];
const near={symbol:'NIFTY',strike:25500,expiry:event.expiry,dte:2,ceCrossing:'OBSERVED_PDL_CROSSING',peCrossing:'NO_DOWN_CROSSING',rows};
const far={...near,expiry:'2026-12-03',dte:9};
const path=[pair(1,110),pair(2,130),pair(3,140),pair(4,115)];
const run=(cursor=4,pairs:any[]=[near,far],samples:any[]=path,known=t(0))=>evaluate({date,replay:{active:true,at:t(cursor)}},event,known,pairs,(_s:any,_e:any,_k:any,offsets:number[])=>samples.filter(r=>offsets.includes(r.offset)))[0];
test('two-expiry PE hypothesis waits for next exact sample, then trails without claiming execution',()=>{
 const waiting=run(0);assert.equal(waiting.status,'WAIT_FOR_SAMPLE');assert.equal(waiting.entry,null);
 const r=run();assert.equal(r.side,'PE');assert.equal(r.entry.at,t(1));assert.equal(r.initialStop,90);assert.equal(r.trail[1].stop,110);assert.equal(r.trail[2].stop,120);assert.equal(r.exit.at,t(4));assert.equal(r.exit.reason,'SAMPLED_STOP_THRESHOLD');assert.equal(r.netPnl,null);assert.equal(r.affectsExecution,false);
});
test('missing expiry, conflict, missing PCR, gaps and late event never authorize entry or inferred exit',()=>{
 assert.equal(run(4,[near]).status,'NO_CANDIDATE');
 assert.equal(run(4,[near,{...far,ceCrossing:'UNAVAILABLE'}]).entry,null);
 assert.equal(run(4,[{...near,peCrossing:'OBSERVED_PDL_CROSSING'},{...far,peCrossing:'OBSERVED_PDL_CROSSING'}]).entry,null);
 assert.equal(run(4,[{...near,rows:[rows[0],{...rows[1],fullPcr:null}]},far]).entry,null);
 assert.equal(run(4,[near,far],path.slice(1)).status,'UNVERIFIED');
 const gap=run(4,[near,far],[path[0],path[2],path[3]]);assert.equal(gap.status,'UNVERIFIED');assert.equal(gap.exit,null);
 assert.equal(run(4,[near,far],path,t(2)).entry.at,t(3));
 assert.equal(run(2).exit,null);
});
