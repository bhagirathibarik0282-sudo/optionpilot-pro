import test from 'node:test';
import assert from 'node:assert/strict';
import { recordedSession, recordedFrame, createRecordedPlayback } from '../recorded-playback.js';

const row=(date:string,time:string,extra:any={})=>({symbol:'NIFTY',minute_bucket:date+'T'+time+':00+05:30',truth_verdict:'TRUE',...extra});
const session=(date:string)=>recordedSession({market:[row(date,'09:15',{spot_ltp:23000}),row(date,'09:18',{spot_ltp:23005})]},'NIFTY',date);
function harness(load:any=async(date:string)=>session(date)) {
 const scheduled=new Map<number,any>();let id=0;
 const controller=createRecordedPlayback({load,render(){},setTimeout(fn:any){scheduled.set(++id,fn);return id;},clearTimeout(key:number){scheduled.delete(key);}});
 return {controller,scheduled,async tick(){const entry=scheduled.entries().next().value;if(!entry)return;scheduled.delete(entry[0]);entry[1]();await new Promise(resolve=>setImmediate(resolve));}};
}
test('TRUE exact-day/index rows only; numeric BIGINT strings retain zero and missing stays missing',()=>{
 const day='2026-10-30',s=recordedSession({market:[row(day,'09:15',{spot_ltp:0}),row(day,'09:18',{truth_verdict:'PARTIAL'}),row(day,'09:19',{symbol:'SENSEX'}),row('2026-10-29','09:20')],options:[row(day,'09:15',{strike:23000,oi:'30000000',ltp:null}),row(day,'09:15',{strike:23050,oi:'',ltp:'NaN'})]},'NIFTY',day);
 assert.equal(s.market.length,1);assert.equal(s.timeline.length,1);assert.equal(s.market[0].spot_ltp,0);assert.equal(s.options[0].oi,30000000);assert.equal(s.options[0].ltp,null);assert.equal(s.options[1].oi,null);
});
test('frame exposes exact timestamp only, never forward rows or an old value for a missing bucket',()=>{
 const day='2026-10-30',s=recordedSession({market:[row(day,'09:15',{spot_ltp:1}),row(day,'09:19',{spot_ltp:2})],options:[row(day,'09:18',{ltp:8})]},'NIFTY',day);
 const f=recordedFrame(s,1);assert.equal(f.options[0].ltp,8);assert.equal(f.market.length,0);assert.equal(f.gapMinutes,3);assert.equal(s.cadenceMinutes,1);
});
test('one click queues unique days chronologically and advances to the next day without carrying prices',async()=>{
 const h=harness();await h.controller.start(['2026-10-30','2026-10-29','2026-10-29']);
 assert.deepEqual(h.controller.snapshot().days,['2026-10-29','2026-10-30']);
 await h.tick();assert.equal(h.controller.snapshot().index,1);
 await h.tick();const state=h.controller.snapshot();assert.equal(state.dayIndex,1);assert.equal(state.index,0);assert.equal(state.frame.date,'2026-10-30');assert.equal(state.frame.gapMinutes,null);
 await h.tick();await h.tick();assert.equal(h.controller.snapshot().playing,false);assert.equal(h.scheduled.size,0);
});
test('pause clears playback and seek cannot expose another day or a future cursor',async()=>{
 const h=harness();await h.controller.start(['2026-10-30']);h.controller.pause();await h.tick();assert.equal(h.controller.snapshot().index,0);
 h.controller.seek(999);assert.equal(h.controller.snapshot().index,1);assert.equal(h.controller.snapshot().playing,false);
});
test('Play on the latest saved closing frame restarts the session from its first record',async()=>{
 const h=harness();await h.controller.start(['2026-10-30'],false);h.controller.seek(1);h.controller.toggle();assert.equal(h.controller.snapshot().index,0);assert.equal(h.controller.snapshot().playing,true);assert.equal(h.scheduled.size,1);
});
test('cancel an in-flight day load; its late result cannot replace the new selection',async()=>{
 let resolveOld:any;const h=harness((date:string)=>date==='2026-10-29'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(session(date)));
 const old=h.controller.start(['2026-10-29']);await h.controller.start(['2026-10-30'],false);resolveOld(session('2026-10-29'));await old;
 assert.equal(h.controller.snapshot().session.date,'2026-10-30');assert.equal(h.controller.snapshot().playing,false);assert.equal(h.scheduled.size,0);
});
test('pausing during automatic next-day loading prevents a late restart',async()=>{
 let resolveNext:any;const h=harness((date:string)=>date==='2026-10-30'?new Promise(resolve=>{resolveNext=resolve;}):Promise.resolve(session(date)));
 await h.controller.start(['2026-10-29','2026-10-30']);await h.tick();await h.tick();assert.equal(h.controller.snapshot().loading,true);h.controller.pause();resolveNext(session('2026-10-30'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.controller.snapshot().playing,false);assert.equal(h.controller.snapshot().session,null);assert.equal(h.scheduled.size,0);
});
test('a missing recorded day stops explicitly; does not silently skip to another date',async()=>{
 const h=harness(async(date:string)=>date==='2026-10-29'?recordedSession({},'NIFTY',date):session(date));await h.controller.start(['2026-10-29','2026-10-30']);
 assert.match(h.controller.snapshot().error,/not skipped/);assert.equal(h.controller.snapshot().dayIndex,0);assert.equal(h.controller.snapshot().playing,false);assert.equal(h.scheduled.size,0);
});
test('failed archive read clears the old session and never substitutes stale values',async()=>{
 const h=harness(async()=>{throw new Error('storage unavailable');});await h.controller.start(['2026-10-30']);assert.equal(h.controller.snapshot().session,null);assert.equal(h.controller.snapshot().frame.at,null);assert.match(h.controller.snapshot().error,/storage unavailable/);
});
