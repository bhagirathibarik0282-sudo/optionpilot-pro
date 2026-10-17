import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { derivePremiumWorkspace } from '../premium-workspace-model.js';
import { DashboardLiveStore } from '../dashboard-live-feed.js';
import { mountDashboardLiveRoutes } from '../dashboard-live-http.js';

const date='2026-10-13',expiry='2026-10-19',at=(m:number)=>new Date(Date.parse(date+'T04:00:00Z')+m*60000).toISOString();
const row=(m:number,price:number,extra:any={})=>({symbol:'NIFTY',expiry,strike:22000,option_type:'CE',minute_bucket:at(m),truth_verdict:'TRUE',ltp:price,pdh:110,pdl:90,oi:100+m,pdc:100,...extra});
const run=(rows:any[],extra:any={})=>derivePremiumWorkspace({date,rows,minutes:'3',...extra});
test('exact contract response, PDL recovery interval and own-level identity are preserved',()=>{
 const r=run([row(0,85),row(3,95)]).rows[0];assert.equal(r.reaction,'PDL RECOVER');assert.equal(r.fromAt,at(0));assert.equal(r.eventFrom,at(0));assert.equal(r.eventAt,at(3));assert(Math.abs(r.change-11.76470588)<1e-6);assert.equal(r.dte,6);
 const all=run([row(0,85),row(3,95),row(0,200,{option_type:'PE'}),row(3,180,{option_type:'PE'})],{filter:{ceStrike:22000,peStrike:22100}});assert.equal(all.rows.length,1);assert.equal(all.rows[0].type,'CE');
});
test('1/5 minute missing baselines stay missing and stale/conflicting values do not become live prices',()=>{
 assert.equal(run([row(0,100),row(3,111)],{minutes:'1'}).rows[0].change,null);
 assert.equal(run([row(0,100),row(3,111)],{minutes:'5'}).rows[0].change,null);
 for(const rows of [[row(0,100),row(3,111),row(3,112)],[row(0,100),row(3,111,{truth_verdict:'STALE'})]]){const r=run(rows).rows[0];assert.equal(r.price,null);assert.equal(r.change,null);assert.equal(r.eventAt,null);assert.equal(r.oi,null);}
});
test('a gap clears a prior event time and never labels an unseen crossing',()=>{
 const r=run([row(0,100),row(3,111),row(12,115)]).rows[0];assert.equal(r.eventAt,null);assert.equal(r.reaction,'ABOVE PDH');
});
test('FIB needs an exact earlier same-contract 15:30 record and cannot borrow another expiry',()=>{
 const prior={...row(0,100),minute_bucket:'2026-10-12T10:00:00Z',day_high:120,day_low:80};
 const r=run([row(0,111)],{prior:[prior]}).rows[0];assert.equal(r.fib.P,100);assert.equal(r.fib.R1,115.28);
 for(const p of [{...prior,expiry:'2026-10-26'},{...prior,minute_bucket:'2026-10-12T09:57:00Z'}])assert.deepEqual(run([row(0,111)],{prior:[p]}).rows[0].fib,{});
});
test('DTE, side, expiry and independently pinned strikes compose correctly',()=>{
 const rows=[row(0,100),row(0,101,{strike:22100,option_type:'PE'}),row(0,102,{expiry:'2026-10-13'})];
 assert.equal(run(rows,{filter:{dte:'NEAR'}}).rows.length,1);
 assert.equal(run(rows,{filter:{side:'PE',peStrike:22100}}).rows[0].price,101);
 assert.equal(run(rows,{filter:{expiries:['2026-10-26']}}).rows.length,0);
});
test('3/5/7 strike scopes follow each index ATM and an explicit CE strike remains independent',()=>{
 const rows=Array.from({length:11},(_,i)=>row(0,100+i,{strike:21500+i*100}));
 assert.equal(run(rows,{spots:{NIFTY:22010},filter:{strikeScope:'3'}}).rows.length,3);
 assert.equal(run(rows,{spots:{NIFTY:22010},filter:{strikeScope:'5'}}).rows.length,5);
 assert.equal(run(rows,{spots:{NIFTY:22010},filter:{strikeScope:'7'}}).rows.length,7);
 assert.equal(run(rows,{spots:{NIFTY:22010},filter:{strikeScope:'3',ceStrike:21500}}).rows[0].strike,21500);
});
test('live baseline exposes actual sample time and previous-close change uses its separate basis',()=>{
 const r=run([row(0,100),row(3.2,110)],{live:true}).rows[0];assert.equal(r.fromAt,at(0));assert(Math.abs(r.change-10)<1e-8);
 assert.equal(run([row(0,110,{pdc:100})],{minutes:'DAY'}).rows[0].fromAt,null);
});
test('cache watch is bounded, paginated, filtered and expires source values',()=>{
 const entries=Array.from({length:130},(_,i)=>({token:i+1,label:String(i),role:'OPTION' as const,symbol:'NIFTY' as const,expiry,strike:22000+i*50,side:i%2?'PE' as const:'CE' as const}));
 const s=new DashboardLiveStore({entries,date,missing:[],omittedExpiries:[]});const now=Date.parse(at(0));
 s.ingest(entries.map(e=>({instrumentToken:e.token,lastPrice:100,mode:'full',exchangeTimestamp:at(0),oi:50,close:90})) as any,at(0));
 assert.equal(s.premiums(now,{limit:60}).rows.length,60);assert.equal(s.premiums(now,{limit:60,offset:120}).rows.length,10);
 assert.equal(s.premiums(now,{side:'PE'}).total,65);assert.equal(s.premiums(now,{ceStrike:22000,side:'CE'}).rows[0].price,100);
 assert.equal(s.premiums(now+31000).rows[0].price,null);assert.equal(s.premiums(now+31000).rows[0].pdc,null);
 assert.equal(s.premiums(now,{symbol:'SENSEX'}).total,0);
});
test('watch route validates every public filter and returns no-store closed-feed state',async()=>{
 const app=new Hono();mountDashboardLiveRoutes(app);
 const r=await app.request('/dashboard-live/premiums?symbol=NIFTY&side=CE&nearby=2&limit=60');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).snapshot,null);
 for(const q of ['symbol=OTHER','side=XX','limit=121','offset=-1','expiries=bad','nearby=10','ceStrike=NaN','minDte=10&maxDte=4'])assert.equal((await app.request('/dashboard-live/premiums?'+q)).status,400,q);
});
