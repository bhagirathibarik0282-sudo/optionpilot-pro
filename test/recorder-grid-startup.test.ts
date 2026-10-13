import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the actual recorder scheduler block with a controllable clock and capture sink.
function scheduler() {
 const source=fs.readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const start=source.indexOf('let lastRecorderSlot = -1;');
 const end=source.indexOf('// Telegram Market Snapshot fast cycle',start);
 assert(start>=0 && end>start);
 let at='2026-10-12T05:47:00.000Z',open=true,tick:()=>void=()=>{};
 const captures:string[]=[];
 class Clock extends Date { constructor(value?:any) { super(value===undefined?at:value); } }
 vm.runInNewContext(source.slice(start,end),{
  Date:Clock,isMarketOpenNowServer:()=>open,
  setInterval:(fn:()=>void,ms:number)=>{assert.equal(ms,30000);tick=fn;},
  captureRecorderSnapshot:(reason:string)=>{captures.push(reason);},
 });
 return {captures,at:(value:string)=>{at=value;tick();},close:()=>{open=false;}};
}
test('startup between grid minutes waits, boundary captures once, and late ticks never backfill',()=>{
 const s=scheduler();
 s.at('2026-10-12T05:47:37Z');assert.equal(s.captures.length,0); // 11:17 IST
 s.at('2026-10-12T05:48:07Z');assert.deepEqual(s.captures,['SCHEDULED_3MIN']);
 s.at('2026-10-12T05:48:37Z');assert.equal(s.captures.length,1);
 s.at('2026-10-12T05:49:07Z');assert.equal(s.captures.length,1);
 s.at('2026-10-12T05:52:07Z');assert.equal(s.captures.length,1); // missed 11:21 remains missing
 s.at('2026-10-12T05:54:07Z');assert.equal(s.captures.length,2);
 s.close();s.at('2026-10-12T05:57:07Z');assert.equal(s.captures.length,2);
});
test('premarket startup captures opening grid and a later trading day without duplicate slots',()=>{
 const s=scheduler();s.at('2026-10-12T03:44:37Z');assert.equal(s.captures.length,0);
 s.at('2026-10-12T03:45:07Z');assert.equal(s.captures.length,1);
 s.at('2026-10-12T10:00:07Z');assert.equal(s.captures.length,2);
 s.at('2026-10-13T03:45:07Z');assert.equal(s.captures.length,3);
});
