import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderRecordedDashboard } from '../recorded-dashboard-view.js';

async function until(check:()=>boolean){for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}throw new Error('VIEW_WAIT_TIMEOUT');}
async function view(){
 const elements=new Map<string,any>(),timers=new Map<number,any>(),requests:string[]=[];let next=0;
 for(const [,id] of renderRecordedDashboard().matchAll(/id="([^"]+)"/g))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,selectedOptions:[]});
 elements.get('ar-index').value='NIFTY';elements.get('ar-speed').value='1';
 const dates=['2026-10-28','2026-10-29','2026-10-30'];
 const context:any={console,AbortController,AbortSignal,URLSearchParams,document:{getElementById:(id:string)=>elements.get(id),addEventListener(){}},window:{addEventListener(){}},setTimeout(fn:any,ms:number){timers.set(++next,{fn,ms});return next;},clearTimeout(id:number){timers.delete(id);},
  fetch:async(url:string)=>{requests.push(url);if(url.endsWith('/dates'))return {ok:true,json:async()=>({ok:true,dates:dates.map(tradeDate=>({symbol:'NIFTY',tradeDate,markerCount:2}))})};
   const params=new URLSearchParams(url.split('?')[1]),date=params.get('date'),from=params.get('from'),to=params.get('to');
   const time=from==='09:15'?'09:15':to==='15:40'?'15:30':null;
   const row=time?{symbol:'NIFTY',minute_bucket:date+'T'+time+':00+05:30',truth_verdict:'TRUE',spot_ltp:time==='09:15'?23000:23100,future_ltp:23120,india_vix:12}:null;
   const opts=row?['CE','PE'].map(option_type=>({...row,expiry:date!<'2026-10-30'?'2026-10-29':'2026-11-02',strike:23000,option_type,ltp:100,oi:'30000000',pdh:110,pdl:90})):[];
   const compact=(rows:any[])=>{const columns=Object.keys(rows[0]||{});return {columns,rows:rows.map(row=>columns.map(key=>row[key]))};};
   return {ok:true,json:async()=>({ok:true,market:compact(row?[row]:[]),options:compact(opts),chain:compact([])})};}};
 vm.createContext(context);const script=[...renderRecordedDashboard().matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];vm.runInContext(script,context);
 await until(()=>elements.get('clock').textContent.includes('15:30:00')).catch(error=>{throw new Error(error.message+' '+elements.get('error').textContent+' '+elements.get('clock').textContent+' '+elements.get('progress').textContent);});
 return {elements,timers,requests,async tick(){const entry=[...timers].find(([,v])=>v.ms<10000);assert(entry);timers.delete(entry[0]);entry[1].fn();await new Promise(resolve=>setImmediate(resolve));}};
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
