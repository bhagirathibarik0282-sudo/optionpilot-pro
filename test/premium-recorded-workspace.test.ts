import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PREMIUM_WORKSPACE_HTML, installPremiumWorkspace } from '../premium-workspace-view.js';
import { derivePremiumWorkspace, premiumLiveClock, projectLivePremiumQuote, derivePremiumLiveContext } from '../premium-workspace-model.js';

function harness(){
 const nodes=new Map<string,any>(),events:any[]=[],timers:Function[]=[],calls:any[]=[];
 for(const [,id] of PREMIUM_WORKSPACE_HTML.matchAll(/id="([^"]+)"/g))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,options:[],scrollLeft:0,querySelectorAll:()=>[],scrollIntoView(){},setAttribute(){}});
 let state:any={date:'2026-10-17',scope:'CORE',recordedDates:['2026-10-12','2026-10-13','2026-10-16'],current:{},baseline:{},loading:false};
 const row=(t:string,ltp:number,option_type='CE')=>({symbol:'NIFTY',expiry:'2026-10-19',strike:22000,option_type,minute_bucket:'2026-10-13T'+t+':00.000Z',quote_timestamp:'2026-10-13T'+t+':22.000Z',truth_verdict:'TRUE',ltp,pdh:110,pdl:90,oi:200,day_high:120,day_low:80});
 const data={market:[{minute_bucket:'2026-10-13T04:00:00.000Z',spot_ltp:22000}],options:[row('04:00',100),row('04:03',105),row('04:06',111),row('04:00',150,'PE'),row('04:03',145,'PE'),row('04:06',140,'PE')]};
 const api={getState:()=>state,setDate:async(date:string,options:any)=>{calls.push({date,options});state={...state,date,scope:options.scope,current:date==='2026-10-13'?{NIFTY:data}:{}};}};
 const context=vm.createContext({__name:(fn:Function)=>fn,document:{getElementById:(id:string)=>nodes.get(id),querySelectorAll:()=>[],activeElement:null,hidden:false,addEventListener(){}},window:{addEventListener(){},dispatchEvent:(event:any)=>{events.push(event);}},localStorage:{getItem:()=>null,setItem(){}},Date,AbortController,URLSearchParams,CustomEvent:class{constructor(public type:string,public init:any={}){}get detail(){return this.init.detail;}},setInterval:(fn:Function)=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({connected:false,serverTime:new Date().toISOString(),snapshot:null})}),derivePremiumWorkspace,premiumLiveClock,projectLivePremiumQuote,derivePremiumLiveContext,api});
 vm.runInContext('globalThis.view=('+installPremiumWorkspace.toString()+')(api);',context);
 const node=(id:string)=>nodes.get(id),click=(id:string,dataset:any={})=>node('op-premium-workspace').onclick({target:{closest:()=>({id,dataset})}}),change=(id:string,value:string)=>node('op-premium-workspace').onchange({target:{id,value}});
 return {node,events,timers,calls,click,change,view:context.view,state:()=>state};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
test('Recorded falls back to latest saved date, offers every session and loads FULL once',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].date,'2026-10-16');assert.equal(h.calls[0].options.scope,'FULL');assert.equal(h.calls[0].options.fullSession,true);
 for(const date of ['2026-10-12','2026-10-13','2026-10-16'])assert(h.node('pw-date').innerHTML.includes(date));
 h.view.refreshRecorded();await settle();assert.equal(h.calls.length,1,'no retry loop on empty archive');
 h.change('pw-date','2026-10-13');await settle();assert.equal(h.calls.at(-1).date,'2026-10-13');assert.match(h.node('pw-results').innerHTML,/Ask RAG/);
});
test('timeline watch removes later rows; Ask RAG carries exact contract/time/window and rows remain inspectable',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 const key='NIFTY|2026-10-19|22000|CE';h.change('pw-at','2026-10-13T04:03:00.000Z');h.click('',{pwRecords:key});
 assert.match(h.node('pw-records').innerHTML,/2 source rows/);assert.doesNotMatch(h.node('pw-records').innerHTML,/09:36:00/);assert.match(h.node('pw-records').innerHTML,/09:33:22/);
 h.change('pw-minutes','15');h.click('',{pwRag:key});const event=h.events.findLast((e:any)=>e.type==='optionpilot:rag-selection');
 assert.deepEqual(JSON.parse(JSON.stringify(event.detail)),{symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-19',strike:'22000',side:'CE',time:'09:33',kind:'SNAPSHOT',lookback:'15'});
 assert.equal(h.node('pw-results').innerHTML.includes('₹111'),false,'no later premium at the chosen watch time');
 assert(h.events.some((e:any)=>e.type==='optionpilot:rag-invalidate'));h.change('pw-date','2026-10-12');await settle();assert.match(h.node('pw-records').textContent,/Choose Rows/);
});
test('recorded playback advances only saved buckets and stops at the last one',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 h.click('pw-play');assert.match(h.node('pw-time-label').textContent,/09:30/);h.timers[0]();assert.match(h.node('pw-time-label').textContent,/09:33/);h.timers[0]();assert.match(h.node('pw-time-label').textContent,/09:36/);h.timers[0]();assert.equal(h.node('pw-play').textContent,'▶ Replay');
});
