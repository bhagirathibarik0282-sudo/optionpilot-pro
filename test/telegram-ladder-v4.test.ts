import test from 'node:test';
import assert from 'node:assert/strict';
import {SYMBOLS,value,missing,numeric,sessionWindows,dueWindows,renderWindow,renderEod,renderSummary,splitLadder,type MinuteFrame,type Window} from '../telegram-ladder-v4.js';
import {framesFromH1} from '../telegram-ladder-recorder-adapter.js';
import {enqueueLadderReports,deliverLadderJob,reportJob,type Job,type LadderOutbox} from '../telegram-ladder-outbox.js';
const d='2026-10-29',base=Date.parse(d+'T09:15:00+05:30');
const v=(n:number)=>value(n,'VERIFIED','TEST_SAME_UNIVERSE');
const frame=(m:number):MinuteFrame=>({minute:new Date(base+m*60_000).toISOString(),indices:SYMBOLS.map(symbol=>({symbol,spot:v(100+m),pdh:v(105),pdl:v(90),expiries:[{expiry:'2026-11-03',volumeScope:'FULL',pcr:{full:v(1+m/100),band7:v(1+m/100),volume:v(1+m/100)},ceWall:{strike:110,oi:v(1000+m)},peWall:{strike:90,oi:v(1000+m)},contracts:[{strike:100,side:'CE',ltp:v(10+m),pdh:v(15),pdl:v(5)}]}]})),participation:[{key:'STOCK|1',label:'Stock',role:'STOCK',price:v(100+m),dayChange:v(m),weight:missing()}]});
const w:Window={date:d,from:frame(0).minute,to:frame(3).minute,timeframe:3,partial:false};
test('scoped window, summary and EOD retain only the selected index premium ladders',()=>{
 const a=frame(0),b=frame(3);for(const f of [a,b])f.indices.forEach((i,n)=>i.expiries[0].contracts[0].strike=100+n*100);
 for(const [n,symbol] of SYMBOLS.entries()) {
  for(const text of [renderWindow([a,b],w,symbol).join('\n'),renderEod([a,b],d,symbol).join('\n')]) {
   assert.ok(text.includes(`Strike ${100+n*100} CE`));
   for(let other=0;other<3;other++)if(other!==n)assert.ok(!text.includes(`Strike ${100+other*100} CE`));
   assert.ok(text.includes('index membership ରେକର୍ଡ ନାହିଁ'));
  }
  const summary=renderSummary([a,b],w,symbol);assert.ok(summary.includes(symbol));
  for(const other of SYMBOLS)if(other!==symbol)assert.ok(!summary.split('\n').includes(other));
  if(symbol==='BANKNIFTY')assert.ok(summary.includes('କେବଳ ଗବେଷଣା ପାଇଁ'));
 }
});
test('scoped minute coverage cannot be satisfied by other indices or participation alone',()=>{
 const a=frame(0),b=frame(3);b.indices=b.indices.filter(i=>i.symbol!=='NIFTY');
 assert.ok(renderWindow([a,b],w,'NIFTY').join('\n').includes('Minute coverage 1/4'));
 assert.ok(renderSummary([a,b],w,'NIFTY').includes('Minute coverage 1/4'));
 assert.ok(renderEod([a,b],d,'NIFTY').join('\n').includes('Minute coverage 1/376'));
 assert.throws(()=>renderWindow([a,b],w,'INVALID' as any),/INVALID_REPORT_SYMBOL/);
});
class Store implements LadderOutbox {
 jobs=new Map<string,Job>();states=new Map<string,string>();
 async putIfAbsent(j:Job){if(this.jobs.has(j.id))return false;this.jobs.set(j.id,structuredClone(j));return true;}
 async claim(id:string,p:number){const k=id+'|'+p,s=this.states.get(k);if(s&&s!=='RETRYABLE')return false;this.states.set(k,'SENDING');return true;}
 async settle(id:string,p:number,result:string){this.states.set(id+'|'+p,result);}
}
test('session windows have exact anchoring and all 376 minute snapshots',()=>{
 const ws=sessionWindows(d);assert.equal(ws.filter(w=>w.timeframe===1).length,376);
 for(const [tf,count] of [[3,125],[15,25],[30,13],[60,7]])assert.equal(ws.filter(w=>w.timeframe===tf).length,count);
 for(const tf of [30,60]){const last=ws.filter(w=>w.timeframe===tf).at(-1)!;assert.equal(last.partial,true);assert.equal(Date.parse(last.to)-Date.parse(last.from),15*60_000);}
 assert.equal(dueWindows(d,base+59_999).length,0);assert.equal(dueWindows(d,base+60_000).length,1);
 assert.throws(()=>sessionWindows('2026-02-30'));
});
test('numeric missing stays distinct from zero',()=>{
 for(const n of [null,undefined,'',false,true,{},NaN,Infinity])assert.equal(numeric(n),null);
 assert.equal(numeric(0),0);assert.equal(numeric('0'),0);
});
test('all three indices, separate expiry contracts and participation render as vertical ladders',()=>{
 const text=renderWindow([frame(0),frame(1),frame(2),frame(3)],w).join('\n');
 for(const s of SYMBOLS)assert.ok(text.includes(s));assert.ok(text.includes('🟢 3/3 ⬆️'));
 assert.ok(text.includes('Minute coverage 4/4'));assert.ok(text.includes('DTE 5'));
 assert.ok(text.includes('Window Δ 🟢⬆️ +3%'));assert.ok(text.includes('Index weight ⚪ MISSING%'));
 assert.ok(text.includes('କେବଳ ଗବେଷଣା ପାଇଁ'));
});
test('price levels sorted by numeric value even when LTP breaks PDH',()=>{
 const a=frame(0),b=frame(3);b.indices[0].spot=v(110);
 const text=renderWindow([a,b],w).join('\n');const section=text.slice(text.indexOf('NIFTY'),text.indexOf('Spot Δ'));
 assert.ok(section.indexOf('SPOT')<section.indexOf('PDH'));assert.ok(section.indexOf('PDH')<section.indexOf('PDL'));
});
test('unverified/stale retains numbers and blocks delta/alignment',()=>{
 const a=frame(0),b=frame(3);b.indices[1].expiries[0].pcr.full=value(1.234,'STALE','TEST_SAME_UNIVERSE');
 const text=renderWindow([a,b],w).join('\n');assert.ok(text.includes('1.234 ⚪ STALE'));assert.ok(text.includes('3/3 ଯାଞ୍ଚିତ baseline ନାହିଁ'));
});
test('wall migration never compares OI at different strikes; rolled contracts lack baseline',()=>{
 const a=frame(0),b=frame(3);b.indices[0].expiries[0].ceWall.strike=120;b.indices[0].expiries[0].contracts[0].strike=105;
 const text=renderWindow([a,b],w).join('\n');assert.ok(text.includes('Strike migration 110 → 120'));assert.ok(text.includes('ଭିନ୍ନ strike; ତୁଳନା ନାହିଁ'));assert.ok(text.includes('LTP Δ ⚪ Δ ତୁଳନା ଅନୁପଲବ୍ଧ'));
});
test('missing endpoint is not replaced by nearby or later observation',()=>{
 const text=renderWindow([frame(0),frame(2),frame(4)],w).join('\n');assert.ok(text.includes('Minute coverage 2/4'));assert.equal(text.includes('Spot Δ 🟢'),false);assert.ok(text.includes('ଏହି minuteର index record ନାହିଁ'));
});
test('opening snapshot has no invented pre-open change',()=>{
 const opening=sessionWindows(d).find(w=>w.timeframe===1)!;
 const text=renderWindow([frame(0)],opening).join('\n');assert.ok(text.includes('Spot Δ ⚪'));assert.ok(text.includes('Day Δ 0% —'));
});
test('duplicate observations and contract identities fail explicitly',()=>{
 assert.throws(()=>renderWindow([frame(0),frame(0)],w),/DUPLICATE_MINUTE/);
 const b=frame(3);b.indices[0].expiries[0].contracts.push(b.indices[0].expiries[0].contracts[0]);
 assert.throws(()=>renderWindow([b],w),/DUPLICATE_CONTRACT/);
});
test('EOD has every minute, all index gaps and no truncation',()=>{
 const parts=renderEod([frame(0),frame(375)],d),text=parts.join('\n');
 assert.equal((text.match(/⏱ /g)||[]).length,376);assert.ok(text.includes('15:30 IST'));
 assert.ok(text.includes('Minute coverage 2/376'));assert.ok(parts.every(p=>p.startsWith('📊 OPTIONPILOT LADDER V4 | ')&&p.length<=3800));
 for(let i=0;i<parts.length;i++)assert.ok(parts[i].includes(`ଭାଗ ${i+1}/${parts.length}`));
});
test('multipart keeps every line and handles emoji within Telegram length',()=>{
 const lines=Array.from({length:120},(_,i)=>`${i} 🟢⬆️ ${'x'.repeat(100)}`),parts=splitLadder(lines,'TEST',300);
 for(const line of lines)assert.equal(parts.filter(p=>p.includes('\n'+line+'\n')||p.endsWith('\n'+line)).length,1);
 assert.ok(parts.every(p=>p.length<=300));assert.throws(()=>splitLadder(['x'.repeat(1000)],'TEST',300));
});
test('H1 adapter preserves unverified PCR and independently rechecks stale option quotes',()=>{
 const r={market:[{symbol:'NIFTY',minute_bucket:frame(0).minute,backend_timestamp:new Date(base+10_000).toISOString(),spot_ltp:100,freshness_status:'TRUE'}],chain:[{symbol:'NIFTY',minute_bucket:frame(0).minute,expiry:'2026-11-03',full_chain_oi_pcr:1.2,volume_pcr:0}],options:[{symbol:'NIFTY',minute_bucket:frame(0).minute,expiry:'2026-11-03',strike:100,option_type:'CE',ltp:10,quote_timestamp:new Date(base-70_000).toISOString(),truth_verdict:'TRUE',validation_status:'RESEARCH_ELIGIBLE'}]};
 const fs=framesFromH1([r]),i=fs[0].indices[0];assert.equal(i.spot.quality,'UNVERIFIED');assert.equal(i.expiries[0].pcr.full.value,1.2);assert.equal(i.expiries[0].pcr.full.quality,'UNVERIFIED');assert.equal(i.expiries[0].pcr.volume.value,0);assert.equal(i.expiries[0].contracts[0].ltp.quality,'STALE');
 assert.throws(()=>framesFromH1([r,r]),/DUPLICATE_MARKET/);
});
test('deterministic outbox enqueue deduplicates after restart and EOD waits until 16:00 IST',async()=>{
 const store=new Store(),fs=[frame(0),frame(3)];assert.equal(await enqueueLadderReports(store,fs,d,base+60_000),1);
 assert.equal(await enqueueLadderReports(store,fs,d,base+60_000),0);
 await enqueueLadderReports(store,fs,d,Date.parse(d+'T15:59:00+05:30'));assert.equal(store.jobs.has(`LADDER_V4|${d}|EOD`),false);
 await enqueueLadderReports(store,fs,d,Date.parse(d+'T16:00:00+05:30'));assert.equal(store.jobs.has(`LADDER_V4|${d}|EOD`),true);
});
test('explicit retry resumes same part; ambiguous delivery blocks further parts',async()=>{
 const s=new Store(),j={id:'test',parts:['first','second']};await s.putIfAbsent(j);const sent:string[]=[];
 assert.equal(await deliverLadderJob(s,j,async text=>{sent.push(String(text));return {status:'RETRYABLE'};}),'RETRYABLE');assert.deepEqual(sent,['first']);
 assert.equal(await deliverLadderJob(s,j,async text=>{sent.push(String(text));throw Error('network timeout');}),'UNKNOWN');
 assert.equal(await deliverLadderJob(s,j,async()=>({status:'ACKED',receipt:'1'})),'NOT_CLAIMED');assert.deepEqual(sent,['first','first']);
});
test('two workers cannot both claim same part',async()=>{
 const s=new Store(),j={id:'test',parts:['first']};await s.putIfAbsent(j);let sends=0;
 const result=await Promise.all([1,2].map(()=>deliverLadderJob(s,j,async()=>{sends++;return {status:'ACKED',receipt:'1'};})));
 assert.equal(sends,1);assert.ok(result.includes('ACKED'));assert.ok(result.includes('NOT_CLAIMED'));
});

test('large reports retain complete ladders in a single document',()=>{
 const parts=renderEod([frame(0)],d),job=reportJob('LADDER_V4|2026-10-29|EOD',parts);
 assert.equal(job.parts.length,2);const doc=job.parts[1];assert.ok(typeof doc!=='string');
 assert.equal(doc.content,parts.join('\n\n'));assert.ok(doc.filename.endsWith('.txt'));
});
