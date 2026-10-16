import test from 'node:test';import assert from 'node:assert/strict';
import {DashboardPcrSampler,measurePcrSnapshot,quoteTime} from '../dashboard-pcr-sampler.js';
import type {LiveEntry} from '../dashboard-live-feed.js';
const date='2026-10-16',at=Date.parse('2026-10-16T04:30:00Z');
const entries:LiveEntry[]=['CE','PE'].map((side,i)=>({token:10+i,exchange:'NFO',label:'OPTION'+side,role:'OPTION',symbol:'NIFTY',expiry:'2026-10-19',strike:23000,side:side as 'CE'|'PE'}));
const quotes=()=>Object.fromEntries(entries.map((e,i)=>[e.exchange+':'+e.label,{instrument_token:e.token,oi:i?200:100,timestamp:'2026-10-16 10:00:00'}]));
test('full snapshot uses source timestamp, exact tokens and all contracts; zero and missing remain distinct',()=>{
 assert.equal(quoteTime('2026-10-16 10:00:00'),at);assert(Number.isNaN(quoteTime('yesterday')));
 const q=quotes(),measure=()=>measurePcrSnapshot(entries,q,date,at);
 assert.equal(measure().fullPcr,2);assert.equal(measure().coverage.complete,true);
 q['NFO:OPTIONPE'].oi=0;assert.equal(measure().fullPcr,0);
 delete q['NFO:OPTIONPE'];assert.equal(measure().fullPcr,null);assert.equal(measure().coverage.missing,1);
 q['NFO:OPTIONPE']={...quotes()['NFO:OPTIONPE'],instrument_token:999};assert.equal(measure().coverage.invalid,1);
 q['NFO:OPTIONPE']={...quotes()['NFO:OPTIONPE'],timestamp:'2026-10-16 09:59:00'};assert.equal(measure().coverage.stale,1);
 assert.equal(measure().fullPcr,null);assert.equal(measure().unavailable[0].reason,'STALE_TIMESTAMP');
 q['NFO:OPTIONPE']=quotes()['NFO:OPTIONPE'];q['NFO:OPTIONCE'].oi=0;assert.equal(measure().fullPcr,null);
});
test('rejects overnight, future, source skew, invalid OI and duplicate identities',()=>{
 for(const patch of [{oi:null},{oi:-1},{oi:Infinity},{timestamp:'2026-10-15 10:00:00'},{timestamp:'2026-10-16 10:00:06'}]){
  const q=quotes();Object.assign(q['NFO:OPTIONPE'],patch);assert.equal(measurePcrSnapshot(entries,q,date,at).fullPcr,null);
 }
 const q=quotes();q['NFO:OPTIONPE'].timestamp='2026-10-16 10:00:05';q['NFO:OPTIONCE'].timestamp='2026-10-16 09:59:30';assert.equal(measurePcrSnapshot(entries,q,date,at).fullPcr,null);
 assert.equal(measurePcrSnapshot([...entries,entries[0]],quotes(),date,at).fullPcr,null);
 assert.equal(measurePcrSnapshot(entries,quotes(),date,at+86400000).fullPcr,null);
});
test('one process polls once per minute, never overlaps, stops on account error, and invalidates old result',async()=>{
 let now=at,calls=0,active=true,fail=false,release:()=>void=()=>{};
 let pending:Promise<void>|null=new Promise(resolve=>release=resolve);
 const sampler=new DashboardPcrSampler({date,entries,missing:[],omittedExpiries:[]},{now:()=>now,active:()=>active,wait:async()=>{},fetchQuotes:async keys=>{calls++;assert.equal(keys.length,2);if(pending)await pending;if(fail)throw Error('429');return quotes();}});
 const first=sampler.tick();await sampler.tick();assert.equal(calls,1);release();pending=null;await first;
 assert.equal(sampler.read('NIFTY','2026-10-19')?.fullPcr,2);await sampler.tick();assert.equal(calls,1);
 now+=90001;assert.equal(sampler.read('NIFTY','2026-10-19')?.state,'STALE');fail=true;await sampler.tick();assert.equal(calls,2);assert.equal(sampler.read('NIFTY','2026-10-19')?.fullPcr,null);
 assert.equal(sampler.read('NIFTY','wrong'),null);now+=60000;active=false;await sampler.tick();assert.equal(calls,2);
});
test('batches at 500 and bounds calls without mixing expiry totals',async()=>{
 let calls=0,waits=0;
 const many:LiveEntry[]=Array.from({length:1002},(_,i)=>({...entries[i%2],token:i+1,label:'OPT'+i,strike:23000+Math.floor(i/2),expiry:i<502?'2026-10-19':'2026-10-27'}));
 const sampler=new DashboardPcrSampler({date,entries:many,missing:[],omittedExpiries:[]},{now:()=>at,active:()=>true,wait:async ms=>{assert.equal(ms,1100);waits++;},fetchQuotes:async keys=>{calls++;assert(keys.length<=500);return Object.fromEntries(keys.map(key=>{const e=many.find(e=>e.exchange+':'+e.label===key)!;return [key,{instrument_token:e.token,oi:e.side==='CE'?100:300,timestamp:'2026-10-16 10:00:00'}];}));}});
 await sampler.tick();assert.equal(calls,3);assert.equal(waits,2);
 assert.equal(sampler.read('NIFTY','2026-10-19')?.fullPcr,3);assert.equal(sampler.read('NIFTY','2026-10-27')?.coverage.expected,500);
});
