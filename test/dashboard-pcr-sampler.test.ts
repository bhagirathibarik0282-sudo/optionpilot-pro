import test from 'node:test';import assert from 'node:assert/strict';
import {DashboardPcrSampler,measurePcrSnapshot,quoteTime,partitionPcrQuoteKeys,PCR_MAX_QUERY_CHARS} from '../dashboard-pcr-sampler.js';
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

test('cycle-start time stays independent of quote completion latency',async()=>{
 let now=at;const sampler=new DashboardPcrSampler({date,entries,missing:[],omittedExpiries:[]},{now:()=>now,active:()=>true,wait:async()=>{},fetchQuotes:async()=>{now+=12000;return quotes();}});
 await sampler.tick();const result=sampler.read('NIFTY','2026-10-19');assert.equal(result?.cycleStartedAt,new Date(at).toISOString());assert.equal(result?.checkedAt,new Date(at+12000).toISOString());assert.equal(result?.fullPcr,2);
});
function wideChain(){
 const es:LiveEntry[]=Array.from({length:41},(_,i)=>['CE','PE'].map((side,j)=>({token:100+i*2+j,exchange:'NFO',label:'NIFTY'+i+side,role:'OPTION' as const,symbol:'NIFTY' as const,expiry:'2026-10-19',strike:23000+(i-20)*50,side:side as 'CE'|'PE'}))).flat();
 const qs=Object.fromEntries(es.map(e=>[e.exchange+':'+e.label,{instrument_token:e.token,oi:e.side==='CE'?100:Math.abs(e.strike!-23000)<=350?300:100,timestamp:new Date(at).toISOString()}]));
 const spot:any={identity:{role:'SPOT',symbol:'NIFTY'},state:'LIVE',price:23000,observedAt:new Date(at).toISOString(),receivedAt:new Date(at).toISOString()};
 return {es,qs,spot};
}
test('band PCR uses exactly ATM +/-7 listed strikes and the same complete full-expiry quote batch',()=>{
 const {es,qs,spot}=wideChain(),s=measurePcrSnapshot(es,qs,date,at,at,spot);
 assert.equal(s.fullPcr,7100/4100);assert.equal(s.bandPcr.value,3);assert.equal(s.bandPcr.anchorStrike,23000);assert.equal(s.bandPcr.fromStrike,22650);assert.equal(s.bandPcr.toStrike,23350);assert.equal(s.bandPcr.strikeCount,15);assert.equal(s.bandPcr.freshOi,30);assert.equal(s.bandPcr.ceTotal,1500);assert.equal(s.bandPcr.peTotal,4500);
});
test('missing, stale, future, wrong-index or unsynced spot withholds only the band',()=>{
 for(const patch of [(s:any)=>s.price=null,(s:any)=>s.state='STALE',(s:any)=>s.identity.symbol='SENSEX',(s:any)=>s.observedAt=new Date(at-31000).toISOString(),(s:any)=>s.receivedAt=new Date(at+1).toISOString(),(s:any)=>s.observedAt=new Date(at+6000).toISOString()]){const {es,qs,spot}=wideChain();patch(spot);const s=measurePcrSnapshot(es,qs,date,at,at,spot);assert.equal(s.bandPcr.value,null);assert.equal(s.fullPcr,7100/4100);}
 const {es,qs}=wideChain();assert.equal(measurePcrSnapshot(es,qs,date,at).bandPcr.value,null);
});
test('edge bands, missing opposite contracts and zero CE denominator never pretend to be a complete band',()=>{
 const {es,qs,spot}=wideChain();spot.price=22000;assert.equal(measurePcrSnapshot(es,qs,date,at,at,spot).bandPcr.value,null);spot.price=23000;
 const incomplete=es.filter(e=>!(e.strike===23000&&e.side==='PE'));assert.equal(measurePcrSnapshot(incomplete,qs,date,at,at,spot).bandPcr.value,null);
 for(const e of es)if(e.side==='CE'&&Math.abs(e.strike!-23000)<=350)qs[e.exchange+':'+e.label].oi=0;
 assert.equal(measurePcrSnapshot(es,qs,date,at,at,spot).bandPcr.value,null);
});
test('zero put OI survives in the band, while an unavailable outer full-chain quote revokes the band',()=>{
 const {es,qs,spot}=wideChain();for(const e of es)if(e.side==='PE'&&Math.abs(e.strike!-23000)<=350)qs[e.exchange+':'+e.label].oi=0;
 assert.equal(measurePcrSnapshot(es,qs,date,at,at,spot).bandPcr.value,0);
 delete qs[es[0].exchange+':'+es[0].label];assert.equal(measurePcrSnapshot(es,qs,date,at,at,spot).fullPcr,null);assert.equal(measurePcrSnapshot(es,qs,date,at,at,spot).bandPcr.value,null);
});
test('ATM is frozen once per OI snapshot; later price ticks do not silently change the band or add requests',async()=>{
 const {es,qs,spot}=wideChain();let now=at,calls=0,reads=0;
 const sampler=new DashboardPcrSampler({date,entries:es,missing:[],omittedExpiries:[]},{now:()=>now,active:()=>true,wait:async()=>{},fetchQuotes:async()=>{calls++;return qs;},readSpot:()=>{reads++;return spot;}});
 await sampler.tick();assert.equal(calls,1);assert.equal(reads,1);assert.equal(sampler.read('NIFTY','2026-10-19')?.bandPcr.anchorStrike,23000);
 spot.price=23100;assert.equal(sampler.read('NIFTY','2026-10-19')?.bandPcr.anchorStrike,23000);assert.equal(calls,1);assert.equal(reads,1);
 now+=90001;assert.equal(sampler.read('NIFTY','2026-10-19')?.bandPcr,null);
});

test('Kite PCR batches honor encoded URL length and 500-count simultaneously, with no token omission',async()=>{
 const many:LiveEntry[]=Array.from({length:1101},(_,i)=>({
  token:2000+i,exchange:i%3===0?'BFO':'NFO',label:'BANKNIFTY26OCT2026'+String(20000+i).padStart(5,'0')+(i%2?'PE':'CE'),
  symbol:'BANKNIFTY',role:'OPTION',expiry:'2026-10-27',strike:20000+Math.floor(i/2),side:i%2?'PE':'CE'
 }));
 const batches=partitionPcrQuoteKeys(many);
 assert(batches.length>3,'long exchange-qualified symbols require URL-aware batches');
 assert.equal(batches.flat().length,many.length);
 assert.equal(new Set(batches.flat()).size,many.length);
 for(const keys of batches){
  assert(keys.length<=500);
  const query=new URLSearchParams();for(const key of keys)query.append('i',key);
  assert(query.toString().length<=PCR_MAX_QUERY_CHARS,'encoded query must fit budget');
 }
 let calls=0,waits=0;
 const sampler=new DashboardPcrSampler({entries:many,date,missing:[],omittedExpiries:[]},{
  now:()=>at,active:()=>true,wait:async ms=>{assert(ms>=1000);waits++;},
  fetchQuotes:async keys=>{calls++;assert(keys.length<=500);return Object.fromEntries(keys.map(k=>{
   const e=many.find(x=>x.exchange+':'+x.label===k)!;
   return [k,{instrument_token:e.token,oi:100,timestamp:new Date(at).toISOString()}];
  }));}
 });
 await sampler.tick();
 assert.equal(calls,batches.length);
 assert.equal(waits,calls-1);
 const q=sampler.read('BANKNIFTY','2026-10-27');
 assert.equal(q?.fetchState,'OK');
 assert.equal(q?.batchesCompleted,calls);
 assert.equal(q?.coverage.expected,many.length);
 assert.equal(q?.coverage.complete,true);
});
test('Kite full PCR failures are explicit, credential-safe and never reused as a fresh snapshot',async()=>{
 for(const [code,expected] of [['PCR_QUOTE_HTTP_429','RATE_LIMITED'],['PCR_QUOTE_HTTP_414','REQUEST_REJECTED'],
  ['PCR_QUOTE_HTTP_403','SESSION_REQUIRED'],['PCR_QUOTE_INVALID_RESPONSE','UPSTREAM_UNAVAILABLE']]){
  let current=at,fail=false;
  const sampler=new DashboardPcrSampler({date,entries,missing:[],omittedExpiries:[]},{
   now:()=>current,active:()=>true,wait:async()=>{},
   fetchQuotes:async()=>{if(fail)throw Error(code);return quotes();}
  });
  await sampler.tick();assert.equal(sampler.read('NIFTY','2026-10-19')?.fullPcr,2);
  current+=60000;fail=true;await sampler.tick();
  const q=sampler.read('NIFTY','2026-10-19');
  assert.equal(q?.fullPcr,null);
  assert.equal(q?.coverage.complete,false);
  assert.equal(q?.fetchState,expected);
  assert.equal(q?.batchesRequested,1);
  assert.equal(q?.batchesCompleted,0);
  assert(!JSON.stringify(q).includes('Authorization'),'auth headers cannot be reflected');
 }
});
test('encoded query protects against one impossible instrument key',()=>{
 const tooLong:LiveEntry={...entries[0],label:'S'.repeat(7000)};
 assert.throws(()=>partitionPcrQuoteKeys([tooLong]),/IDENTITY_TOO_LONG/);
});
