import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSharedEventMemory,installSharedEventMemory} from '../shared-event-memory-view.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import vm from 'node:vm';
const date='2026-11-24',t=(m:number)=>new Date(Date.parse(date+'T09:15:00+05:30')+m*60000).toISOString();
const safety={affectsVerdict:false,affectsTelegram:false,affectsExecution:false};
const e={...safety,version:'INTRADAY_NOTABLE_EVENT_V1',memoryKey:'E',tradeDate:date,symbol:'NIFTY',expiry:'2026-11-26',strike:25500,at:t(3),facts:[{field:'CE PDL',from:t(0),before:110,after:90}],pair:{ce:{at:t(3),quoteAt:t(3),ltp:90},pe:{at:t(3),quoteAt:t(3),ltp:100}}};
const r={...safety,version:'INTRADAY_PREMIUM_RESPONSE_V1',memoryKey:'R',eventKey:'E',tradeDate:date,symbol:e.symbol,expiry:e.expiry,strike:e.strike,eventAt:e.at,targetAt:t(6),minutes:3,status:'QUALIFIED',pair:{ce:{at:t(6),quoteAt:t(6),ltp:81},pe:{at:t(6),quoteAt:t(6),ltp:115}},ceReturnPct:-10,peReturnPct:15,straddleReturnPct:3.16};
const body={ok:true,tradeDate:date,events:[e],responses:[r],availability:{events:{E:t(4)},responses:{R:t(7)}},readLimitEvents:1000};
test('event and response require both observation and storage cutoff; backwards seek removes future memory',()=>{
 assert.equal(projectSharedEventMemory(body,date,t(3)).events.length,0);
 assert.equal(projectSharedEventMemory(body,date,t(4)).events.length,1);
 assert.equal(projectSharedEventMemory(body,date,t(6)).responses.length,0);
 assert.equal(projectSharedEventMemory(body,date,t(7)).responses.length,1);
 assert.equal(projectSharedEventMemory(body,date,t(5)).responses.length,0);
 assert.equal(projectSharedEventMemory(body,date,t(7),'SENSEX').events.length,0);
 assert.equal(projectSharedEventMemory({...body,availability:null},date,t(7)).events.length,0);
 assert.equal(projectSharedEventMemory({...body,events:[e,e]},date,t(7)).events.length,0);
 assert.equal(projectSharedEventMemory({...body,responses:[{...r,strike:25400}]},date,t(7)).responses.length,0);
 assert.equal(projectSharedEventMemory({...body,responses:[{...r,pair:{ce:null,pe:null}}]},date,t(7)).responses.length,0);
 assert.equal(projectSharedEventMemory({...body,responses:[{...r,targetAt:t(9)}]},date,t(12)).responses.length,0);
});
test('dashboard contains one embedded memory panel and serializable helpers',()=>{
 const html=renderBusinessDashboardV1Html({} as any);assert.equal((html.match(/id="mb-shared-memory"/g)||[]).length,1);
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('manual saved memory load only; seek uses cached data and date change clears it',async()=>{
 const nodes=new Map(['','-load','-status','-results','-index'].map(id=>['mb-shared-memory'+id,{innerHTML:'',textContent:'',value:'ALL'}]));
 let c={active:true,date,at:t(4)},calls=0;
 const ctx=vm.createContext({document:{getElementById:(id:string)=>nodes.get(id)},fetch:async()=>{calls++;return {ok:true,json:async()=>body}},AbortController,Date,Map,Set,Number,JSON});
 vm.runInContext('globalThis.install='+installSharedEventMemory.toString()+';globalThis.project='+projectSharedEventMemory.toString(),ctx);
 const ui=ctx.install(()=>c,ctx.project);assert.equal(calls,0);await (nodes.get('mb-shared-memory-load') as any).onclick();assert.equal(calls,1);
 assert.match(nodes.get('mb-shared-memory-results')!.innerHTML,/25500/);assert.doesNotMatch(nodes.get('mb-shared-memory-results')!.innerHTML,/15\.00/);
 c={...c,at:t(7)};ui.render();assert.match(nodes.get('mb-shared-memory-results')!.innerHTML,/15\.00/);assert.equal(calls,1);
 c={...c,at:t(3)};ui.render();assert.doesNotMatch(nodes.get('mb-shared-memory-results')!.innerHTML,/25500/);
 c={...c,date:'2026-11-23'};ui.render();assert.equal(nodes.get('mb-shared-memory-results')!.innerHTML,'');
});
