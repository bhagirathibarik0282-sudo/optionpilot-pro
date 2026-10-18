import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production scheduler with a controllable clock and persistence sink.
function scheduler(capture?: (reason:string,observationOnly:boolean)=>Promise<void>) {
 const source=fs.readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const start=source.indexOf('let lastRecorderSlot = -1;');
 const end=source.indexOf('// Telegram Market Snapshot fast cycle',start);
 assert(start>=0 && end>start);
 let at='2026-10-19T05:47:00.000Z',open=true,tick:()=>Promise<void>=async()=>{};
 const captures:[string,boolean][]=[];
 class Clock extends Date { constructor(value?:any) { super(value===undefined?at:value); } }
 vm.runInNewContext(source.slice(start,end),{
  Date:Clock,isMarketOpenNowServer:()=>open,isClosingObservationAt:()=>false,
  setInterval:(fn:()=>Promise<void>,ms:number)=>{assert.equal(ms,30000);tick=fn;},
  captureRecorderSnapshot:async(reason:string,observationOnly:boolean)=>{captures.push([reason,observationOnly]);await capture?.(reason,observationOnly);},
 });
 return {captures,at:(value:string)=>{at=value;return tick();},close:()=>{open=false;}};
}
test('records actual minutes once, preserves business grid and never invents skipped minutes',async()=>{
 const s=scheduler();
 await s.at('2026-10-19T05:47:37Z');
 await s.at('2026-10-19T05:47:57Z');assert.equal(s.captures.length,1);
 await s.at('2026-10-19T05:48:07Z');
 await s.at('2026-10-19T05:49:07Z');
 await s.at('2026-10-19T05:52:07Z');
 assert.deepEqual(s.captures,[['SCHEDULED_1MIN_ARCHIVE',true],['SCHEDULED_3MIN',false],['SCHEDULED_1MIN_ARCHIVE',true],['SCHEDULED_1MIN_ARCHIVE',true]]);
 s.close();await s.at('2026-10-19T05:54:07Z');assert.equal(s.captures.length,4);
});
test('premarket waits; same minute on a new trading day is a distinct slot',async()=>{
 const s=scheduler();s.close();await s.at('2026-10-19T03:44:37Z');assert.equal(s.captures.length,0);
 const next=scheduler();await next.at('2026-10-19T03:45:07Z');await next.at('2026-10-21T03:45:07Z');assert.equal(next.captures.length,2);
});
test('slow persistence cannot overlap cycles; failure releases the gate without retrying a minute',async()=>{
 let release!:()=>void;
 const s=scheduler(()=>new Promise<void>(r=>release=r));
 const first=s.at('2026-10-19T05:47:07Z');await s.at('2026-10-19T05:48:07Z');assert.equal(s.captures.length,1);
 release();await first;const second=s.at('2026-10-19T05:49:07Z');assert.equal(s.captures.length,2);release();await second;
 const failed=scheduler(async()=>{throw Error('storage failure');});
 await assert.rejects(failed.at('2026-10-19T05:47:07Z'));await failed.at('2026-10-19T05:47:37Z');assert.equal(failed.captures.length,1);
 await assert.rejects(failed.at('2026-10-19T05:48:07Z'));assert.equal(failed.captures.length,2);
});
