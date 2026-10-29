import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { premiumRecordStatus,sourceQuoteAgeSeconds } from '../h1-premium-record-quality.ts';
import { participationMinute,createParticipationMinuteRecorder } from '../participation-minute-recorder.ts';

const now=new Date('2026-10-29T04:18:08Z');
const leg={verdict:'TRUE',quoteTimestamp:'2026-10-29T04:18:06Z',now,expiry:'2026-11-03',legExpiry:'2026-11-03',strike:22750,ltp:150};
const raw=JSON.parse(readFileSync(new URL('./fixtures/live-capture.json',import.meta.url),'utf8'));
const at=Date.parse(raw.serverTime);
const copy=()=>structuredClone(raw);
function moduleCode(file){return stripTypeScriptTypes(readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,''));}

test('fresh exact contract retains eligibility and original source age',()=>{
 assert.equal(premiumRecordStatus(leg),'RESEARCH_ELIGIBLE');assert.equal(sourceQuoteAgeSeconds(leg.quoteTimestamp,now),2);
});
test('snapshot TRUE cannot make an old session or stale leg eligible',()=>{
 assert.equal(premiumRecordStatus({...leg,quoteTimestamp:'1970-01-01T00:00:00Z'}),'DIAGNOSTIC_OTHER_SESSION');
 assert.equal(premiumRecordStatus({...leg,quoteTimestamp:'2026-10-29T04:10:00Z'}),'DIAGNOSTIC_STALE_PREMIUM');
});
test('future source time remains negative age and is blocked beyond source clock skew',()=>{
 const q='2026-10-29T04:20:00Z';assert.ok(sourceQuoteAgeSeconds(q,now)<0);
 assert.equal(premiumRecordStatus({...leg,quoteTimestamp:q}),'DIAGNOSTIC_FUTURE_SOURCE_TIME');
});
test('invalid/missing source and identity cannot qualify',()=>{
 for(const q of [null,'bad','2026-10-29T04:18:06'])assert.notEqual(premiumRecordStatus({...leg,quoteTimestamp:q}),'RESEARCH_ELIGIBLE');
 for(const attrs of [{legExpiry:null},{legExpiry:'2026-11-09'},{expiry:'2026-02-31',legExpiry:'2026-02-31'},{ltp:0},{strike:0}])assert.notEqual(premiumRecordStatus({...leg,...attrs}),'RESEARCH_ELIGIBLE');
 assert.equal(premiumRecordStatus({...leg,verdict:'PARTIAL'}),'DIAGNOSTIC_PARTIAL');
});
test('actual H1 writer keeps raw stale leg but changes only its option quality',async()=>{
 const options=[],chains=[];
 const c=vm.createContext({console,premiumRecordStatus,sourceQuoteAgeSeconds,
  openingGapPercent:()=>null,dbInsert:async()=>{},dbUpsertMarketSnapshot1m:async()=>{},
  dbUpsertOptionSnapshot1m:async r=>options.push(r),dbUpsertChainState1m:async r=>chains.push(r),
 });vm.runInContext(moduleCode('h1-recorder-adapter.ts'),c);
 const captured=JSON.parse(readFileSync(new URL('./fixtures/replay-NIFTY.json',import.meta.url),'utf8')).canonical.at(-1).market;
 const market=structuredClone(captured);
 market.expiries=market.expiries.map(e=>({...e,expiryDate:new Date(e.expiryDate)}));
 const selected=market.expiries[0].ceStrikes.find(r=>r.isAtm)||market.expiries[0].ceStrikes[0];
 selected.quoteTimestamp='1970-01-01T00:00:00Z';const originalPrice=selected.lastPrice;
 await c.recordH1Snapshot({market,truthVerdict:'TRUE',calculationVersion:'TEST',now:new Date(captured.timestamp)});
 const row=options.find(r=>r.strike===selected.strike&&r.optionType==='CE'&&r.expiry===selected.expiryDate);
 assert.ok(row);assert.equal(row.ltp,originalPrice);assert.equal(row.quoteTimestamp,selected.quoteTimestamp);
 assert.equal(row.validationStatus,'DIAGNOSTIC_OTHER_SESSION');assert.ok(chains.length>0);
});
test('actual live participation capture preserves all stocks/sectors without credentials',()=>{
 const p=participationMinute(raw,at);assert.ok(p);assert.equal(p.rows.length,16);
 assert.equal(p.rows.filter(r=>r.role==='STOCK').length,8);assert.equal(p.rows.filter(r=>r.role==='SECTOR').length,8);
 assert.equal(p.tradeDate,'2026-10-29');assert.equal(p.minuteBucket,'2026-10-29T04:22:00.000Z');
 assert.ok(p.rows.every(r=>r.observedAt&&r.receivedAt));
 assert.doesNotMatch(JSON.stringify(p),/accessToken|sessionToken|apiKey|brokerSession/);
});
test('participation preserves stale value and labels its status; missing is never zero',()=>{
 const f=copy();f.snapshot.participation[0].observedAt='2026-10-29T03:45:00Z';
 const old=f.snapshot.participation[0].price,p=participationMinute(f,at);
 assert.equal(p.rows[0].price,old);assert.equal(p.rows[0].state,'DIAGNOSTIC_STALE_OR_MISSING');
 f.snapshot.participation[0].price=null;assert.equal(participationMinute(f,at).rows[0].price,null);
 f.snapshot.participation[1].price=f.snapshot.participation[1].pdc;
 assert.equal(participationMinute(f,at).rows[1].changePct,0);
});
test('wrong session, duplicates, disconnected feed and cached frame are rejected',()=>{
 for(const change of [f=>f.connected=false,f=>f.snapshot.tradeDate='2026-10-28',f=>f.snapshot.participation.push(f.snapshot.participation[0]),f=>f.serverTime='2026-10-29T03:45:00Z']){
  const f=copy();change(f);assert.equal(participationMinute(f,at),null);
 }
});
test('minute writer deduplicates, retries DB failures and survives duplicate-on-restart',async()=>{
 let attempts=0;const r=createParticipationMinuteRecorder(async()=>{attempts++;if(attempts===1)throw Error('DB lost');return true;});
 assert.equal(await r.capture(()=>raw,at),'FAILED');assert.equal(await r.capture(()=>raw,at),'SAVED');
 assert.equal(await r.capture(()=>{throw Error('must not project again');},at+1000),'SKIPPED');assert.equal(attempts,2);
 const restarted=createParticipationMinuteRecorder(async()=>false);
 assert.equal(await restarted.capture(()=>raw,at),'ALREADY_RECORDED');assert.equal(await restarted.capture(()=>raw,at),'SKIPPED');
});
test('overlapping timer calls cannot start parallel writes',async()=>{
 let finish,calls=0;const r=createParticipationMinuteRecorder(()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const first=r.capture(()=>raw,at);assert.equal(await r.capture(()=>raw,at),'SKIPPED');finish(true);
 assert.equal(await first,'SAVED');assert.equal(calls,1);
});
function dbRuntime({duplicate=false,fail=false}={}){
 const queries=[];let released=false;
 const client={query:async(sql,params)=>{queries.push({sql,params});if(fail&&sql.startsWith('INSERT'))throw Error('write failed');return {rows:sql.startsWith('SELECT id')&&duplicate?[{id:1}]:[]};},release:()=>released=true};
 const c=vm.createContext({getPool:()=>({connect:async()=>client})});
 const source=readFileSync(new URL('../db.ts',import.meta.url),'utf8');
 vm.runInContext(stripTypeScriptTypes(source.slice(source.indexOf('export async function dbSaveParticipationMinuteOnce')).replace('export ','')),c);
 return {c,queries,released:()=>released};
}
test('DB uses separate post-lock read, commits only a successful insert, releases client',async()=>{
 const r=dbRuntime();assert.equal(await r.c.dbSaveParticipationMinuteOnce(participationMinute(raw,at)),true);
 const q=r.queries.map(x=>x.sql);assert.ok(q.findIndex(x=>x.includes('pg_advisory_xact_lock'))<q.findIndex(x=>x.startsWith('SELECT id')));
 assert.equal(q.filter(x=>x.startsWith('INSERT')).length,1);assert.equal(q.at(-1),'COMMIT');assert.equal(r.released(),true);
});
test('DB duplicate skips insert and DB error rolls back instead of claiming success',async()=>{
 const d=dbRuntime({duplicate:true});assert.equal(await d.c.dbSaveParticipationMinuteOnce(participationMinute(raw,at)),false);
 assert.equal(d.queries.some(x=>x.sql.startsWith('INSERT')),false);
 const r=dbRuntime({fail:true});await assert.rejects(r.c.dbSaveParticipationMinuteOnce(participationMinute(raw,at)));
 assert.equal(r.queries.at(-1).sql,'ROLLBACK');assert.equal(r.released(),true);
});
test('actual EOD builder includes minute participation by observed tradeDate',async()=>{
 const c=vm.createContext({pg:{Pool:class{}},process:{env:{}},console});
 vm.runInContext(moduleCode('eod-archive-job.ts').split('if (import.meta.url')[0],c);
 let sql='',params;
 const payload={participationMinutes:[{minuteBucket:'2026-10-29T04:22:00.000Z'}]};
 const client={query:async(q,p)=>{sql=q;params=p;return {rows:[{payload}]};}};
 assert.equal(await c.buildPayload(client,'2026-10-29'),payload);
 assert.match(sql,/'participationMinutes'/);assert.match(sql,/DASHBOARD_PARTICIPATION_MINUTE_V1/);
 assert.match(sql,/payload->>'tradeDate'=\$1::text/);assert.equal(params[0],'2026-10-29');
});
test('existing runtime timer invokes archive without requiring a browser read',async()=>{
 let tick,open=true,calls=0;
 const c=vm.createContext({process:{env:{NODE_ENV:'production'}},console,
  createParticipationMinuteRecorder:()=>({capture:async read=>{assert.equal(typeof read,'function');calls++;return 'SAVED';}}),
  dbSaveParticipationMinuteOnce:()=>{},setInterval:fn=>{tick=fn;return {unref(){}};},
  subscribeKiteAuthoritySessionPersisted:()=>{},isIndianEquityMarketOpenAt:()=>open,
 });vm.runInContext(moduleCode('dashboard-live-runtime.ts'),c);
 c.startDashboardLiveRuntime();tick();await Promise.resolve();assert.equal(calls,1);
 open=false;tick();await Promise.resolve();assert.equal(calls,1);
});
test('actual EOD row count includes the new archive kind',async()=>{
 const c=vm.createContext({pg:{Pool:class{}},process:{env:{}},console});
 vm.runInContext(moduleCode('eod-archive-job.ts').split('if (import.meta.url')[0],c);
 let sql='';const result=await c.sourceCounts({query:async q=>{sql=q;return {rows:[{market_count:'4',participation_minute_count:'1'}]};}},'2026-10-29');
 assert.match(sql,/participation_minute_count/);assert.equal(result.total,5);
});
