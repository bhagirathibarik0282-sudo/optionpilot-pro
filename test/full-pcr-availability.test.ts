import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPcrAvailability} from '../scripts/check-full-pcr-availability.js';
import {measurePcrSnapshot} from '../dashboard-pcr-sampler.js';

function snapshot(earlier=false){
 const date='2026-10-30',stamp=date+'T05:00:00.000Z',now=Date.parse(stamp),expiry='2026-11-03';
 return {connected:true,connectionState:'OPEN',source:'KITE_WEBSOCKET_FULL',serverTime:stamp,snapshot:{runtimeId:'audit-test',tradeDate:date,asOf:stamp,indices:['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>{
  const entries:any[]=['CE','PE'].map((side,i)=>({token:i+1,label:symbol+side,exchange:'NFO',role:'OPTION',symbol,expiry,strike:23000,side}));
  const quotes=Object.fromEntries(entries.map(e=>['NFO:'+e.label,{instrument_token:e.token,oi:e.side==='CE'?100:200,timestamp:earlier?'2026-10-29 15:30:00':stamp}]));
  return {symbol,expiry,expiries:[expiry],pcrSnapshot:{...measurePcrSnapshot(entries,quotes,date,now),fetchState:'OK'}};
 })}};
}
test('production availability audit cannot pass on a reported ratio or an outside-hours response',()=>{
 const p=inspectPcrAvailability(snapshot(true));assert.equal(p.ok,false);assert.equal(p.allThreeReportedComplete,true);
 assert(p.rows.every(r=>r.value===2&&r.observation==='LAST_REPORTED_EARLIER_PACKETS'&&r.sourceNote?.includes('2026-10-29')));
 const closed=inspectPcrAvailability({error:'OUTSIDE_OPERATING_HOURS'});assert.equal(closed.ok,false);assert.equal(closed.allThreeReportedComplete,false);assert.equal(closed.runtimeReason,'OUTSIDE_OPERATING_HOURS');
});
test('production availability audit requires all three independently verified full expiries',()=>{
 const source=snapshot();assert.equal(inspectPcrAvailability(source).ok,true);
 source.snapshot.indices.pop();const p=inspectPcrAvailability(source);assert.equal(p.ok,false);assert.equal(p.allThreeReportedComplete,false);
});
