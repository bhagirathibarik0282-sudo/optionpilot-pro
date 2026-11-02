import test from 'node:test';
import assert from 'node:assert/strict';
import {measurePcrSnapshot} from '../dashboard-pcr-sampler.js';
import {inspectPcrAvailability} from '../scripts/check-full-pcr-availability.js';
import {deriveLiveThreeIndexPcr} from '../live-three-index-pcr.js';
import type {LiveEntry} from '../dashboard-live-feed.js';

/** Fixture-only contract test. Never a live price, signal or trading permission. */
const date='2026-11-02',now=Date.parse('2026-11-02T04:15:00Z');
const symbols=['NIFTY','SENSEX','BANKNIFTY'] as const;
const expiries=['2026-11-03','2026-11-05','2026-11-23'] as const;
type Mutation=(symbol:string,key:string,quote:any)=>void;
function fixture(mutate:Mutation=()=>{}){
 const indices=symbols.map((symbol,i)=>{
  const expiry=expiries[i];
  const entries:LiveEntry[]=(['CE','PE'] as const).map((side,j)=>({
   role:'OPTION',symbol,expiry,strike:[23000,75000,55000][i],side,
   exchange:i===1?'BFO':'NFO',label:symbol+expiry+side,token:101+i*10+j
  }));
  const quotes:Record<string,any>={};
  for(const [j,e] of entries.entries()){
   const key=e.exchange+':'+e.label;
   const quote:any={instrument_token:e.token,oi:j===0?100:(i+2)*100,timestamp:new Date(now).toISOString()};
   mutate(symbol,key,quote);
   if(!quote.__omit)quotes[key]=quote;
  }
  const pcrSnapshot={...measurePcrSnapshot(entries,quotes,date,now),fetchState:'OK'};
  return {symbol,expiry,expiries:[expiry],pcrSnapshot};
 });
 return {connected:true,connectionState:'OPEN',source:'KITE_WEBSOCKET_FULL',serverTime:new Date(now).toISOString(),
  snapshot:{runtimeId:'stable-fixture',tradeDate:date,asOf:new Date(now).toISOString(),indices}};
}
const read=(p:any)=>Object.fromEntries(inspectPcrAvailability(p).rows.map(r=>[r.symbol,r]));
test('one source snapshot validates all three exact-expiry full ratios across calculation and dashboard model',()=>{
 const p=fixture(),audit=inspectPcrAvailability(p);
 const v=deriveLiveThreeIndexPcr({...p,pcrDisplay:Object.fromEntries(p.snapshot.indices.map(a=>[a.symbol,{...a.pcrSnapshot,expiry:a.expiry,periodMs:60000}]))});
 assert.equal(audit.ok,true);assert.equal(audit.allThreeReportedComplete,true);assert.equal(v.rows.length,3);
 for(const [i,symbol] of symbols.entries()){
  const a=audit.rows.find(x=>x.symbol===symbol)!;const b=v.rows.find(x=>x.symbol===symbol)!;
  assert.equal(a.observation,'FRESH_FULL');assert.equal(a.value,i+2);
  assert.equal(b.value,i+2);assert.equal(a.expiry,expiries[i]);assert.equal(a.expected,2);assert.equal(a.fresh,2);
 }
});
test('one older same-day SENSEX contract permits labelled reported value but blocks fresh alignment',()=>{
 const p=fixture((s,k,q)=>{if(s==='SENSEX'&&k.endsWith('PE'))q.timestamp=new Date(now-120000).toISOString();});
 const a=inspectPcrAvailability(p),r=read(p);
 assert.equal(a.ok,false);assert.equal(a.allThreeReportedComplete,true);
 assert.equal(r.SENSEX.observation,'SAME_SESSION_REPORTED');assert.equal(r.SENSEX.value,3);
 assert.equal(r.SENSEX.old,1);assert.equal(r.NIFTY.observation,'FRESH_FULL');
 assert.equal(r.BANKNIFTY.observation,'FRESH_FULL');
});
test('missing or token-invalid BANKNIFTY PE blocks all-three reported qualification without cross-index borrowing',()=>{
 for(const change of [
  (s:string,k:string,q:any)=>{if(s==='BANKNIFTY'&&k.endsWith('PE'))q.__omit=true;},
  (s:string,k:string,q:any)=>{if(s==='BANKNIFTY'&&k.endsWith('PE'))q.instrument_token=999999;}
 ]){
  const p=fixture(change),a=inspectPcrAvailability(p),r=read(p);
  assert.equal(a.ok,false);assert.equal(a.allThreeReportedComplete,false);
  assert.equal(r.BANKNIFTY.value,null);assert.equal(r.BANKNIFTY.observation,'UNAVAILABLE');
  assert.equal(r.NIFTY.value,2);assert.equal(r.SENSEX.value,3);
 }
});
test('previous-session OI is visibly earlier-packet context and is never freshly aligned',()=>{
 const p=fixture((s,k,q)=>{if(s==='SENSEX'&&k.endsWith('PE'))q.timestamp='2026-10-30 15:30:00';});
 const r=read(p);assert.equal(inspectPcrAvailability(p).ok,false);
 assert.equal(r.SENSEX.observation,'LAST_REPORTED_EARLIER_PACKETS');
 assert.equal(r.SENSEX.value,3);assert.match(String(r.SENSEX.sourceNote),/2026-10-30/);
});
test('disconnection and duplicate index revoke all improperly qualified values',()=>{
 const p:any=fixture();p.connected=false;
 assert.equal(inspectPcrAvailability(p).ok,false);
 assert.equal(inspectPcrAvailability(p).allThreeReportedComplete,false);
 assert(inspectPcrAvailability(p).rows.every(r=>r.value===null));
 const duplicate:any=fixture();duplicate.snapshot.indices.push(structuredClone(duplicate.snapshot.indices[0]));
 assert.equal(read(duplicate).NIFTY.value,null);assert.equal(inspectPcrAvailability(duplicate).ok,false);
});
