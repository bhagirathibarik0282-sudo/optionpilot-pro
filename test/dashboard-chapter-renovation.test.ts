import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';
import { deriveMarketBook } from '../market-book-model.js';
import { MARKET_BOOK_CSS } from '../market-book-view.js';

const date='2026-10-08',expiry='2026-10-13',times=['2026-10-08T04:15:00Z','2026-10-08T04:18:00Z'];
function recording(symbol:string){
 return {market:times.map((minute_bucket,i)=>({symbol,minute_bucket,truth_verdict:'TRUE',spot_ltp:22000+i*10,spot_prev_close:21900,pdh:22100,pdl:21800,future_ltp:22020+i*10,future_basis:20,future_oi:1000+i*100,india_vix:12+i*.1})),
  options:times.flatMap((minute_bucket,i)=>['CE','PE'].map(option_type=>({symbol,minute_bucket,truth_verdict:'TRUE',expiry,strike:22000,option_type,ltp:option_type==='CE'?100+i*10:100-i*10,oi:1000,iv:18,pdh:120,pdl:80,dte:5}))),
  chain:times.map(minute_bucket=>({symbol,minute_bucket,truth_verdict:'TRUE',expiry,full_chain_oi_pcr:1.2345,full_pcr_source:'Exact archived full-chain source',call_wall_strike:22100,call_wall_oi:2000,put_wall_strike:21900,put_wall_oi:3000}))};
}
function harness(empty=false,patch?:(state:any)=>void,extras:any={}){
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>();
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',attrs:{},classList:{add(){},remove(){},toggle(){}},setAttribute(k:string,v:string){this.attrs[k]=v;},getAttribute(k:string){return this.attrs[k];},offsetWidth:0});
 const current=Object.fromEntries(['NIFTY','SENSEX','BANKNIFTY'].map(s=>[s,empty?{}:recording(s)]));
 const state:any={date,recordedDates:[date],current,history:{},baseline:{},health:{},stocks:{},sectors:null,
  cash:{latestStoredSessionDate:'2026-10-07',sourceMode:'STORED',source:'TEST FIXTURE',windows:[{window:'Latest stored session',availableSessions:1,fiiNetCrore:-100,diiNetCrore:200,combinedNetCrore:100,state:'RECORDED'}]}};
 patch?.(state);const before=structuredClone(state);
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math,...extras};
 vm.createContext(ctx);const first=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];vm.runInContext(first,ctx);
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){},memory:async()=>{}};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);
 const turn=(page:number)=>{nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:String(page)}})}});return nodes.get('mb-page').innerHTML as string;};
 return {html,nodes,state,before,turn};
}
const markers=['mb-overview','Recorded spot reference levels','mb-contract-grid','mb-expiry-grid','mb-futures-card','mb-positioning-card','mb-event-tiles','Detailed month board','Market agreement comparisons','mb-pcr-comparison','mb-cash-grid','ONE MARKET SERIES','Comparison category'];
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

test('all chapters start compact and Details toggles only presentation without changing values or filters',()=>{
 const h=harness(),root=h.nodes.get('market-book'),toggle=h.nodes.get('mb-details-toggle');
 assert.equal(root.attrs['data-op-details'],'hide');
 assert.match(h.html,/<details id="mb-health-details"><summary>Data status<\/summary>/);
 for(let page=0;page<13;page++){
  const before=h.turn(page),selected=h.nodes.get('mb-expiry').value;
  assert.equal(root.attrs['data-op-details'],'hide');toggle.onclick();
  assert.equal(root.attrs['data-op-details'],'show');assert.equal(toggle.attrs['aria-expanded'],'true');
  assert.equal(h.nodes.get('mb-page').innerHTML,before);assert.equal(h.nodes.get('mb-expiry').value,selected);
  toggle.onclick();assert.equal(root.attrs['data-op-details'],'hide');assert.equal(toggle.attrs['aria-expanded'],'false');
 }
 assert.deepEqual(h.state,h.before);
 const chart=h.turn(9);
 assert.match(chart,/<details class="mb-chart-settings" data-event-key="chart-settings-mb-local-NIFTY"><summary>Chart settings<\/summary>/);
 assert(chart.includes('PCR provenance:'));assert(chart.includes('RECORDED · PCR coverage unverified'));
 assert(!chart.includes('class="mb-chart-settings" open'));
 assert(MARKET_BOOK_CSS.includes('#market-book:not([data-op-details=show])'));
 assert(MARKET_BOOK_CSS.includes('.mb-note,.mb-route,div.mb-value,p.mb-value'));
 assert(MARKET_BOOK_CSS.includes(':not(details *)'));
});

test('cash and VIX chapters exclude unrelated index and option cards, including their scope labels',()=>{
 const h=harness();const cash=h.turn(10);
 assert(!cash.includes('cash-index-context'));assert(!cash.includes('ov-card'));assert(!cash.includes('Recorded full PCR'));
 assert(!h.nodes.get('mb-scope').textContent.includes('Strike'));assert(h.nodes.get('mb-scope').textContent.includes('EOD cash'));
 const vix=h.turn(11);assert(vix.includes('mb-vix-card'));assert(!vix.includes('Same selected index'));assert(!vix.includes('CE change'));assert(!vix.includes('PE change'));
 assert(!h.nodes.get('mb-scope').textContent.includes('CE '));assert(h.nodes.get('mb-scope').textContent.includes('India VIX'));
 h.turn(4);assert(!h.nodes.get('mb-scope').textContent.includes('Strike'));
 h.turn(2);assert(h.nodes.get('mb-scope').textContent.includes('Strike'));
 assert.deepEqual(h.state,h.before);
});

test('global statistics and optional panels start behind drawers rather than extending every chapter',()=>{
 const h=harness();
 for(const id of ['mb-tools','op-workspace-advanced','op-display-tools','op-ticker-tools']){
  assert.match(h.html,new RegExp('<details id="'+id+'"[^>]*>'));
  assert(!new RegExp('<details id="'+id+'"[^>]*\\bopen\\b').test(h.html));
 }
 assert(h.html.indexOf('id="op-workspace-advanced"')<h.html.indexOf('<section id="statistical-overview"'));
 assert(h.html.indexOf('id="mb-tools"')<h.html.indexOf('<details id="op-feed-detail"'));
 assert(h.html.indexOf('id="mb-tools"')<h.html.indexOf('id="op-workspace-ticker"'));
 assert(!h.html.includes('Clarity in every move'));
 for(const id of ['op-feed-detail','dashboard-live','op-workspace-ticker','statistical-overview','mb-tools'])assert.equal((h.html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
});

test('empty chapters show a single state and cash windows switch one card at a time without changing data',()=>{
 const empty=harness(true);for(const page of [0,1,2,3,4,5,6,9,11]){
  const html=empty.turn(page);assert(html.includes('NO RECORDING'));assert.equal((html.match(/class="mb-empty"/g)||[]).length,1);assert(!html.includes('ov-card'));assert(!html.includes('mb-event-tiles'));
 }
 const h=harness(false,s=>{s.cash.windows=['1D','3D','5D','20D'].map((window,i)=>({window,fiiNetCrore:100+i,diiNetCrore:200+i,combinedNetCrore:300+i,state:'RECORDED',availableSessions:i+1}));});
 const first=h.turn(10);assert.equal((first.match(/mb-box mb-cash-card/g)||[]).length,1);assert(first.includes('<h3>1D</h3>'));
 h.nodes.get('mb-page').onchange({target:{id:'mb-cash-window',value:'3'}});
 const selected=h.nodes.get('mb-page').innerHTML;assert.equal((selected.match(/mb-box mb-cash-card/g)||[]).length,1);assert(selected.includes('<h3>20D</h3>'));assert(!selected.includes('<h3>1D</h3>'));
 h.nodes.get('mb-page').onchange({target:{id:'mb-cash-window',value:'99'}});assert.equal(h.nodes.get('mb-page').innerHTML,selected);
 assert.deepEqual(h.state,h.before);
});

test('agreement buttons show one category, relevant filters and keep shared selectors synchronized',()=>{
 const h=harness();h.turn(12);
 const click=(category:string)=>h.nodes.get('mb-page').onclick({target:{closest:(selector:string)=>selector==='[data-agreement-category]'?{dataset:{agreementCategory:category}}:null}});
 for(const category of ['PARTICIPATION','INDICES','PREMIUM','POSITIONING','VOLATILITY','SUMMARY']){
  click(category);const content=h.nodes.get('mb-page').innerHTML;
  assert.equal((content.match(/aria-pressed="true"/g)||[]).length,1);
  assert.equal(content.includes('data-agreement-control="stock"'),category==='PARTICIPATION');
  assert.equal(content.includes('data-agreement-control="expiry"'),category==='PREMIUM');
  if(category!=='PREMIUM')assert(!h.nodes.get('mb-scope').textContent.includes('Strike'));
 }
 h.nodes.get('mb-page').onchange({target:{dataset:{agreementControl:'window'},value:'6m'}});
 assert.equal(h.nodes.get('mb-window').value,'6m');
 h.nodes.get('mb-page').onchange({target:{dataset:{agreementControl:'symbol'},value:'SENSEX'}});
 assert.equal(h.nodes.get('mb-index').value,'SENSEX');assert.deepEqual(h.state,h.before);
});
test('quote history reads once per selected date and late responses cannot mix sessions',async()=>{
 const pending:any[]=[],calls:string[]=[];
 const h=harness(false,undefined,{AbortSignal,fetch:(url:string)=>{calls.push(url);return new Promise(resolve=>pending.push(resolve));}});
 h.turn(8);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
 h.turn(8);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
 h.state.date='2026-10-09';h.turn(8);await new Promise(resolve=>setImmediate(resolve));
 pending.shift()({ok:true,json:async()=>({date:'2026-10-08',snapshots:[{source:'SERVER_BACKGROUND_KITE_QUOTES',tradingDate:'2026-10-08',timestamp:times[1],stocks:{NIFTY:[{name:'OLD SESSION',change:5}]},sectors:[]}]})});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert(!h.nodes.get('mb-page').innerHTML.includes('OLD SESSION'));
 pending.shift()({ok:true,json:async()=>({date:'2026-10-09',snapshots:[],truncated:false})});
 await new Promise(resolve=>setImmediate(resolve));h.turn(8);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert(!h.nodes.get('mb-page').innerHTML.includes('Loading quotes'));
});

test('cold-start loading is visible in compact chapters and never reports missing recordings while pending',()=>{
 const h=harness(true,state=>Object.assign(state,{date:'',loading:true,archiveLoading:true,loadingDate:'2026-10-16'}));
 for(const page of [0,1,5,9]){const html=h.turn(page);assert.match(html,/Loading saved records/);assert.doesNotMatch(html,/NO RECORDING/);assert.equal(h.nodes.get('mb-load-status').hidden,false);assert.match(h.nodes.get('mb-load-status').textContent,/2026-10-16/);}
 h.state.current={NIFTY:recording('NIFTY')};h.state.date=date;h.state.loading=false;h.state.archiveLoading=false;
 assert.match(h.turn(0),/22,010/);assert.equal(h.nodes.get('mb-load-status').hidden,true);
 h.state.loading=true;h.state.archiveLoading=true;h.state.loadingDate='2026-10-16';assert.match(h.turn(0),/22,010/,'successful recorded values remain visible during refresh');
 h.state.loading=false;h.state.archiveLoading=false;h.state.current={};assert.match(h.turn(0),/NO RECORDING/);assert.equal(h.nodes.get('mb-load-status').hidden,true);
});


test('Flow cash card connects dated history and compares only actual stored sessions',()=>{
 const h=harness(false,s=>{s.cash={...s.cash,ready:false,dailyHistoryState:'VERIFIED_STORED_EOD',dailyHistory:[
  {date:'2026-10-06',fiiNetCrore:-120,diiNetCrore:150,combinedNetCrore:30},
  {date:'2026-10-07',fiiNetCrore:0,diiNetCrore:200,combinedNetCrore:200,fetchedAt:'2026-10-07T14:00:00Z',sourceUrl:'https://www.nseindia.com/api/fiidiiTradeReact'}],
  windows:[{window:'1D',availableSessions:1,requiredSessions:1,fiiNetCrore:0,diiNetCrore:200,combinedNetCrore:200,state:'READY'}]};});
 const html=h.turn(10);assert.match(html,/Previous-session context · not an intraday feed/);
 assert.match(html,/Date-wise history · 2 stored sessions/);assert.match(html,/2026-10-06 → 2026-10-07/);
 assert.match(html,/FII \+120 \/ DII \+50/);assert.match(html,/<td[^>]*>0<\/td>/);
 assert.match(html,/<details class="mb-event" data-event-key="cash-history">/);assert(!html.includes('cash-history" open'));
 assert.match(html,/Latest recorded market session has no matching cash report yet/);assert.deepEqual(h.state,h.before);
});
test('missing cash history and refresh failure remain explicit without invented daily values',()=>{
 const h=harness(false,s=>{s.cash=null;s.cashError='Saved cash request failed';});
 const html=h.turn(10);assert.match(html,/Saved cash request failed/);assert.match(html,/0 stored sessions/);
 assert(!html.includes('mb-cash-change'));assert(!html.includes('NaN'));assert(!html.includes('undefined'));
});
