import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderRecordedDashboard } from '../recorded-dashboard-view.js';

async function until(check:()=>boolean){for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}throw new Error('VIEW_WAIT_TIMEOUT');}
async function view(close='15:30'){
 const elements=new Map<string,any>(),timers=new Map<number,any>(),requests:string[]=[];let next=0;const events:any[]=[];
 for(const [,id] of renderRecordedDashboard().matchAll(/id="([^"]+)"/g))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,selectedOptions:[]});
 elements.get('ar-index').value='NIFTY';elements.get('ar-speed').value='1';elements.get('ar-60-index').value='CURRENT';elements.get('ar-60-side').value='BOTH';elements.get('ar-60-direction').value='BOTH';
 const dates=['2026-10-28','2026-10-29','2026-10-30'];
 const context:any={console,AbortController,AbortSignal,URLSearchParams,document:{getElementById:(id:string)=>elements.get(id),addEventListener(){}},CustomEvent:class{constructor(public type:string,public options:any){}get detail(){return this.options.detail;}},window:{addEventListener(){},dispatchEvent:(event:any)=>events.push(event)},setTimeout(this:any,fn:any,ms:number){if(this?.render)throw new TypeError('Illegal invocation: native Window timer rebound to playback API');timers.set(++next,{fn,ms});return next;},clearTimeout(this:any,id:number){if(this?.render)throw new TypeError('Illegal invocation: native Window timer rebound to playback API');timers.delete(id);},
  fetch:async(url:string)=>{requests.push(url);if(url.endsWith('/dates'))return {ok:true,json:async()=>({ok:true,dates:['NIFTY','SENSEX','BANKNIFTY'].flatMap(symbol=>dates.map(tradeDate=>({symbol,tradeDate,markerCount:2})))})};
   const params=new URLSearchParams(url.split('?')[1]),date=params.get('date'),from=params.get('from'),to=params.get('to');
   const time=from==='09:15'?'09:15':to==='15:40'?close:null;
   const row=time?{symbol:params.get('symbol')||'NIFTY',minute_bucket:date+'T'+time+':00+05:30',truth_verdict:'TRUE',snapshot_id:'snap_'+time,backend_timestamp:date+'T'+time+':24+05:30',spot_ltp:time==='09:15'?23000:23100,future_ltp:23120,india_vix:12}:null;
   const opts=row?['CE','PE'].map(option_type=>({...row,expiry:date!<'2026-10-30'?'2026-10-29':'2026-11-02',strike:23000,option_type,ltp:option_type==='CE'&&time!=='09:15'?170:100,quote_timestamp:date+'T'+time+':10+05:30',oi:'30000000',pdh:110,pdl:90})):[];
   const compact=(rows:any[])=>{const columns=Object.keys(rows[0]||{});return {columns,rows:rows.map(row=>columns.map(key=>row[key]))};};
   return {ok:true,json:async()=>({ok:true,market:compact(row?[row]:[]),options:compact(opts),chain:compact([])})};}};
 vm.createContext(context);const script=[...renderRecordedDashboard().matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];vm.runInContext(script,context);
 await until(()=>elements.get('clock').textContent.includes(close+':00')).catch(error=>{throw new Error(error.message+' '+elements.get('error').textContent+' '+elements.get('clock').textContent+' '+elements.get('progress').textContent);});
 return {elements,timers,requests,events,async tick(){const entry=[...timers].find(([,v])=>v.ms<10000);assert(entry);timers.delete(entry[0]);entry[1].fn();await new Promise(resolve=>setImmediate(resolve));}};
}
test('page opens on latest saved closing samples and converts stored BIGINT OI for the CE/PE ladder',async()=>{
 const h=await view();assert.match(h.elements.get('clock').textContent,/2026-10-30.*SAVED/);assert.match(h.elements.get('ar-metrics').innerHTML,/23,100/);assert.match(h.elements.get('ar-ladder').innerHTML,/3,00,00,000/);assert.equal(h.elements.get('ar-play').disabled,false);assert.equal(h.requests.filter(v=>v.includes('/replay?')).length,7);
});
test('Last 3 days is one click: starts first day, advances to next, and Pause freezes playback',async()=>{
 const h=await view();h.elements.get('ar-last3').onclick();await until(()=>h.elements.get('clock').textContent.includes('2026-10-28 · 09:15'));
 assert.match(h.elements.get('queue').textContent,/Day 1 \/ 3/);await h.tick();assert.match(h.elements.get('clock').textContent,/15:30:00/);await h.tick();await until(()=>h.elements.get('clock').textContent.includes('2026-10-29 · 09:15'));
 assert.match(h.elements.get('queue').textContent,/Day 2 \/ 3/);h.elements.get('ar-play').onclick();assert.match(h.elements.get('clock').textContent,/SAVED \/ PAUSED/);assert.equal(h.timers.size,0);
});

test('session ATM uses each day own expiry while explicit Same contract mode never borrows it',async()=>{
 const h=await view();h.elements.get('ar-last3').onclick();await until(()=>h.elements.get('clock').textContent.includes('2026-10-28 · 09:15'));
 assert.match(h.elements.get('ar-contract').textContent,/2026-10-29/);
 await h.tick();await h.tick();await until(()=>h.elements.get('clock').textContent.includes('2026-10-29 · 09:15'));
 await h.tick();await h.tick();await until(()=>h.elements.get('clock').textContent.includes('2026-10-30 · 09:15'));
 assert.match(h.elements.get('ar-contract').textContent,/2026-11-02/);h.elements.get('ar-play').onclick();
 h.elements.get('ar-contract-mode').value='PINNED';h.elements.get('ar-contract-mode').onchange();h.elements.get('ar-last3').onclick();await until(()=>h.elements.get('clock').textContent.includes('2026-10-28 · 09:15'));
 assert.match(h.elements.get('ar-contract').textContent,/2026-11-02/);assert.match(h.elements.get('ar-ladder').innerHTML,/No saved strikes/);
});

test('recorded row opens exact cursor evidence, pauses replay and invalidates on cursor change',async()=>{
 const h=await view();assert.match(h.elements.get('ar-ladder').innerHTML,/data-ar-evidence="23000\|CE"/);
 h.elements.get('ar-play').onclick();h.elements.get('ar-ladder').onclick({target:{closest:()=>({dataset:{arEvidence:'23000|CE'}})}});
 const request=h.events.filter(e=>e.type==='optionpilot:rag-selection').at(-1);assert.ok(request);
 assert.equal(JSON.stringify(request.detail),JSON.stringify({symbol:'NIFTY',date:'2026-10-30',expiry:'2026-11-02',strike:23000,side:'CE',time:'09:15',lookback:3}));
 assert.match(h.elements.get('clock').textContent,/PAUSED/);
 const before=h.events.filter(e=>e.type==='optionpilot:rag-invalidate').length;h.elements.get('ar-next').onclick();assert(h.events.filter(e=>e.type==='optionpilot:rag-invalidate').length>before);
 const count=h.events.filter(e=>e.type==='optionpilot:rag-selection').length;h.elements.get('ar-ladder').onclick({target:{closest:()=>({dataset:{arEvidence:'99999|CE'}})}});assert.equal(h.events.filter(e=>e.type==='optionpilot:rag-selection').length,count);
});

test('post-window saved samples remain visible without a nonfunctional Evidence action',async()=>{
 const h=await view('15:40');assert.match(h.elements.get('ar-ladder').innerHTML,/23,000/);assert.doesNotMatch(h.elements.get('ar-ladder').innerHTML,/data-ar-evidence=/);assert.match(h.elements.get('ar-ladder').innerHTML,/Evidence 09:15–15:30 IST/);
 const count=h.events.filter(e=>e.type==='optionpilot:rag-selection').length;h.elements.get('ar-ladder').onclick({target:{closest:()=>({dataset:{arEvidence:'23000|CE'}})}});assert.equal(h.events.filter(e=>e.type==='optionpilot:rag-selection').length,count);
});

test('same-dashboard all-recorded finder reports verified sampled 60-point CE movement with RAG action',async()=>{
 const h=await view();
 assert.match(renderRecordedDashboard(),/id="ar-60-week"/);
 assert.match(renderRecordedDashboard(),/id="ar-60-all"/);
 h.elements.get('ar-60-all').onclick();
 await until(()=>h.elements.get('ar-60-status').textContent.includes('Completed 3 / 3'));
 assert.match(h.elements.get('ar-60-results').innerHTML,/₹70/);
 assert.match(h.elements.get('ar-60-results').innerHTML,/Gap/);
 assert.match(h.elements.get('ar-60-coverage').textContent,/ATM ±7/);
 const old=h.events.length;
 h.elements.get('ar-60-results').onclick({target:{closest:()=>({dataset:{arSixtyEvidence:'0'}})}});
 assert.ok(h.events.length>old);
 assert.equal(h.events.at(-1).type,'optionpilot:rag-selection');
});
test('scan can be cancelled and index change invalidates old result identity',async()=>{
 const h=await view();
 h.elements.get('ar-60-all').onclick();
 h.elements.get('ar-60-cancel').onclick();
 assert.match(h.elements.get('ar-60-status').textContent,/cancelled/);
 h.elements.get('ar-index').value='SENSEX';
 h.elements.get('ar-index').onchange();
 assert.equal(h.elements.get('ar-60-results').innerHTML,'');
});

test('optional all-three-index scan reads exact recorded sessions sequentially, without cross-index stitching',async()=>{
 const h=await view();
 h.elements.get('ar-60-index').value='ALL';
 h.elements.get('ar-60-index').onchange();
 h.elements.get('ar-60-all').onclick();
 await until(()=>h.elements.get('ar-60-status').textContent.includes('Completed 9 / 9'));
 assert.match(h.elements.get('ar-60-status').textContent,/NIFTY \+ SENSEX \+ BANKNIFTY/);
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])assert.match(h.elements.get('ar-60-results').innerHTML,new RegExp(index));
 assert.match(h.elements.get('ar-60-coverage').textContent,/9 completed days/);
 const calls=h.requests.filter(x=>x.includes('/recorded-dashboard/replay?'));
 const seen=[...new Set(calls.map(x=>new URLSearchParams(x.split('?')[1]).get('symbol')))].sort();
 assert.equal(JSON.stringify(seen),JSON.stringify(['BANKNIFTY','NIFTY','SENSEX']));
});

test('full-session premium remains on the same page, follows shared seek and changes display without loading data',async()=>{
 const h=await view(),panel=h.elements.get('ar-premium-output');
 assert.match(panel.innerHTML,/09:15–15:40/);assert.match(panel.innerHTML,/OHLC unavailable/);
 assert.match(panel.innerHTML,/15:30 IST/);
 const calls=h.requests.length;
 h.elements.get('ar-premium-interval').value='15';h.elements.get('ar-premium-interval').onchange();
 assert.match(panel.innerHTML,/15m sampled line/);assert.equal(h.requests.length,calls);
 h.elements.get('ar-reset').onclick();assert.doesNotMatch(panel.innerHTML,/15:30 IST/);
 assert.match(panel.innerHTML,/09:15 IST/);
 h.elements.get('ar-premium-scope').value='SELECTED';h.elements.get('ar-premium-scope').onchange();
 assert.equal(h.requests.length,calls);
});

test('ranked OI ladder uses same recorded clock, labels snapshot OI and handles missing opening without extra reads',async()=>{
 const h=await view(),panel=h.elements.get('ar-oi-output');
 assert.match(panel.innerHTML,/OI ranked CE PE ladder/);assert.match(panel.innerHTML,/publication time unavailable/);
 const calls=h.requests.length;h.elements.get('ar-oi-window').value='OPEN';h.elements.get('ar-oi-window').onchange();
 assert.match(panel.innerHTML,/09:15 baseline/);assert.match(panel.innerHTML,/exact comparisons/);
 h.elements.get('ar-oi-focus').value='SHED';h.elements.get('ar-oi-focus').onchange();assert.match(panel.innerHTML,/Top shedding/);
 assert.equal(h.requests.length,calls);h.elements.get('ar-reset').onclick();assert.doesNotMatch(panel.innerHTML,/15:30:10/);
});
