import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';

function harness(fetch: any) {
 const html=renderBusinessDashboardV1Html({});
 const body=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('async function get(label,url)'))!;
 const source=body.slice(body.indexOf('async function get(label,url)'),body.indexOf('function latestObservedAt('));
 const nodes=new Map(['sources','source-meta'].map(id=>[id,{innerHTML:'',textContent:''}]));
 const ctx:any={fetch,Date,URL,AbortController,console,setTimeout:(fn:any,ms:number)=>setTimeout(fn,ms===400?0:ms),clearTimeout};
 vm.createContext(ctx);
 ctx.nodes=nodes;
 vm.runInContext("const sources={};const $=id=>nodes.get(id),esc=String,when=String;"+source+"globalThis.api={get,getReplayWindow,getReplay,sources};",ctx);
 return ctx.api;
}
const unreadable=(status=200)=>({status,ok:status>=200&&status<300,json:async()=>{throw new SyntaxError('Unexpected end of JSON input');}});
const response=(body:any,status=200)=>({status,ok:status>=200&&status<300,json:async()=>body});
const replay=(time:string,value:number)=>({ok:true,market:{columns:['symbol','minute_bucket','spot_ltp'],rows:[['NIFTY',time,value]]},options:{columns:[],rows:[]},chain:{columns:[],rows:[]},canonical:{columns:[],rows:[]}});

test('an unreadable HTTP 200 gets exactly one retry and can recover',async()=>{
 let calls=0;
 const h=harness(async()=>++calls===1?unreadable():response({ok:true}));
 const r=await h.get('session','/replay');
 assert.equal(r.ok,true);assert.equal(calls,2);assert.equal(h.sources.session.attempts,2);
});

test('repeated unreadable replay splits only the failing interval and deduplicates exact boundaries',async()=>{
 const calls:string[]=[];
 const h=harness(async(url:string)=>{
  calls.push(url);const u=new URL(url,'https://test.invalid');
  if(u.searchParams.get('from')==='09:15'&&u.searchParams.get('to')==='10:15')return unreadable();
  const r=replay('2026-10-12T04:15:00Z',u.searchParams.get('from')==='09:15'?1:2);
  r.market.rows.push(['NIFTY',u.searchParams.get('from')==='09:15'?'2026-10-12T03:45:00Z':'2026-10-12T04:45:00Z',3]);
  return response(r);
 });
 const r=await h.getReplay('NIFTY session','NIFTY','2026-10-12','09:15','10:15');
 assert.equal(calls.length,4,'two parent attempts, then each half once');
 const intervals=calls.map(url=>{const u=new URL(url,'https://test.invalid');return [u.searchParams.get('from'),u.searchParams.get('to')];});
 assert.deepEqual(intervals,[['09:15','10:15'],['09:15','10:15'],['09:15','09:45'],['09:45','10:15']]);
 assert.equal(r.counts.market,3);assert.equal(r.market.rows[1][2],2,'later exact boundary replaces earlier row');
 assert.equal(r.request.fromTime,'09:15');assert.equal(r.request.toTime,'10:15');
 assert.match(h.sources['NIFTY session'].status,/Smaller replay windows requested/);
});

test('successful requests retain the existing one-hour request pattern',async()=>{
 const calls:string[]=[];const h=harness(async(url:string)=>{calls.push(url);return response(replay('2026-10-12T03:45:00Z',1));});
 await h.getReplay('session','NIFTY','2026-10-12','09:15','10:15');assert.equal(calls.length,1);
});

test('authentication and valid application failures neither retry nor split',async()=>{
 for(const result of [unreadable(401),unreadable(403),response({ok:false,error:'INVALID_SESSION'})]){
  let calls=0;const h=harness(async()=>{calls++;return result;});
  await assert.rejects(h.getReplayWindow('session','NIFTY','2026-10-12','09:15','10:15'));
  assert.equal(calls,1);
 }
});

test('a failed smaller interval rejects the whole replay, without returning partial data',async()=>{
 const calls:string[]=[];const h=harness(async(url:string)=>{
  calls.push(url);const u=new URL(url,'https://test.invalid');
  if(u.searchParams.get('from')==='09:45')return response({ok:false,error:'MISSING_WINDOW'});
  if(u.searchParams.get('to')==='10:15')return unreadable();
  return response(replay('2026-10-12T03:45:00Z',1));
 });
 await assert.rejects(h.getReplayWindow('session','NIFTY','2026-10-12','09:15','10:15'),/MISSING_WINDOW/);
 assert.equal(calls.length,4);
});

test('persistent unreadable responses terminate at a three-minute window',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return unreadable();});
 await assert.rejects(h.getReplayWindow('session','NIFTY','2026-10-12','09:15','10:15'),/unreadable response/);
 assert.equal(calls,10,'60, 30, 15, 7 and 3 minute windows, two attempts each');
});

test('timeout keeps the existing bounded retry without recursive splitting',async()=>{
 let calls=0;const h=harness(async()=>{calls++;const e=new Error('aborted');e.name='AbortError';throw e;});
 await assert.rejects(h.getReplayWindow('session','NIFTY','2026-10-12','09:15','10:15'),/aborted/);
 assert.equal(calls,2);
});

test('FULL archive scope survives chunking and recursive recovery without changing default CORE reads',async()=>{
 const calls:URL[]=[];const h=harness(async(url:string)=>{const u=new URL(url,'https://example.test');calls.push(u);return response(replay('2026-10-12T03:45:00Z',1));});
 await h.getReplay('archive','NIFTY','2026-10-12','09:15','11:15','FULL');assert(calls.length>1);assert(calls.every(u=>u.searchParams.get('scope')==='FULL'));
 calls.length=0;await h.getReplay('focused','NIFTY','2026-10-12','09:15','09:18');assert(calls.every(u=>u.searchParams.get('scope')==='CORE'));
});
