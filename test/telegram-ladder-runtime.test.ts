import test from 'node:test';
import assert from 'node:assert/strict';
import {createLadderRuntime} from '../telegram-ladder-runtime.js';
const open=Date.parse('2026-10-29T09:15:00+05:30'),M=60_000;
class DeliveryStore {
  jobs=new Map<string,any>();done=new Set<string>();
  async putIfAbsent(job:any){if(this.jobs.has(job.id))return false;this.jobs.set(job.id,job);return true;}
  async pending(prefix=''){return [...this.jobs.values()].filter(j=>j.id.startsWith(prefix)&&!this.done.has(j.id)).map(job=>({job,nextPart:0}));}
  async claim(){return true;}
  async settle(id:string,part:number,state:string){if(state==='ACKED'&&part===this.jobs.get(id).parts.length-1)this.done.add(id);}
}
test('full-session scheduling can drain every due report rather than accumulating a daily backlog',async()=>{
  const store=new DeliveryStore();
  const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',mode:'DELIVER',store,read:async()=>({frames:[],failures:[]}),send:async()=>({status:'ACKED',receipt:'1'})});
  for(let n=1;n<=405;n++)await runtime.tick(open+n*M);
  assert.equal(store.jobs.size,547);assert.equal(store.done.size,547);
});
test('large EOD reports have a compact preface covering all three indices',async()=>{
  const jobs:any[]=[];const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',read:async()=>({frames:[],failures:[]}),preview:async j=>{jobs.push(j);}});
  for(let n=340;n<=376;n++)await runtime.tick(open+n*M);
  await runtime.tick(Date.parse('2026-10-29T16:00:00+05:30'));
  const eod=jobs.find(j=>j.id.endsWith('|EOD'));
  assert.ok(eod);assert.ok(typeof eod.parts[0]==='string');
  for(const s of ['NIFTY','SENSEX','BANKNIFTY'])assert.ok(eod.parts[0].includes(s));
});
test('backlog draining stops at the first retry or ambiguous send',async()=>{
  for(const status of ['RETRYABLE','UNKNOWN'] as const) {
    const store=new DeliveryStore();let sends=0;
    const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',mode:'DELIVER',store,read:async()=>({frames:[],failures:[]}),send:async()=>{sends++;return {status};}});
    await runtime.tick(open+4*M);assert.ok(store.jobs.size>1);assert.equal(sends,1);
  }
});
test('default shadow schedules only closed minutes, deduplicates same tick and never writes or sends',async()=>{
  const jobs:any[]=[],reads:any[]=[];let writes=0,sends=0;
  const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',read:async r=>{reads.push(r);return {frames:[],failures:['NIFTY_SOURCE_UNAVAILABLE']};},preview:async j=>{jobs.push(j);},store:{putIfAbsent:async()=>{writes++;return true;},claim:async()=>true,settle:async()=>{},pending:async()=>[]},send:async()=>{sends++;return {status:'UNKNOWN'};}});
  assert.equal((await runtime.tick(open+59_999)).state,'OUTSIDE_REPORT_WINDOW');
  const result=await runtime.tick(open+M);assert.equal(result.state,'SHADOW_TICK');assert.equal(result.planned,1);
  assert.equal(jobs.length,1);assert.equal(reads[0].from,reads[0].to);assert.equal(writes,0);assert.equal(sends,0);
  assert.equal((await runtime.tick(open+M+5000)).state,'SKIPPED');
  await runtime.tick(open+4*M);assert.ok(jobs.some(j=>j.id.includes('|3|')));assert.equal(reads.length,2);
});
test('source exceptions retry same range; concurrent ticks cannot overlap',async()=>{
  let calls=0,release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);
  const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',read:async()=>{calls++;await gate;if(calls===1)throw Error('DB');return {frames:[],failures:[]};}});
  const a=runtime.tick(open+M);assert.equal((await runtime.tick(open+M)).state,'SKIPPED');release();await assert.rejects(a);
  assert.equal((await runtime.tick(open+M)).state,'SHADOW_TICK');assert.equal(calls,2);
});
test('catchup reads are bounded and do not schedule pre-cutover reports',async()=>{
  const jobs:any[]=[],ranges:any[]=[];const runtime=createLadderRuntime({activateAt:open+60*M,destinationKey:'-123',read:async r=>{ranges.push(r);return {frames:[],failures:[]};},preview:async j=>{jobs.push(j);}});
  for(let n=61;n<=65;n++)await runtime.tick(open+n*M);
  assert.ok(ranges.every(r=>Date.parse(r.to)-Date.parse(r.from)<=14*M));assert.ok(jobs.length>0);
  assert.ok(jobs.every(j=>j.id.includes('|-123|')&&!j.id.includes('03:45:00.000Z')));
});
test('calendar closures and unreviewed years cause no reads',async()=>{
  let calls=0;const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',read:async()=>{calls++;return {frames:[],failures:[]};}});
  for(const t of ['2026-10-31T10:00:00+05:30','2026-11-10T10:00:00+05:30','2027-01-04T10:00:00+05:30'])assert.equal((await runtime.tick(Date.parse(t))).state,'CLOSED_CALENDAR');
  assert.equal(calls,0);
});
test('closing bucket waits a minute and EOD waits until 16:00 IST',async()=>{
  const jobs:any[]=[];const runtime=createLadderRuntime({activateAt:open,destinationKey:'-123',read:async()=>({frames:[],failures:[]}),preview:async j=>{jobs.push(j);}});
  // Hydrate bounded chunks over repeated minutes while close is still in progress.
  for(let n=340;n<=375;n++)await runtime.tick(open+n*M);
  assert.ok(!jobs.some(j=>j.id.endsWith('|EOD')));
  await runtime.tick(open+376*M);assert.ok(jobs.some(j=>j.id.includes('10:00:00.000Z')));
  await runtime.tick(Date.parse('2026-10-29T15:59:00+05:30'));assert.ok(!jobs.some(j=>j.id.endsWith('|EOD')));
  await runtime.tick(Date.parse('2026-10-29T16:00:00+05:30'));assert.equal(jobs.filter(j=>j.id.endsWith('|EOD')).length,1);
  await runtime.tick(Date.parse('2026-10-29T16:01:00+05:30'));assert.equal(jobs.filter(j=>j.id.endsWith('|EOD')).length,1);
});
