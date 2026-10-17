import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';
import { deriveMarketBook } from '../market-book-model.js';

const date='2026-10-08',expiry='2026-10-13',times=['2026-10-08T04:15:00Z','2026-10-08T04:18:00Z'];
function recording(symbol:string){
 return {market:times.map((minute_bucket,i)=>({symbol,minute_bucket,truth_verdict:'TRUE',spot_ltp:22000+i*10,spot_prev_close:21900,pdh:22100,pdl:21800,future_ltp:22020+i*10,future_basis:20,future_oi:1000+i*100,india_vix:12+i*.1})),
  options:times.flatMap((minute_bucket,i)=>['CE','PE'].map(option_type=>({symbol,minute_bucket,truth_verdict:'TRUE',expiry,strike:22000,option_type,ltp:option_type==='CE'?100+i*10:100-i*10,oi:1000,iv:18,pdh:120,pdl:80,dte:5}))),
  chain:times.map(minute_bucket=>({symbol,minute_bucket,truth_verdict:'TRUE',expiry,full_chain_oi_pcr:1.2345,full_pcr_source:'Exact archived full-chain source',call_wall_strike:22100,call_wall_oi:2000,put_wall_strike:21900,put_wall_oi:3000}))};
}
function harness(empty=false,patch?:(state:any)=>void){
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>();
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',attrs:{},classList:{add(){},remove(){},toggle(){}},setAttribute(k:string,v:string){this.attrs[k]=v;},offsetWidth:0});
 const current=Object.fromEntries(['NIFTY','SENSEX','BANKNIFTY'].map(s=>[s,empty?{}:recording(s)]));
 const state:any={date,recordedDates:[date],current,history:{},baseline:{},health:{},stocks:{},sectors:null,
  cash:{latestStoredSessionDate:'2026-10-07',sourceMode:'STORED',source:'TEST FIXTURE',windows:[{window:'Latest stored session',availableSessions:1,fiiNetCrore:-100,diiNetCrore:200,combinedNetCrore:100,state:'RECORDED'}]}};
 patch?.(state);const before=structuredClone(state);
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};
 vm.createContext(ctx);const first=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];vm.runInContext(first,ctx);
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){},memory:async()=>{}};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);
 const turn=(page:number)=>{nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:String(page)}})}});return nodes.get('mb-page').innerHTML as string;};
 return {html,nodes,state,before,turn};
}
const markers=['mb-overview','Recorded spot reference levels','mb-contract-grid','mb-expiry-grid','mb-futures-card','mb-positioning-card','mb-event-tiles','Detailed month board','Quote filter','mb-pcr-comparison','mb-cash-grid','ONE MARKET SERIES','mb-combined-card'];
test('all thirteen chapters render their renovated sections without mutating source records',()=>{
 const h=harness();for(let i=0;i<13;i++){const content=h.turn(i);assert.ok(content.includes(markers[i]),'chapter '+(i+1));assert.equal(h.nodes.get('mb-page').attrs['data-chapter'],String(i+1));assert.match(content,/CHAPTER/);assert.ok(!content.includes('NaN'));assert.ok(!content.includes('undefined'));}
 assert.deepEqual(h.state,h.before);
});
test('empty recorded sessions render every chapter without inventing observations',()=>{
 const h=harness(true);for(let i=0;i<13;i++){const content=h.turn(i);assert.ok(!content.includes('NaN'));assert.ok(!content.includes('undefined'),'chapter '+(i+1)+' '+content.slice(Math.max(0,content.indexOf('undefined')-80),content.indexOf('undefined')+80));assert.ok(!content.includes('22,010'));}
 assert.match(h.turn(0),/NO RECORDING/);
});
test('overview preserves independent contract identities and missing values, including a real zero PCR',()=>{
 const h=harness(false,s=>{s.current.NIFTY.chain.at(-1).full_chain_oi_pcr=0;s.current.NIFTY.options.filter((x:any)=>x.option_type==='PE').forEach((x:any)=>x.expiry='2026-10-19');});
 h.nodes.get('mb-opposite').value='2026-10-19';h.nodes.get('mb-opposite').onchange();
 const content=h.turn(0);assert.match(content,/2026-10-13/);assert.match(content,/2026-10-19/);assert.match(content,/Recorded full PCR<\/span><strong>0<\/strong>/);assert.match(content,/endpoint match unverified/);
 const bad=harness(false,s=>{s.current.NIFTY.chain.forEach((x:any)=>x.full_pcr_source='UNVERIFIED');});
 const nifty=bad.turn(0).split('NIFTY recorded overview')[1].split('SENSEX recorded overview')[0];assert.ok(!nifty.includes('1.2345'));assert.match(nifty,/Recorded full PCR<\/span><strong>—<\/strong>/);
});
test('cash dates remain separate, and VIX is presented as one underlying series',()=>{
 const h=harness(),cash=h.turn(10);assert.match(cash,/STORED EOD · 2026-10-07/);assert.match(cash,/selected market session 2026-10-08/);assert.match(cash,/FII net · ₹ crore/);
 const vix=h.turn(11);assert.equal((vix.match(/ONE MARKET SERIES/g)||[]).length,1);assert.match(vix,/Compare VIX recordings/);assert.match(vix,/Same VIX series/);
});
test('VIX chart points are exact qualified observations, preserving null samples and source times',()=>{
 const current=recording('NIFTY');current.market[0].india_vix=null as any;
 const model=deriveMarketBook({current,symbol:'NIFTY',tradeDate:date,recordedDates:[date],window:'3m'} as any);
 assert.deepEqual(model.vix.points,[{at:times[0],value:null},{at:times[1],value:12.1}]);
});
test('optional premium filters are collapsed, with always-visible watch identity and all existing control IDs',()=>{
 const h=harness();assert.match(h.html,/<details id="pw-filter-settings" class="pw-filter-settings">/);assert.ok(!h.html.includes('id="pw-filter-settings" open'));
 for(const id of ['pw-active-filters','pw-symbol','pw-ceStrike','pw-peStrike','pw-minutes','pw-expiries','pw-layout','seller-research-panel'])assert.equal((h.html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 assert.match(h.turn(0),/<details class="mb-guide-shell"/);
});
