import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSharedEventMemory,installSharedEventMemory,buildSharedEventTimeline,buildSharedEventComparison} from '../shared-event-memory-view.js';
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
 const ctx=vm.createContext({__name:(fn:Function)=>fn,document:{getElementById:(id:string)=>nodes.get(id)},fetch:async()=>{calls++;return {ok:true,json:async()=>body}},AbortController,Date,Map,Set,Number,JSON});
 vm.runInContext('globalThis.install='+installSharedEventMemory.toString()+';globalThis.project='+projectSharedEventMemory.toString(),ctx);
 const ui=ctx.install(()=>c,ctx.project);assert.equal(calls,0);await (nodes.get('mb-shared-memory-load') as any).onclick();assert.equal(calls,1);
 assert.match(nodes.get('mb-shared-memory-results')!.innerHTML,/25500/);assert.doesNotMatch(nodes.get('mb-shared-memory-results')!.innerHTML,/15\.00/);
 c={...c,at:t(7)};ui.render();assert.match(nodes.get('mb-shared-memory-results')!.innerHTML,/15\.00/);assert.equal(calls,1);
 c={...c,at:t(3)};ui.render();assert.doesNotMatch(nodes.get('mb-shared-memory-results')!.innerHTML,/25500/);
 c={...c,date:'2026-11-23'};ui.render();assert.equal(nodes.get('mb-shared-memory-results')!.innerHTML,'');
});

test('event timeline freezes before/event at event storage time and keeps future outcomes blank',()=>{
 const event={...e,at:t(3)},market=(m:number,receipt=t(m))=>({symbol:'NIFTY',minute_bucket:t(m),created_at:receipt,truth_marker_created_at:receipt,backend_timestamp:receipt,snapshot_id:'s'+m,truth_verdict:'TRUE',spot_ltp:25000+m,india_vix:12});
 const leg=(m:number,side:string,extra:any={})=>({symbol:'NIFTY',expiry:event.expiry,strike:event.strike,option_type:side,minute_bucket:t(m),created_at:t(m),truth_marker_created_at:t(m),snapshot_id:'s'+m,truth_verdict:'TRUE',ltp:100+m,oi:1000,quote_timestamp:t(m),quote_age_seconds:0,...extra});
 const state={date,replay:{active:true,at:t(7)},current:{NIFTY:{market:[market(0),market(3),market(6),market(8)],options:[leg(0,'CE'),leg(0,'PE'),leg(3,'CE'),leg(3,'PE'),leg(6,'CE'),leg(6,'PE'),leg(8,'CE'),leg(8,'PE')],chain:[]}}};
 const read=(s:any)=>buildSharedEventTimeline(s,event,t(4)),rows=read(state);
 assert.equal(rows.find(r=>r.offset===0).ce.price,103);assert.equal(rows.find(r=>r.offset===3).pe.price,106);
 assert.equal(rows.find(r=>r.offset===5).status,'FUTURE');assert.equal(rows.find(r=>r.offset===5).ce,null);
 assert.equal(rows.find(r=>r.offset===0).fullPcr,null);
 const late={...state,current:{NIFTY:{...state.current.NIFTY,market:[market(3,t(5))]}}};assert.equal(read(late).find(r=>r.offset===0).status,'GAP');
 const duplicate={...state,current:{NIFTY:{...state.current.NIFTY,options:[...state.current.NIFTY.options,leg(3,'CE')]}}};assert.equal(read(duplicate).find(r=>r.offset===0).ce,null);
 assert.deepEqual(read({...state,replay:{active:true,at:t(3)}}),[]);
 assert.equal(read(state).find(r=>r.offset===-15).status,'OUTSIDE_SESSION');
});

test('comparison keeps two fixed strikes and two exact expiries separate, without substituting missing legs',()=>{
 const date=e.tradeDate,second='2026-12-03',market=[0,3,6].map(m=>({symbol:e.symbol,minute_bucket:t(m),created_at:t(m),truth_marker_created_at:t(m),backend_timestamp:t(m),snapshot_id:'s'+m,truth_verdict:'TRUE'}));
 const options=[e.expiry,second].flatMap(exp=>[25500,25400].flatMap(strike=>[0,3,6].flatMap(m=>['CE','PE'].filter(side=>!(exp===second&&strike===25400&&side==='PE')).map(side=>({symbol:e.symbol,expiry:exp,strike,option_type:side,minute_bucket:t(m),created_at:t(m),truth_marker_created_at:t(m),snapshot_id:'s'+m,truth_verdict:'TRUE',ltp:side==='CE'?(m===0?110:90):100,pdl:100,quote_timestamp:t(m),quote_age_seconds:0})))));
 const state={date,replay:{active:true,at:t(7)},current:{NIFTY:{market,options,chain:[]}}};
 const compare=(strike:any,expiry:any)=>buildSharedEventComparison(state,e,t(4),strike,expiry,buildSharedEventTimeline);
 const pairs=compare(25400,second);assert.equal(pairs.length,4);
 assert.deepEqual(pairs.map(p=>[p.expiry,p.strike,p.dte]),[[e.expiry,25500,2],[e.expiry,25400,2],[second,25500,9],[second,25400,9]]);
 assert.ok(pairs.every(p=>p.ceCrossing==='OBSERVED_PDL_CROSSING'));
 assert.equal(pairs[3].rows.find(r=>r.offset===0).pe,null);assert.equal(pairs[3].peCrossing,'UNAVAILABLE');
 assert.equal(pairs[0].rows.find(r=>r.offset===5).status,'FUTURE');
 assert.equal(compare(25500,e.expiry).length,1);assert.equal(compare('25400.5','2026-11-31').length,1);
 assert.equal(compare('', '2026-11-23').length,1);
});

test('generated browser script contains an executable participation projector and keeps buyer rules off the dashboard',async()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const eventParticipationContext='));
 assert.ok(script);
 assert.doesNotMatch(html,/id="mb-shared-memory-buyer"/);
 const nodes=new Map(['','-load','-status','-results','-index','-context','-context-load','-event','-timeline'].map(id=>['mb-shared-memory'+id,{innerHTML:'',textContent:'',value:'ALL'}]));
 let c:{active:boolean,date:string,at:string|null}={active:true,date,at:t(7)},calls=0;
 const ctx=vm.createContext({document:{getElementById:(id:string)=>nodes.get(id)},fetch:async()=>{calls++;return {ok:true,json:async()=>body}},AbortController,Date,Map,Set,Number,JSON});
 vm.runInContext(script!,ctx);
 const install=vm.runInContext('installSharedEventMemory',ctx),project=vm.runInContext('projectSharedEventMemory',ctx),participation=vm.runInContext('eventParticipationContext',ctx);
 const ui=install(()=>c,project,()=>({date,replay:{active:true,at:c.at},current:{}}),()=>[],undefined,undefined,()=>({dailyHistoryState:'VERIFIED_STORED_EOD',dailyHistory:[{date:'2026-11-23',fiiNetCrore:100,diiNetCrore:-20}]}),participation);
 await (nodes.get('mb-shared-memory-load') as any).onclick();
 assert.equal(calls,1);
 assert.match(nodes.get('mb-shared-memory-context')!.innerHTML,/HDFC Bank/);
 assert.match(nodes.get('mb-shared-memory-context')!.innerHTML,/100\.00/);
 c={...c,at:null};ui.render();
 assert.equal(nodes.get('mb-shared-memory-context')!.innerHTML,'');
 assert.equal((nodes.get('mb-shared-memory-context-load') as any).disabled,true);
 await (nodes.get('mb-shared-memory-context-load') as any).onclick();assert.equal(calls,1);
 c={...c,at:t(7)};ui.render();
 assert.match(nodes.get('mb-shared-memory-context')!.innerHTML,/100\.00/);assert.equal(calls,1);
 c={...c,at:t(3)};ui.render();
 assert.doesNotMatch(nodes.get('mb-shared-memory-context')!.innerHTML,/100\.00/);
});

 test('event freeze rejects rows saved after event even when present by master cursor',()=>{
 const event={...e,at:t(3)},m={symbol:e.symbol,minute_bucket:t(3),truth_verdict:'TRUE',snapshot_id:'s',backend_timestamp:t(3),created_at:t(3),truth_marker_created_at:t(3),spot_ltp:25000};
 const q=(side:string)=>({...m,expiry:e.expiry,strike:e.strike,option_type:side,quote_timestamp:t(3),quote_age_seconds:0,ltp:100});
 const state={date,replay:{active:true,at:t(7)},current:{NIFTY:{market:[m],options:[q('CE'),{...q('PE'),created_at:t(5)}],chain:[]}}};
 const eventRow=()=>buildSharedEventTimeline(state,event,t(4)).find(r=>r.offset===0);
 assert.equal(eventRow().ce.price,100);assert.equal(eventRow().pe,null);
 state.current.NIFTY.market[0]={...m,truth_marker_created_at:t(5)};assert.equal(eventRow().spot,null);
 state.current.NIFTY.market[0]={...m,created_at:undefined};assert.equal(eventRow().status,'GAP');
 });
