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

function storedCash(){
 return {ok:false,mode:'READ_ONLY_FII_DII_PRODUCTION_READINESS_V1',version:'CANONICAL_FII_DII_PRODUCTION_READINESS_V1',ready:false,
  expectedMarketSessionDate:'2026-10-21',latestStoredSessionDate:'2026-10-19',storedSessionCount:20,freshAgainstLatestRecordedMarketSession:false,
  windows:[1,3,5,20].map(n=>({window:n+'D',ready:true,availableSessions:n,requiredSessions:n,fiiNetCrore:-10,diiNetCrore:20,combinedNetCrore:10,state:'READY'})),
  blockers:['FII_DII_OFFICIAL_SESSION_BEHIND_MARKET:2026-10-19<2026-10-21'],source:'OFFICIAL_NSE',sourceMode:'PRODUCTION_DB_READBACK',
  readOnly:true,contextOnly:true,failClosed:true,mutatesData:false,grantsDirectionalSupport:false,
  affectsVerdict:false,affectsCandidate:false,affectsTelegram:false,affectsExecution:false};
}

test('stale official cash readiness retains dated complete EOD context without upgrading readiness',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return response(storedCash(),503);});
 const d=await h.get('Saved FII/DII cash context','/api/research/fii-dii/production-readiness');
 assert.equal(calls,1);assert.equal(d.ready,false);assert.equal(d.ok,false);
 assert.equal(d.latestStoredSessionDate,'2026-10-19');assert.equal(d.affectsVerdict,false);
 assert(h.sources['Saved FII/DII cash context'].status.includes('HTTP 503 · STORED EOD 2026-10-19 · latest pending'));
});

test('cash display exception rejects other endpoints, auth errors and incomplete or inconsistent context',async()=>{
 for(const kind of ['url','label','auth','source','date','blocker','missing-window','invalid-total','non-finite','authority']){
  const body=storedCash();
  if(kind==='source')body.source='UNVERIFIED';
  if(kind==='date')body.latestStoredSessionDate='2026-02-30';
  if(kind==='blocker')body.blockers.push('DATABASE_FAILED');
  if(kind==='missing-window')body.windows.pop();
  if(kind==='invalid-total')body.windows[0].combinedNetCrore=999;
  if(kind==='non-finite')body.windows[0].fiiNetCrore=NaN;
  if(kind==='authority')body.affectsVerdict=true;
  const h=harness(async()=>response(body,kind==='auth'?401:503));
  await assert.rejects(()=>h.get(kind==='label'?'Other':'Saved FII/DII cash context',kind==='url'?'/other':'/api/research/fii-dii/production-readiness'),kind);
 }
});

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


test('replay queue bounds concurrent HTTP work and releases slots after failures',async()=>{
 let active=0,peak=0;const releases:Function[]=[];
 const h=harness(async()=>{active++;peak=Math.max(peak,active);await new Promise<void>(r=>releases.push(r));active--;return response({ok:true,market:[],options:[],chain:[],canonical:[]});});
 const pending=Array.from({length:6},(_,i)=>h.getReplayWindow('queue '+i,'NIFTY','2026-10-23','09:15','09:18'));
 for(let i=0;i<12;i++)await Promise.resolve();assert.equal(peak,2);assert.equal(releases.length,2);
 while(releases.length){releases.shift()!();for(let i=0;i<12;i++)await Promise.resolve();}
 await Promise.all(pending);assert.equal(active,0);assert.equal(peak,2);
 const failed=harness(async()=>response({ok:false,reason:'auth'},401));await assert.rejects(()=>failed.getReplayWindow('failed','NIFTY','2026-10-23','09:15','09:18'));await assert.rejects(()=>failed.getReplayWindow('next','NIFTY','2026-10-23','09:15','09:18'));
});

test('progress callbacks publish latest returned windows before older history, in chronological merged order',async()=>{
 const calls:string[]=[],progress:any[]=[];
 const h=harness(async(url:string)=>{const u=new URL(url,'https://test.invalid'),from=u.searchParams.get('from')!;calls.push(from);return response(replay('2026-10-12T'+from+':00+05:30',Number(from.slice(0,2))));});
 const r=await h.getReplay('session','NIFTY','2026-10-12','09:15','11:15','CORE',(part:any)=>{progress.push(structuredClone(part));assert.equal(calls.length,progress.length,'publish before next HTTP request');});
 assert.deepEqual(calls,['10:15','09:15']);assert.equal(progress[0].loadingProgress.completed,1);assert.equal(progress[0].loadingProgress.total,2);assert.equal(progress[0].market.rows.length,1);assert.equal(progress[1].market.rows[0][1],'2026-10-12T09:15:00+05:30');assert.equal(r.counts.market,2);
});

test('failed older history rejects completion but keeps previously published real observations',async()=>{
 const progress:any[]=[];const h=harness(async(url:string)=>new URL(url,'https://test.invalid').searchParams.get('from')==='09:15'?response({ok:false,error:'OLDER_INTERVAL_FAILED'},400):response(replay('2026-10-12T04:45:00Z',10)));
 await assert.rejects(()=>h.getReplay('session','NIFTY','2026-10-12','09:15','11:15','CORE',(p:any)=>progress.push(p)),/OLDER_INTERVAL_FAILED/);assert.equal(progress.length,1);assert.equal(progress[0].market.rows[0][2],10);assert.equal(progress[0].loadingProgress.completed,1);
});

test('canonical chunk merging preserves ambiguous same-minute evidence and exact duplicate multiplicity',async()=>{
 for(const compact of [false,true]){
  const time='2026-10-12T04:15:00Z',a={minute_bucket:time,snapshot_id:'A'},b={minute_bucket:time,snapshot_id:'B'};
  const h=harness(async(url:string)=>{const first=new URL(url,'https://test.invalid').searchParams.get('from')==='09:15',d:any=replay(time,1),rows=first?[a,a,b]:[a,b];d.canonical=compact?{columns:['minute_bucket','snapshot_id'],rows:rows.map(r=>[r.minute_bucket,r.snapshot_id])}:rows;return response(d);});
  const r=await h.getReplay('session','NIFTY','2026-10-12','09:15','11:15');const rows=compact?r.canonical.rows:r.canonical;assert.equal(rows.length,3);assert.equal(rows.filter((r:any)=>compact?r[1]==='A':r.snapshot_id==='A').length,2);assert.equal(r.counts.canonical,3);
 }
});
