import { installMarketInvestigation } from '../market-investigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {deriveLiveThreeIndexPcr,deriveRecordedThreeIndexPcr} from '../live-three-index-pcr.js';
import { PREMIUM_WORKSPACE_HTML, installPremiumWorkspace } from '../premium-workspace-view.js';
import { derivePremiumDeltaPair, derivePremiumWorkspace, premiumLiveClock, projectLivePremiumQuote, derivePremiumLiveContext } from '../premium-workspace-model.js';

function harness(saved:any=null){
 let stored=saved?JSON.stringify(saved):null;const requests:string[]=[];
 const nodes=new Map<string,any>(),events:any[]=[],timers:Function[]=[],calls:any[]=[];
 for(const [,id] of PREMIUM_WORKSPACE_HTML.matchAll(/id="([^"]+)"/g))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,options:[],scrollLeft:0,querySelectorAll:()=>[],scrollIntoView(){},setAttribute(){}});
 let state:any={date:'2026-10-17',scope:'CORE',recordedDates:['2026-10-12','2026-10-13','2026-10-16'],current:{},baseline:{},loading:false};
 const row=(t:string,ltp:number,option_type='CE')=>({symbol:'NIFTY',expiry:'2026-10-19',strike:22000,option_type,minute_bucket:'2026-10-13T'+t+':00.000Z',quote_timestamp:'2026-10-13T'+t+':22.000Z',truth_verdict:'TRUE',ltp,pdh:110,pdl:90,oi:200,pdc:100,day_high:120,day_low:80});
 const data={market:[{minute_bucket:'2026-10-13T04:00:00.000Z',spot_ltp:22000}],options:[row('04:00',100),row('04:03',105),row('04:06',111),row('04:00',150,'PE'),row('04:03',145,'PE'),row('04:06',140,'PE')]};
 const api={getState:()=>state,setDate:async(date:string,options:any)=>{calls.push({date,options});state={...state,date,scope:options.scope,current:date==='2026-10-13'?{NIFTY:data}:{}};}};
 const context=vm.createContext({__name:(fn:Function)=>fn,document:{getElementById:(id:string)=>nodes.get(id),querySelectorAll:()=>[],activeElement:null,hidden:false,addEventListener(){}},window:{addEventListener(){},dispatchEvent:(event:any)=>{events.push(event);}},localStorage:{getItem:()=>stored,setItem(_key:string,value:string){stored=value;}},Date,AbortController,URLSearchParams,CustomEvent:class{constructor(public type:string,public init:any={}){}get detail(){return this.init.detail;}},setInterval:(fn:Function)=>{timers.push(fn);return timers.length;},clearInterval(){},setTimeout,clearTimeout,fetch:async(url:string)=>{requests.push(url);return {ok:true,json:async()=>({connected:false,serverTime:new Date().toISOString(),snapshot:null})};},installMarketInvestigation,derivePremiumDeltaPair,derivePremiumWorkspace,premiumLiveClock,projectLivePremiumQuote,derivePremiumLiveContext,deriveLiveThreeIndexPcr,deriveRecordedThreeIndexPcr,api});
 vm.runInContext('globalThis.view=('+installPremiumWorkspace.toString()+')(api);',context);
 const node=(id:string)=>nodes.get(id),click=(id:string,dataset:any={})=>node('op-premium-workspace').onclick({target:{closest:()=>({id,dataset})}}),change=(id:string,value:string)=>node('op-premium-workspace').onchange({target:{id,value}});
 return {node,events,timers,calls,requests,stored:()=>JSON.parse(stored||'{}'),click,change,view:context.view,state:()=>state};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
test('exact watch survives cursor/date changes, blocks identity edits, and never substitutes missing data',async()=>{
 const h=harness(),key='NIFTY|2026-10-19|22000|CE';h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 h.click('',{pwLock:'NIFTY|2026-10-19|99999|CE'});assert.equal(h.stored().watch,undefined,'cannot lock an absent row');
 assert.match(h.node('pw-results').innerHTML,/Lock watch/);h.click('',{pwLock:key});
 assert.equal(h.stored().watch,key);assert.equal(h.node('pw-watch').hidden,false);assert.match(h.node('pw-watch').innerHTML,/NIFTY · 2026-10-19 · 22000 · CE/);
 assert.equal(h.node('pw-symbol').disabled,true);assert.equal(h.node('pw-minutes').disabled,false);
 h.change('pw-symbol','SENSEX');h.change('pw-side','PE');h.change('pw-ceStrike','23000');h.click('',{pwExpiry:'2026-10-27'});
 assert.equal(h.node('pw-symbol').value,'NIFTY');assert.equal(h.node('pw-side').value,'CE');assert.equal(h.node('pw-ceStrike').value,'22000');
 assert.match(h.node('pw-results').innerHTML,/22,000 CE/);assert.doesNotMatch(h.node('pw-results').innerHTML,/22,000 PE/);
 h.change('pw-at','2026-10-13T04:03:00.000Z');assert.doesNotMatch(h.node('pw-results').innerHTML,/₹111/);
 h.change('pw-date','2026-10-12');await settle();assert.match(h.node('pw-results').innerHTML,/Locked contract unavailable/);assert.equal(h.stored().watch,key);
 h.change('pw-date','2026-10-13');await settle();assert.match(h.node('pw-results').innerHTML,/22,000 CE/);
 h.click('pw-unlock');assert.equal(h.stored().watch,undefined);assert.equal(h.node('pw-symbol').disabled,false);
 h.click('pw-reset');assert.equal(h.node('pw-watch').hidden,true);
});
test('restored exact watch constrains live requests, stays visible when disconnected and unlocks explicitly',async()=>{
 const key='SENSEX|2026-10-22|74700|PE',h=harness({watch:key});h.view.setVisible(true);await settle();await settle();
 const q=new URL(h.requests[0],'https://example.test').searchParams;
 assert.equal(q.get('symbol'),'SENSEX');assert.equal(q.get('side'),'PE');assert.equal(q.get('expiries'),'2026-10-22');assert.equal(q.get('peStrike'),'74700');
 assert.equal(q.has('nearby'),false);assert.match(h.node('pw-watch').innerHTML,/SENSEX/);assert.match(h.node('pw-results').innerHTML,/Locked contract unavailable/);
 h.click('pw-unlock');assert.equal(h.node('pw-watch').hidden,true);
 for(const watch of ['NIFTY|2026-02-30|22000|CE','NIFTY|2026-10-19|0|CE','NIFTY|2026-10-19|22000|CE|extra','<img>|2026-10-19|22000|CE']){
  const bad=harness({watch});bad.view.setVisible(true);assert.equal(bad.node('pw-watch').hidden,true);
 }
});
test('paired layout keeps exact index/expiry/strike identity and independent missing sides/times',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();h.change('pw-layout','ladder');
 let html=h.node('pw-results').innerHTML;assert.equal((html.match(/pw-pair-grid/g)||[]).length,1);assert.match(html,/₹111/);assert.match(html,/₹140/);assert.doesNotMatch(html,/Contract unavailable/);
 assert.match(html,/All selected loaded contracts/);assert.match(html,/data-pw-lock="NIFTY\|2026-10-19\|22000\|PE"/);
 const data=h.state().current.NIFTY;data.options=data.options.filter((r:any)=>r.option_type==='CE'||r.minute_bucket==='2026-10-13T04:03:00.000Z');h.change('pw-layout','ladder');
 assert.match(h.node('pw-results').innerHTML,/CE \/ PE quote times differ/);
 for(const row of data.options)if(row.option_type==='PE')row.expiry='2026-10-27';h.change('pw-layout','ladder');html=h.node('pw-results').innerHTML;
 assert.equal((html.match(/pw-pair-grid/g)||[]).length,2);assert.equal((html.match(/Contract unavailable/g)||[]).length,2);
 h.state().current.SENSEX={market:data.market,options:data.options.filter((r:any)=>r.option_type==='CE').map((r:any)=>({...r,symbol:'SENSEX'}))};h.change('pw-symbol','ALL');h.change('pw-layout','ladder');
 assert.equal((h.node('pw-results').innerHTML.match(/pw-pair-grid/g)||[]).length,3);
 h.click('',{pwLock:'NIFTY|2026-10-19|22000|CE'});assert.match(h.node('pw-results').innerHTML,/Side filtered/);assert.equal((h.node('pw-results').innerHTML.match(/pw-pair-grid/g)||[]).length,1);
});
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
test('existing filters expose exact expiry/DTE and loaded identity counts without an expanded new card',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 assert.match(h.node('pw-expiries').innerHTML,/2026-10-19 · DTE 6/);assert.match(h.node('pw-series-inventory').innerHTML,/NIFTY \/ 2026-10-19/);
 assert.match(h.node('pw-series-inventory').innerHTML,/1 \/ 1/);assert.match(h.node('pw-series-inventory').innerHTML,/not fresh-quote coverage/);
 assert.ok(PREMIUM_WORKSPACE_HTML.includes('<details id="pw-series-details">'));assert.ok(PREMIUM_WORKSPACE_HTML.includes('ATM ±3 · up to 7 strikes'));
});
test('a missing fixed strike remains visible and cannot silently become an ATM watch',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 h.change('pw-ceStrike','99999');assert.match(h.node('pw-ceStrike').innerHTML,/Fixed 99999 · not loaded/);assert.equal(h.node('pw-ceStrike').value,'99999');
 assert.match(h.node('pw-active-filters').textContent,/CE fixed 99999/);assert.match(h.node('pw-series-inventory').innerHTML,/Fixed 99999 · not loaded/);
 assert.doesNotMatch(h.node('pw-results').innerHTML,/22,000 CE/);assert.match(h.node('pw-results').innerHTML,/22,000 PE/);
 h.click('',{pwExpiry:'2026-10-19'});assert.equal(h.node('pw-ceStrike').value,'99999');
});
test('series coverage follows the recorded cursor and cannot leak a later expiry',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 h.state().current.NIFTY.options.push({...h.state().current.NIFTY.options[0],expiry:'2026-10-27',minute_bucket:'2026-10-13T04:06:00.000Z'});
 h.change('pw-at','2026-10-13T04:03:00.000Z');assert.doesNotMatch(h.node('pw-series-inventory').innerHTML,/2026-10-27/);
 h.change('pw-at','2026-10-13T04:06:00.000Z');assert.match(h.node('pw-series-inventory').innerHTML,/2026-10-27/);
});

test('compact ladder quick controls use exact DTE and switch displayed parameters',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 h.click('',{pwLayout:'ladder'});assert.equal(h.node('pw-chain-top').hidden,false);assert.match(h.node('pw-chain-dtes').innerHTML,/data-pw-dte="1"[^>]*disabled/);assert.match(h.node('pw-results').innerHTML,/<th scope="col">CE ₹<\/th>/);assert.match(h.node('pw-results').innerHTML,/<th scope="col">STRIKE<\/th>/);
 h.click('',{pwMetric:'delta'});assert.match(h.node('pw-results').innerHTML,/<span>Delta<\/span>/);
 h.click('',{pwDte:'1'});assert.match(h.node('pw-results').innerHTML,/No premiums match/,'DTE1 must never substitute the DTE6 contract');
 h.click('',{pwDte:'ALL'});assert.match(h.node('pw-results').innerHTML,/₹111/);
 h.change('pw-chain-symbol','SENSEX');assert.equal(h.node('pw-symbol').value,'SENSEX');assert.doesNotMatch(h.node('pw-results').innerHTML,/₹111/);
});
test('OI ladder entry reuses the premium workspace and exact watch remains locked',async()=>{
 const h=harness();h.view.setVisible(true);h.view.openLadder({source:'RECORDED',symbol:'NIFTY'});await settle();h.change('pw-date','2026-10-13');await settle();assert.match(h.node('pw-results').innerHTML,/pw-chain-table/);
 h.click('',{pwLock:'NIFTY|2026-10-19|22000|CE'});h.view.openLadder({source:'RECORDED',symbol:'SENSEX'});assert.equal(h.node('pw-symbol').value,'NIFTY');assert.equal(h.stored().watch,'NIFTY|2026-10-19|22000|CE');
});

test('recorded bigint OI and volume render as counts without accepting unsafe or malformed values',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 for(const r of h.state().current.NIFTY.options){r.oi='7215260';r.volume='12345';}
 h.click('',{pwLayout:'ladder'});assert.match(h.node('pw-results').innerHTML,/72.15/);assert.match(h.node('pw-results').innerHTML,/<span>OI \(L\)<\/span><b>72.1526/);
 h.click('',{pwMetric:'volume'});assert.match(h.node('pw-results').innerHTML,/12,345/);
 for(const bad of ['',' 12','1e6','-1','9007199254740992','NaN']){
  for(const r of h.state().current.NIFTY.options){r.oi=bad;r.volume=bad;}
  h.change('pw-minutes','3');assert.match(h.node('pw-results').innerHTML,/<span>OI \(L\)<\/span><b>—/);
 }
});

test('ladder previous-day switch shows exact PDC and missing FIB never invents holding',async()=>{
 const h=harness();h.view.setVisible(true);h.view.openLadder({source:'RECORDED',symbol:'NIFTY'});await settle();h.change('pw-date','2026-10-13');await settle();
 assert.match(h.node('pw-results').innerHTML,/data-pw-level="PDH"/);assert.match(h.node('pw-results').innerHTML,/PDC <b>₹100/);assert.match(h.node('pw-results').innerHTML,/data-pw-level="PDL"/);
 h.click('',{pwMetric:'fib'});assert.match(h.node('pw-results').innerHTML,/Daily FIB/);assert.doesNotMatch(h.node('pw-results').innerHTML,/data-pw-position/);
});

test('FIB ladder colours only observed price position and preserves missing prior-contract data',async()=>{
 const h=harness();h.view.setVisible(true);h.view.openLadder({source:'RECORDED',symbol:'NIFTY'});await settle();h.change('pw-date','2026-10-13');await settle();
 h.state().baseline.NIFTY={options:[{symbol:'NIFTY',expiry:'2026-10-19',strike:22000,option_type:'CE',truth_verdict:'TRUE',minute_bucket:'2026-10-12T10:00:00.000Z',day_high:120,day_low:80,ltp:100}]};
 h.click('',{pwMetric:'fib'});const html=h.node('pw-results').innerHTML;assert.match(html,/data-pw-position="BELOW"/);assert.match(html,/R1 · BELOW/);assert.match(html,/HOLD unconfirmed/);assert.equal((html.match(/data-pw-position=/g)||[]).length,1,'PE cannot borrow CE levels');
});

test('mixed ladder metrics stay under each price, selected ATM ±7 displays all 15 strikes without pages',async()=>{
 const h=harness();h.view.setVisible(true);h.view.openLadder({source:'RECORDED',symbol:'NIFTY'});await settle();h.change('pw-date','2026-10-13');await settle();
 const input=h.state().current.NIFTY,template=input.options[0];input.options=[];
 for(let i=-7;i<=7;i++)for(const side of ['CE','PE'])input.options.push({...template,strike:22000+i*50,option_type:side,ltp:100+i,volume:1234,bid:99,ask:101});
 h.change('pw-chain-range','15');h.click('',{pwMetric:'volume'});h.click('',{pwMetric:'bid'});h.click('',{pwMetric:'ask'});h.click('',{pwMetric:'spread'});
 const html=h.node('pw-results').innerHTML;assert.equal((html.match(/class="pw-pair-grid"/g)||[]).length,15);assert.equal((html.match(/class="pw-chain-price"/g)||[]).length,30);assert.equal(h.node('pw-pagination').hidden,true);
 assert.match(html,/pw-chain-price[\s\S]*pw-chain-facts[\s\S]*Volume/);assert.match(html,/<span>Spread ₹<\/span><b>2/);assert.match(html,/data-pw-level="PDH"/);assert.match(html,/data-pw-level="PDL"/);
 h.click('',{pwMetric:'volume'});assert.doesNotMatch(h.node('pw-results').innerHTML,/<span>Volume<\/span>/);assert.match(h.node('pw-results').innerHTML,/<span>Bid ₹/);
 h.click('',{pwLayout:'cards'});assert.equal(h.node('pw-pagination').hidden,false);
});

test('compact ladder headers fit narrow columns and selected change is never printed twice per contract',async()=>{
 const h=harness();h.view.setVisible(true);h.view.openLadder({source:'RECORDED',symbol:'NIFTY'});await settle();h.change('pw-date','2026-10-13');await settle();
 const before=h.node('pw-results').innerHTML;assert.match(before,/<th scope="col">CE ₹<\/th>/);assert.doesNotMatch(before,/selected parameters/);assert.equal((before.match(/\+5.71%/g)||[]).length,1);
 h.click('',{pwMetric:'change'});const mixed=h.node('pw-results').innerHTML;assert.equal((mixed.match(/\+5.71%/g)||[]).length,0);assert.match(mixed,/<span>Δ%<\/span><b>5.71/);assert.match(mixed,/PDH BREAK/);
});

test('Same Delta ladder pairs recorded strikes and replay clears missing Greeks; Same Strike restores original rows',async()=>{
 const h=harness();h.view.setVisible(true);h.click('',{pwSource:'RECORDED'});await settle();h.change('pw-date','2026-10-13');await settle();
 const data=h.state().current.NIFTY;
 for(const r of data.options){r.delta=r.option_type==='CE'?.49:-.50;if(r.option_type==='PE')r.strike=22100;}
 h.click('',{pwLayout:'ladder'});h.change('pw-pairing','DELTA');
 let html=h.node('pw-results').innerHTML;assert(html.includes('Same |Delta|'));assert(html.includes('22,000 CE · Δ 0.49'));assert(html.includes('22,100 PE · Δ -0.5'));assert(html.includes('Nearest match'));assert.equal(h.node('pw-chain-range').disabled,true);assert.equal(h.stored().pairing,'DELTA');
 data.options.filter((r:any)=>r.minute_bucket.includes('04:00')).forEach((r:any)=>r.delta=null);
 h.change('pw-at','2026-10-13T04:00:00.000Z');html=h.node('pw-results').innerHTML;assert(html.includes('No verified pair'));assert(!html.includes('Nearest match'));
 h.change('pw-pairing','STRIKE');assert(h.node('pw-results').innerHTML.includes('STRIKE'));assert.equal(h.node('pw-delta-target-label').hidden,true);
});
test('Live Same Delta requests both loaded strike sets and never displays recorded Greeks as live',async()=>{
 const h=harness({pairing:'DELTA',deltaTarget:'0.4'});h.view.setVisible(true);await settle();h.click('',{pwLayout:'ladder'});await settle();await h.timers[0]();await settle();
 const request=h.requests.at(-1)||'';assert(request.includes('view=ladder'));assert(request.includes('side=BOTH'));assert(!request.includes('nearby='));assert(h.node('pw-results').innerHTML.includes('Market feed'));assert(!h.node('pw-results').innerHTML.includes('Nearest match'));
});
