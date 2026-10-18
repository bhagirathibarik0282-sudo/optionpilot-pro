import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {deriveMarketInvestigation as derive,MARKET_INVESTIGATION_HTML as html,installMarketInvestigation} from '../market-investigation.js';
import {derivePremiumDeltaPair} from '../premium-workspace-model.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
const date='2026-10-16',expiry='2026-10-19',start=Date.parse(date+'T04:00:00Z'),at=(m:number)=>new Date(start+m*60000).toISOString();
const cfg:any={date,symbol:'NIFTY',mode:'EVENT',event:'ALL',tracking:'START',target:.5,window:3};
function fixture(){const market:any[]=[],chain:any[]=[],options:any[]=[];for(let m=-30;m<=30;m+=3){
 const id='snapshot-'+m;market.push({symbol:'NIFTY',minute_bucket:at(m),truth_verdict:'TRUE',snapshot_id:id,backend_timestamp:at(m),spot_ltp:24000+m,future_ltp:24010+m,future_oi:10000+m,india_vix:15+m/100});
 chain.push({symbol:'NIFTY',expiry,minute_bucket:at(m),truth_verdict:'TRUE',call_wall_strike:m<0?24100:24200,put_wall_strike:23900,max_pain:m<0?24000:24100,call_wall_oi:1000+m,put_wall_oi:1200+m,full_chain_oi_pcr:1.2,full_pcr_source:'Exact archived full-chain source'});
 for(const [option_type,strike,delta] of [['CE',24000,.5],['PE',24100,-.5]] as const)options.push({symbol:'NIFTY',expiry,strike,option_type,delta,ltp:option_type==='CE'?100+m:120-m,oi:2000+m,iv:18,minute_bucket:at(m),quote_timestamp:at(m),quote_age_seconds:0,snapshot_id:id,truth_verdict:'TRUE'});
 }return {market,chain,options};}
test('same-expiry wall and Max Pain changes produce exact before/after Spot and locked-Delta premium evidence',()=>{
 const data=fixture(),before=structuredClone(data),result=derive(data,cfg);assert.equal(result.events.length,1);const e=result.events[0];
 assert.deepEqual(e.facts.map((f:any)=>f.kind),['CE_WALL','MAX_PAIN']);assert.equal(e.spotChange,3);assert(Math.abs(e.ceReturn-3)<1e-8);assert(Math.abs(e.peReturn+2.5)<1e-8);assert(e.complete);assert.equal(e.pair.CE.strike,24000);assert.equal(e.pair.PE.strike,24100);assert.equal(e.points.find((p:any)=>p.offset===-3).values.ceWall,24100);assert.deepEqual(data,before);
 assert.equal(derive(data,{...cfg,event:'BOTH'}).events.length,1);assert.equal(derive(data,{...cfg,event:'PE_WALL'}).events.length,0);
});
test('duplicates, unverified snapshots, stale quotes, missing exact endpoints and expiry pins never borrow other data',()=>{
 for(const modify of [(d:any)=>d.options.find((r:any)=>r.minute_bucket===at(3)&&r.option_type==='CE').truth_verdict='UNKNOWN',(d:any)=>d.options.find((r:any)=>r.minute_bucket===at(3)&&r.option_type==='CE').quote_age_seconds=61,(d:any)=>d.options.find((r:any)=>r.minute_bucket===at(3)&&r.option_type==='CE').snapshot_id='wrong',(d:any)=>d.options.push({...d.options.find((r:any)=>r.minute_bucket===at(3)&&r.option_type==='CE')}),(d:any)=>d.market.push({...d.market.find((r:any)=>r.minute_bucket===at(3))})]){const d=fixture();modify(d);const e=derive(d,cfg).events[0];assert.equal(e.ceReturn,null);assert.equal(e.complete,false);}
 const d=fixture();d.chain.push({...d.chain.find(r=>r.minute_bucket===at(0))});assert.equal(derive(d,cfg).events.length,0);
 assert.equal(derive(fixture(),{...cfg,expiry:'2026-10-27'}).events.length,0);assert.equal(derive(fixture(),{...cfg,dte:'0'}).events.length,0);
});
test('Match Delta at start keeps contracts fixed while Follow Delta marks re-selection and withholds mixed returns',()=>{
 const d=fixture();for(const r of d.options)if(r.minute_bucket===at(3))r.delta=r.option_type==='CE'?.7:-.7;
 d.options.push(...d.options.filter(r=>r.minute_bucket===at(3)).map(r=>({...r,strike:r.strike+200,delta:r.option_type==='CE'?.5:-.5,ltp:900})));
 assert(Math.abs(derive(d,cfg).events[0].ceReturn-3)<1e-8);const follow=derive(d,{...cfg,tracking:'FOLLOW'}).events[0];assert.equal(follow.ceReturn,null);assert(follow.points.find((p:any)=>p.offset===3).changed);
 const fixed=derive(d,{...cfg,tracking:'FIXED',ceStrike:24000,peStrike:24100}).events[0];assert(Math.abs(fixed.ceReturn-3)<1e-8);
});
test('manual Market Move uses requested endpoints; old 3m data leaves the 1m outcome missing',()=>{
 const d=fixture();const e=derive(d,{...cfg,mode:'MOVE',start:'09:30',end:'09:36'}).events[0];assert.equal(e.window,6);assert.equal(e.spotChange,6);assert.equal(e.facts[0].kind,'MOVE');
 assert.equal(derive(d,{...cfg,window:1}).events[0].ceReturn,null);
 const broken=fixture();broken.chain=broken.chain.filter(r=>r.minute_bucket!==at(-3));assert.equal(derive(broken,cfg).events.length,0);
});
function harness(replay?:any){const nodes=new Map<string,any>();for(const [,id]of html.matchAll(/id="([^"]+)"/g))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,hidden:false});
 const values:any={'mi-from':'2026-10-15','mi-to':date,'mi-symbol':'NIFTY','mi-mode':'EVENT','mi-event':'ALL','mi-tracking':'START','mi-target':'.5','mi-window':'3','mi-dte':'','mi-start':'09:30','mi-end':'10:00'};for(const [id,v]of Object.entries(values))nodes.get(id).value=v;
 const calls:any[]=[],api={getState:()=>({recordedDates:['2026-10-15',date]}),replay:async(symbol:string,date:string)=>{calls.push({symbol,date});return replay?await replay(symbol,date):fixture();}};
 const ctx=vm.createContext({__name:(f:any)=>f,document:{getElementById:(id:string)=>nodes.get(id)},window:{dispatchEvent(){}},CustomEvent:class{},deriveMarketInvestigation:derive,derivePremiumDeltaPair,api});
 const view=vm.runInContext('('+installMarketInvestigation.toString()+')(api)',ctx);return {nodes,calls,view,click:(id:string,dataset:any={})=>nodes.get('mi-shell').onclick({target:{closest:()=>({id,dataset})}})};}
test('actual multi-day UI loads sequentially without changing the dashboard session, discloses failed days and supports similarity',async()=>{
 const h=harness(async(_s:string,d:string)=>{if(d==='2026-10-15')throw Error('unavailable');return fixture();});await h.view.run();assert.equal(h.calls.length,2);assert(h.nodes.get('mi-status').textContent.includes('FAILED: 2026-10-15'));assert(h.nodes.get('mi-summary').innerHTML.includes('1 sessions read'));assert(h.nodes.get('mi-detail').innerHTML.includes('Max Pain'));h.click('mi-similar');assert.equal(h.nodes.get('mi-mode').value,'SIMILAR');assert(h.nodes.get('mi-status').textContent.includes('Similar directions'));
});
test('cancel stops later date reads and changed choices clear old results',async()=>{
 let release:any;const h=harness(()=>new Promise(r=>release=r));const pending=h.view.run();h.click('mi-cancel');release(fixture());await pending;assert.equal(h.calls.length,1);assert(h.nodes.get('mi-status').textContent.includes('Cancelled'));h.nodes.get('mi-shell').onchange();assert.equal(h.nodes.get('mi-detail').innerHTML,'');
});
test('dashboard serializes investigation and forwards the existing bounded FULL replay API through workspace layers',()=>{
 const page=renderBusinessDashboardV1Html({} as any);assert(page.includes('id="mi-shell"'));assert(page.includes('replay:api.replay'));assert(page.includes("symbol,date,'09:15',observationSessionClose(date),'FULL'"));for(const [,code]of page.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(code);
});

test('event detection uses only before/current facts and new one-minute sessions preserve minute outcomes',()=>{
 const old=fixture(),first=derive(old,cfg).events[0];for(const r of old.chain)if(r.minute_bucket>at(0)){r.call_wall_strike=99999;r.max_pain=99999;}
 assert.deepEqual(derive(old,cfg).events[0].facts,first.facts);assert.deepEqual(derive(old,cfg).events[0].pair,first.pair);
 const d=fixture(),date='2026-10-19',shift=3*86400000;for(const kind of ['market','chain','options'] as const)for(const r of d[kind]){r.minute_bucket=new Date(Date.parse(r.minute_bucket)+shift).toISOString();if(r.backend_timestamp)r.backend_timestamp=new Date(Date.parse(r.backend_timestamp)+shift).toISOString();if(r.quote_timestamp)r.quote_timestamp=new Date(Date.parse(r.quote_timestamp)+shift).toISOString();if(r.expiry)r.expiry='2026-10-20';}
 assert.equal(derive(d,{...cfg,date}).events.length,0); // Missing −1m must not be replaced with −3m.
});
test('fixed contracts and oversized date ranges are rejected before any archive request',async()=>{
 const h=harness();h.nodes.get('mi-tracking').value='FIXED';await h.view.run();assert.equal(h.calls.length,0);assert(h.nodes.get('mi-status').textContent.includes('exact expiry'));
 h.nodes.get('mi-tracking').value='START';h.nodes.get('mi-target').value='1.2';await h.view.run();assert.equal(h.calls.length,0);
});

test('quote freshness uses actual backend receipt, including valid observations late within the minute',()=>{
 const d=fixture();for(const r of d.market)r.backend_timestamp=new Date(Date.parse(r.minute_bucket)+45000).toISOString();for(const r of d.options)r.quote_timestamp=new Date(Date.parse(r.minute_bucket)+44000).toISOString();assert(derive(d,cfg).events[0].complete);
 const row=d.options.find(r=>r.minute_bucket===at(3)&&r.option_type==='CE');row.quote_timestamp=new Date(Date.parse(at(3))-16000).toISOString();assert.equal(derive(d,cfg).events[0].ceReturn,null);
});

test('Spot and selected-premium level crossings use unchanged recorded references and exact adjacent observations',()=>{
 const d=fixture();for(const r of d.market){r.pdh=24001;r.pdl=23900;}for(const r of d.options){r.pdh=r.option_type==='CE'?101:150;r.pdl=60;}
 const result=derive(d,{...cfg,event:'LEVELS'});assert(result.events.some((e:any)=>e.facts.some((f:any)=>f.kind==='SPOT_PDH')));assert(result.events.some((e:any)=>e.facts.some((f:any)=>f.kind==='CE_PDH')));
});

test('Follow Delta UI visibly marks changed strikes and withholds cross-contract rupee differences as well as returns',async()=>{
 const d=fixture();for(const r of d.options)if(r.minute_bucket===at(3))r.delta=r.option_type==='CE'?.7:-.7;
 d.options.push(...d.options.filter(r=>r.minute_bucket===at(3)).map(r=>({...r,strike:r.strike+200,delta:r.option_type==='CE'?.5:-.5,ltp:900})));
 const h=harness(async()=>d);h.nodes.get('mi-from').value=date;h.nodes.get('mi-tracking').value='FOLLOW';await h.view.run();const detail=h.nodes.get('mi-detail').innerHTML;
 assert(detail.includes('<b>CONTRACT CHANGED</b>'));assert(detail.includes('Leg differences and returns withheld'));assert(!detail.includes('Observed fixed-contract range'));assert.match(detail,/<th>CE ₹<\/th>.*?<td>—<\/td><\/tr>/);assert(!detail.includes('<td>+800</td>'));
});
