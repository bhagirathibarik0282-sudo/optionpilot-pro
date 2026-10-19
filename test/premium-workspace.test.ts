import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Hono } from 'hono';
import { derivePremiumSeriesInventory, derivePremiumWorkspace, premiumLiveClock, projectLivePremiumQuote, derivePremiumLiveContext } from '../premium-workspace-model.js';
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
test('series inventory deduplicates exact identities, separates indices, and never guesses expiry type',()=>{
 const x=row(0,100),rows=[x,{...x},{...x,option_type:'PE'}, {...x,symbol:'SENSEX',strike:72000}];
 const all=derivePremiumSeriesInventory(rows,date,'ALL',{ceStrike:22000,peStrike:22100});
 assert.equal(all.length,2);assert.equal(all[0].ceCount,1);assert.equal(all[0].peCount,1);assert.equal(all[0].dte,6);
 assert.equal(all[0].cePinnedAvailable,true);assert.equal(all[0].pePinnedAvailable,false);assert.ok(all.every(x=>x.seriesType==='UNVERIFIED'));
 assert.equal(derivePremiumSeriesInventory(rows,date,'SENSEX').length,1);
});
test('inventory handles valid PostgreSQL dates, rejects malformed calendar identities, and preserves absence',()=>{
 const x={...row(0,100),expiry:new Date(expiry+'T00:00:00Z')};assert.equal(derivePremiumSeriesInventory([x],date)[0].expiry,expiry);
 for(const e of ['2026-02-30','2026-10-19garbage',new Date(NaN)])assert.equal(derivePremiumSeriesInventory([{...x,expiry:e}],date).length,0);
 assert.deepEqual(derivePremiumSeriesInventory([x],'bad'),[]);assert.equal(derivePremiumSeriesInventory([x],date)[0].peCount,0);
});
test('serialized browser model resolves the shared inventory helper',()=>{
 const code='const __name=(fn,_name)=>fn;const derivePremiumSeriesInventory='+derivePremiumSeriesInventory.toString()+';const derivePremiumWorkspace='+derivePremiumWorkspace.toString()+';derivePremiumWorkspace(input);';
 const r=vm.runInNewContext(code,{input:{date,rows:[row(0,100)],minutes:'3'}});
 assert.equal(r.series[0].expiry,expiry);assert.equal(r.series[0].ceCount,1);
});
test('inventory is available across watch filters and describes loaded identities rather than fresh quotes',()=>{
 const r=run([row(0,100),row(0,100,{expiry:'2026-10-20',truth_verdict:'STALE'})],{filter:{expiries:[expiry],side:'PE',ceStrike:99999}});
 assert.equal(r.rows.length,0);assert.equal(r.series.length,2);assert.equal(r.series[1].ceCount,1);assert.equal(r.series[1].cePinnedAvailable,false);
});
test('live series metadata covers inventory before pagination and does not cross index or expiry pins',()=>{
 const entries=[{token:1,label:'CE',role:'OPTION' as const,symbol:'NIFTY' as const,expiry,strike:22000,side:'CE' as const},
 {token:2,label:'PE',role:'OPTION' as const,symbol:'NIFTY' as const,expiry,strike:22100,side:'PE' as const},
 {token:3,label:'CE2',role:'OPTION' as const,symbol:'NIFTY' as const,expiry:'2026-10-26',strike:22100,side:'CE' as const}];
 const s=new DashboardLiveStore({entries,date,missing:[],omittedExpiries:[]});
 const a=s.premiums(Date.parse(at(0)),{limit:1,ceStrike:22000,peStrike:22100,expiries:[expiry]});
 assert.equal(a.rows.length,1);assert.equal(a.series.length,2);assert.equal(a.series[0].pePinnedAvailable,true);assert.equal(a.series[1].cePinnedAvailable,false);
 assert.deepEqual(a.series,s.premiums(Date.parse(at(0)),{limit:1,offset:1,ceStrike:22000,peStrike:22100}).series);
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

function liveFixture(){
 const q={identity:{role:'OPTION',symbol:'NIFTY',expiry,strike:22000,side:'CE'},price:100,oi:200,bid:99,ask:101,volume:500,pdc:90,state:'LIVE',observedAt:at(0),receivedAt:at(0)};
 const pcr={state:'COMPLETE',expiry,fullPcr:1.2,periodMs:60000,coverage:{expected:100,freshOi:100,complete:true},sourceMinAt:at(0),sourceMaxAt:at(0),checkedAt:at(0)};
 const payload={connected:true,serverTime:at(0),snapshot:{tradeDate:date,vix:{...q,price:14},indices:[{symbol:'NIFTY',expiry,future:{...q,price:22000}}]},pcrDisplay:{NIFTY:pcr}};
 return {q,payload};
}
test('every live premium field changes with its source; IV never borrows recorded values',()=>{
 const {q,payload}=liveFixture(),ref=row(0,999,{iv:40});let p=projectLivePremiumQuote(payload,q,ref)!;
 assert.equal(p.ltp,100);assert.equal(p.oi,200);assert.equal(p.bid,99);assert.equal(p.ask,101);assert.equal(p.volume,500);assert.equal(p.iv,null);
 p=projectLivePremiumQuote(payload,{...q,price:105,oi:220,bid:104,ask:106,volume:600},ref)!;
 assert.deepEqual([p.ltp,p.oi,p.bid,p.ask,p.volume],[105,220,104,106,600]);
 assert.equal(projectLivePremiumQuote(payload,q,{...ref,expiry:'2026-10-26'})!.pdh,null);
});
test('stalled browser delivery, stale quote times and disconnect revoke every current numeric quote field',()=>{
 const {q,payload}=liveFixture();assert.equal(premiumLiveClock(payload,3000).valid,true);assert.equal(premiumLiveClock(payload,3001).valid,false);
 for(const [p,quote,elapsed] of [[payload,q,3001],[{...payload,connected:false},q,0],[payload,{...q,observedAt:at(-1)},0],[payload,{...q,receivedAt:at(-1)},0],[{...payload,snapshot:{...payload.snapshot,tradeDate:'2026-10-12'}},q,0]] as any[]){
  const point=projectLivePremiumQuote(p,quote,null,elapsed)!;assert.equal(point.truth_verdict,'STALE');for(const key of ['ltp','oi','bid','ask','volume','pdc','iv'])assert.equal((point as any)[key],null,key);
 }
});
test('live PCR needs complete exact-expiry coverage and keeps its own cadence and timestamp',()=>{
 const {payload}=liveFixture();const c=derivePremiumLiveContext(payload,'NIFTY',[expiry]);assert.equal(c.indices[0].pcr.value,1.2);assert.equal(c.indices[0].pcr.minutes,1);assert.equal(c.indices[0].pcr.at,at(0));
 for(const patch of [{coverage:{expected:100,freshOi:99,complete:true}},{expiry:'2026-10-26'},{state:'INCOMPLETE'},{checkedAt:at(-2)},{sourceMinAt:at(-2)}])assert.equal(derivePremiumLiveContext({...payload,pcrDisplay:{NIFTY:{...payload.pcrDisplay.NIFTY,...patch}}}).indices[0].pcr.value,null);
 assert.equal(derivePremiumLiveContext(payload,'NIFTY',['2026-10-26']).indices[0].pcr.value,null);
});
test('live context never keeps stale future or VIX values during a stalled delivery',()=>{
 const {payload}=liveFixture();assert.equal(derivePremiumLiveContext(payload).vix.value,14);assert.equal(derivePremiumLiveContext(payload).indices[0].future.value,22000);
 const c=derivePremiumLiveContext(payload,'ALL',[],4000);assert.equal(c.vix.value,null);assert.equal(c.indices[0].future.value,null);assert.equal(c.indices[0].pcr.value,null);
});

test('PDC is an exact current contract field and is withheld for missing or unusable observations',()=>{
 assert.equal(run([row(0,111,{pdc:101})]).rows[0].pdc,101);
 for(const patch of [{pdc:null},{pdc:0},{pdc:NaN},{truth_verdict:'STALE'},{truth_verdict:'CONFLICT'}])assert.equal(run([row(0,111,patch)]).rows[0].pdc,null);
});

test('complete ladder projects all selected cached contracts in one read, while cards retain pagination',()=>{
 const entries:any[]=Array.from({length:150},(_,i)=>({token:i+1,label:'C'+i,role:'OPTION',symbol:'NIFTY',expiry,strike:22000+i*50,side:i%2?'PE':'CE'}));
 const store=new DashboardLiveStore({entries,date,missing:[],omittedExpiries:[]}),now=Date.parse(at(0));
 const full=store.premiums(now,{view:'ladder',limit:12});assert.equal(full.rows.length,150);assert.equal(full.total,150);assert.equal(full.offset,0);
 assert.equal(store.premiums(now,{limit:12}).rows.length,12);
 const both=[...entries,{token:999,label:'SPOT',role:'SPOT',symbol:'NIFTY'}];const nearby=new DashboardLiveStore({entries:both,date,missing:[],omittedExpiries:[]});nearby.ingest([{instrumentToken:999,lastPrice:25000,exchangeTimestamp:at(0),mode:'full'}] as any,at(0));assert.equal(nearby.premiums(now,{view:'ladder',nearby:7}).rows.length,15);
});

test('ladder request validates explicit complete-view scope and widened strike range',async()=>{
 const app=new Hono();mountDashboardLiveRoutes(app,(()=>({})) as any);
 for(const q of ['view=ladder&nearby=7','view=ladder&offset=0'])assert.equal((await app.request('/dashboard-live/premiums?'+q)).status,200);
 for(const q of ['view=anything','view=ladder&offset=12','nearby=8'])assert.equal((await app.request('/dashboard-live/premiums?'+q)).status,400);
});

test('delta pairing keeps signed legs in one exact expiry and exposes nearest-match gap',async()=>{
 const {derivePremiumDeltaPair:pair}=await import('../premium-workspace-model.js');
 const rows=run([row(0,100,{delta:.51}),row(0,120,{strike:22100,delta:-.50,option_type:'PE'}),row(0,90,{strike:22200,delta:.49}),row(0,80,{strike:22300,delta:-.1,option_type:'PE'})]).rows;
 const p=pair(rows,.5);assert(p.matched);assert.equal(p.CE.strike,22000);assert.equal(p.PE.strike,22100);assert(Math.abs(p.gap-.01)<1e-10);
 assert.equal(pair([...rows,{...rows[0],expiry:'2026-10-27'}],.5).matched,false);
 assert.equal(pair([...rows,{...rows[0],symbol:'SENSEX'}],.5).matched,false);
 assert.equal(pair(rows,.8).matched,false);
});
test('delta pairing rejects missing, wrong-sign, stale, conflicting, duplicate and asynchronous legs without fallback',async()=>{
 const {derivePremiumDeltaPair:pair}=await import('../premium-workspace-model.js');
 const original=run([row(0,100,{delta:.5}),row(0,120,{strike:22100,delta:-.5,option_type:'PE'})]).rows;
 for(const patch of [{delta:null},{delta:0},{delta:.5},{delta:-2},{delta:-.55},{state:'STALE'},{price:null},{observedAt:at(1)},{at:at(1)}]){const rows=structuredClone(original);Object.assign(rows.find(r=>r.type==='PE'),patch);assert.equal(pair(rows,.5).matched,false,JSON.stringify(patch));}
 assert.equal(pair([...original,original[0]],.5).matched,false);
 const conflicts=run([row(0,100,{delta:.5}),row(0,100,{delta:.49}),row(0,120,{strike:22100,delta:-.5,option_type:'PE'})]).rows;assert.equal(pair(conflicts,.5).matched,false);
 const unproved=original.map(r=>({...r,state:'LIVE'}));assert.equal(pair(unproved,.5,'LIVE').matched,false);
 const live=original.map(r=>({...r,state:'LIVE',deltaSource:'BLACK_SCHOLES_MODEL'}));assert(pair(live,.5,'LIVE').matched);live[1].observedAt=new Date(Date.parse(at(0))+5001).toISOString();assert.equal(pair(live,.5,'LIVE').matched,false);
 assert.equal(pair(original,.5,'LIVE').matched,false);
});
test('live Model Delta projection checks exact contract, assumptions and both source times independently of price',()=>{
 const {q,payload}=liveFixture();const identity={...q.identity,token:42};
 const model={source:'BLACK_SCHOLES_MODEL',delta:.51,token:42,symbol:'NIFTY',expiry,strike:22000,side:'CE',premium:100,premiumAt:at(0),spot:22000,spotAt:at(0),calculatedAt:at(0),annualRiskFreeRate:.05,annualDividendYield:0};
 const live={...q,identity,modelDelta:model};assert.equal(projectLivePremiumQuote(payload,live)!.delta,.51);
 for(const patch of [{source:'BROKER'},{delta:null},{delta:-.5},{delta:1.1},{token:43},{symbol:'SENSEX'},{expiry:'2026-10-27'},{strike:22100},{side:'PE'},{premium:101},{premiumAt:at(1)},{spotAt:new Date(Date.parse(at(0))-2001).toISOString()},{annualRiskFreeRate:.06},{annualDividendYield:.01},{calculatedAt:at(1)}]){
  const p=projectLivePremiumQuote(payload,{...live,modelDelta:{...model,...patch}})!;assert.equal(p.delta,null,JSON.stringify(patch));assert.equal(p.ltp,100,'unavailable model must not hide a fresh premium');
 }
 const later={...payload,serverTime:new Date(Date.parse(at(0))+5001).toISOString()};assert.equal(projectLivePremiumQuote(later,live)!.delta,null);
 assert.equal(projectLivePremiumQuote({...payload,connected:false},live)!.delta,null);
 assert.equal(projectLivePremiumQuote(payload,{...q,delta:.51},row(0,100,{delta:.51}))!.delta,null,'neither unproved live fields nor recorded Greeks are borrowed');
});

test('deep ITM and custom Delta targets accept values through 1 and reject invalid targets',async()=>{
 const {derivePremiumDeltaPair:pair}=await import('../premium-workspace-model.js');
 const rows=run([row(0,800,{delta:.99}),row(0,820,{strike:22500,delta:-.99,option_type:'PE'})]).rows;
 assert(pair(rows,.99).matched);assert(pair(rows,1).matched);
 for(const target of [0,-.1,1.01,NaN,Infinity])assert.equal(pair(rows,target).matched,false);
});
