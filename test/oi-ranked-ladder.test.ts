import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedOiRankFrame,deriveOiRankedLadder,renderOiRankedLadder} from '../oi-ranked-ladder.js';
const date='2026-11-05',expiry='2026-11-09',at=(n:number)=>Date.parse(date+'T03:45:00Z')+n*60000;
function snapshot(minute:number,ois=[100,300,200],runtime='r'){
 return {symbol:'NIFTY',date,expiry,runtime,cycle:at(minute),checked:at(minute),anchor:24000,rows:ois.map((oi,i)=>({strike:23950+i*50,...Object.fromEntries(['CE','PE'].map((side,j)=>[side,{symbol:'NIFTY',expiry,strike:23950+i*50,side,token:i*2+j+1,oi:side==='CE'?oi:400-oi,sourceAt:new Date(at(minute)).toISOString(),price:100+i+minute,priceAt:new Date(at(minute)).toISOString(),pdh:120,pdl:90}]))}))};
}
test('separate total/add/shedding ranks use the entire admitted side universe and exact changes',()=>{
 const s=deriveOiRankedLadder(snapshot(3,[150,250,500]),snapshot(0),{mode:'LIVE',minutes:3});
 const ce=s.rows.map((r:any)=>r.CE);assert.deepEqual(ce.map((r:any)=>r.totalRank),[3,2,1]);
 assert.deepEqual(ce.map((r:any)=>r.addRank),[2,null,1]);assert.deepEqual(ce.map((r:any)=>r.shedRank),[null,1,null]);
 assert.equal(ce[2].delta,300);assert.equal(ce[2].rankChange,1);assert.equal(ce[0].oiPercent,50);assert.equal(ce[0].priceDelta,3);
 assert.notDeepEqual(s.rows.map((r:any)=>r.PE?.totalRank),ce.map((r:any)=>r.totalRank));
});
test('ties share rank, zero OI is retained and zero baseline percentages stay unavailable',()=>{
 const s=deriveOiRankedLadder(snapshot(3,[200,200,0]),snapshot(0,[0,100,50]),{mode:'LIVE',minutes:3});
 assert.deepEqual(s.rows.map((r:any)=>r.CE.totalRank),[1,1,3]);assert.equal(s.rows[0].CE.oiPercent,null);assert.equal(s.rows[2].CE.delta,-50);
});
test('wrong runtime/date/expiry, missing or mistimed baseline withholds changes',()=>{
 for(const change of [{runtime:'other'},{date:'2026-11-04'},{expiry:'2026-11-16'},{cycle:at(1)}]){
  const s=deriveOiRankedLadder(snapshot(3),{...snapshot(0),...change},{mode:'LIVE',minutes:3});assert(s.rows.every((r:any)=>r.CE.delta===null&&r.CE.addRank===null));
 }
 assert(deriveOiRankedLadder(snapshot(3),null,{mode:'LIVE',minutes:3}).rows.length);
});
test('stale OI drops its rank while stale premium alone preserves valid OI with missing price',()=>{
 const c=snapshot(3);c.rows[0].CE.sourceAt=new Date(at(3)-31000).toISOString();c.rows[1].CE.priceAt=new Date(at(3)-31000).toISOString();
 const s=deriveOiRankedLadder(c,snapshot(0),{mode:'LIVE',minutes:3});assert.equal(s.rows[0].CE,undefined);assert.equal(s.rows[1].CE.price,null);assert.equal(s.rows[1].CE.priceDelta,null);assert.notEqual(s.rows[1].CE.totalRank,null);
});
test('changed inventory or token withholds rank movement, and changed token cannot borrow OI baseline',()=>{
 const c=snapshot(3);c.rows[0].CE.token=999;
 const s=deriveOiRankedLadder(c,snapshot(0),{mode:'LIVE',minutes:3});assert.equal(s.rows[0].CE.delta,null);assert(s.rows.every((r:any)=>r.CE.rankChange===null));
});
test('From Open requires an actual 09:15 baseline, never the first connection packet',()=>{
 assert.equal(deriveOiRankedLadder(snapshot(15),snapshot(3),{mode:'LIVE',minutes:'OPEN'}).baselineAt,null);
 assert.equal(deriveOiRankedLadder(snapshot(15),snapshot(0),{mode:'LIVE',minutes:'OPEN'}).baselineAt,at(0));
});
function recorded(){const r=snapshot(3);return {symbol:'NIFTY',date,market:[{symbol:'NIFTY',minute_bucket:new Date(at(3)).toISOString(),snapshot_id:'s',truth_verdict:'TRUE',backend_timestamp:new Date(at(3)).toISOString(),spot_ltp:24000}],options:r.rows.flatMap(row=>['CE','PE'].map(side=>({...row[side as 'CE'],option_type:side,minute_bucket:new Date(at(3)).toISOString(),snapshot_id:'s',truth_verdict:'TRUE',quote_timestamp:new Date(at(3)).toISOString(),ltp:100,oi:'300'})))};}
test('recorded adapter admits only exact time/index/expiry with receipt evidence and does not infer OI publication freshness',()=>{
 const f=recorded();const a=recordedOiRankFrame(f,new Date(at(3)).toISOString(),expiry);assert.equal(a.rows.length,3);assert.equal(a.rows[0].CE.oi,300);
 f.options[0].snapshot_id='wrong';assert.equal(recordedOiRankFrame(f,new Date(at(3)).toISOString(),expiry).rows[0].CE,undefined);
 assert.equal(recordedOiRankFrame(f,new Date(at(2)).toISOString(),expiry).rows.length,0);
 const model=deriveOiRankedLadder(a,null,{minutes:3});assert.match(model.oiClock,/publication time unavailable/);
});
test('ambiguous recorded duplicates, invalid OI and wrong sessions never rank',()=>{
 const f=recorded();f.options.push({...f.options[0]});f.options[1].oi='-1';
 const a=recordedOiRankFrame(f,new Date(at(3)).toISOString(),expiry);assert.equal(a.rows.length,2);
 assert.equal(recordedOiRankFrame({...f,date:'2026-11-04'},new Date(at(3)).toISOString(),expiry).rows.length,0);
});
test('renderer exposes top ranks, selected focus, source units, missing levels and escaped identity',()=>{
 const m=deriveOiRankedLadder(snapshot(3,[150,250,500]),snapshot(0),{mode:'LIVE',minutes:3});
 const html=renderOiRankedLadder(m,{focus:'SHED',band:3});assert.match(html,/Top shedding/);assert.match(html,/LEVELS UNAVAILABLE/);assert.match(html,/Source OI units/);assert.match(html,/OI rank is position concentration/);assert.match(html,/ATM now/);
 m.symbol='<img src=x onerror=bad>';
 assert.doesNotMatch(renderOiRankedLadder(m),/<img/);
});
test('invalid clocks and duplicate source tokens cannot invent a baseline or rank',()=>{
 const c=snapshot(3);c.rows[0].CE.token=c.rows[1].CE.token;
 const m=deriveOiRankedLadder(c,snapshot(0),{mode:'LIVE',minutes:3});assert.equal(m.rows[0].CE,undefined);assert.equal(m.rows[1].CE,undefined);
 const s=deriveOiRankedLadder(snapshot(3),{...snapshot(0),checked:NaN},{mode:'LIVE',minutes:3});assert(s.rows.every((r:any)=>r.CE.delta===null));
});
test('band changes do not re-rank the source and top-strike focus can center outside the ATM band',()=>{
 const c=snapshot(3),b=snapshot(0);
 for(let i=0;i<20;i++){const strike=25000+i*50;const r={...c.rows[0].CE,strike,token:100+i,oi:10000+i};c.rows.push({strike,CE:r});}
 const m=deriveOiRankedLadder(c,b,{mode:'LIVE',minutes:3}),one=renderOiRankedLadder(m,{band:3,center:25950});
 assert.match(one,/data-oir-strike="25950"/);assert.match(one,/#1/);assert.match(one,/25,950/);
 assert.equal(m.rows.at(-1).CE.totalRank,1);
});
test('recorded premium freshness uses its market receipt, not the start of the minute bucket',()=>{
 const f=recorded();f.market[0].backend_timestamp=new Date(at(3)+24000).toISOString();
 for(const r of f.options)r.quote_timestamp=new Date(at(3)+10000).toISOString();
 const frame=recordedOiRankFrame(f,new Date(at(3)).toISOString(),expiry);
 const m=deriveOiRankedLadder(frame,null,{minutes:3});assert.equal(m.rows[0].CE.price,100);assert.equal(m.at,at(3)+24000);
});

test('strike PCR uses qualified paired OI, keeps zero PE and withholds a missing or zero CE denominator',()=>{
 const c=snapshot(3,[100,400,0]),b=snapshot(0);
 const m=deriveOiRankedLadder(c,b,{mode:'LIVE',minutes:3});
 assert.equal(m.rows[0].pcr,3);assert.equal(m.rows[0].pcrDelta,0);
 assert.equal(m.rows[1].pcr,0);assert.equal(m.rows[2].pcr,null);
 c.rows[0].PE.sourceAt=new Date(at(3)-31000).toISOString();
 assert.equal(deriveOiRankedLadder(c,b,{mode:'LIVE'}).rows[0].pcr,null);
 c.rows[1].PE.token=999;
 assert.equal(deriveOiRankedLadder(c,b,{mode:'LIVE'}).rows[1].pcrDelta,null);
});

test('full PCR is never synthesized from the viewport or recorded CORE inventory',()=>{
 const c:any=snapshot(3),b:any=snapshot(0);c.pcr=1.23456;b.pcr=1.1;
 const m=deriveOiRankedLadder(c,b,{mode:'LIVE'});
 assert.equal(m.fullPcr,1.23456);assert(Math.abs(m.fullPcrDelta-.13456)<1e-10);
 assert.equal(deriveOiRankedLadder(c,b,{mode:'RECORDED'}).fullPcr,null);
 c.rows[0].CE.sourceAt=new Date(at(3)-31000).toISOString();
 assert.equal(deriveOiRankedLadder(c,b,{mode:'LIVE'}).fullPcr,null);
});

test('archived full PCR requires exact cursor, expiry, snapshot identity, unique chain and approved provenance',()=>{
 const f:any=recorded(),time=new Date(at(3)).toISOString();
 const row={symbol:'NIFTY',expiry,minute_bucket:time,snapshot_id:'s',truth_verdict:'TRUE',full_pcr_source:'Exact archived full-chain source',full_chain_oi_pcr:1.25};
 f.chain=[row];assert.equal(recordedOiRankFrame(f,time,expiry).fullPcr,1.25);
 const withoutId={...row};delete (withoutId as any).snapshot_id;f.chain=[withoutId];assert.equal(recordedOiRankFrame(f,time,expiry).fullPcr,1.25);
 for(const change of [{snapshot_id:'other'},{minute_bucket:new Date(at(2)).toISOString()},{expiry:'2026-11-16'},{full_pcr_source:'CORE subset'},{full_chain_oi_pcr:Infinity}]){
  f.chain=[{...row,...change}];assert.equal(recordedOiRankFrame(f,time,expiry).fullPcr,null);
 }
 f.chain=[row,row];assert.equal(recordedOiRankFrame(f,time,expiry).fullPcr,null);
});

test('premium range notes distinguish touches and breaks and reject reversed or nonfinite levels',()=>{
 const c=snapshot(3);c.rows[0].CE.price=120;c.rows[1].CE.price=90;c.rows[2].CE.price=130;
 let m=deriveOiRankedLadder(c,null,{mode:'RECORDED'});
 assert.deepEqual(m.rows.map((r:any)=>r.CE.state),['AT PDH','AT PDL','ABOVE PDH']);
 c.rows[0].CE.price=100;c.rows[1].CE.price=80;c.rows[2].CE.pdl=140;
 m=deriveOiRankedLadder(c,null,{mode:'RECORDED'});
 assert.match(m.rows[0].CE.state,/IN RANGE/);assert.equal(m.rows[1].CE.state,'BELOW PDL');assert.equal(m.rows[2].CE.state,'LEVELS UNAVAILABLE');assert.equal(m.rows[2].CE.pdh,null);
 assert(deriveOiRankedLadder(c,null,{mode:'LIVE'}).rows.every((r:any)=>r.CE.pdh===null&&r.CE.pdl===null));
});

test('all display provides independent OI, premium and PCR arrows with visible level notes',()=>{
 const c:any=snapshot(3,[150,250,300]);c.pcr=1.23456;c.rows[0].CE.price=99;
 const html=renderOiRankedLadder(deriveOiRankedLadder(c,snapshot(0),{mode:'RECORDED'}));
 for(const view of ['OI','PCR','PREMIUM','ALL'])assert(html.includes('data-oir-view-option="'+view+'"'));
 assert.match(html,/↑ \+50 ADD/);assert.match(html,/Premium ↓ -1/);assert.match(html,/IN RANGE/);assert.match(html,/Strike PE OI ÷ CE OI/);assert.match(html,/qualified full-chain source unavailable/);
});
