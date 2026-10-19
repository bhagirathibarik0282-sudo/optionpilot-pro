import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const evaluate=(code:string,context:any)=>vm.runInNewContext(code,{__name:(fn:any)=>fn,...context});
import { readFileSync } from 'node:fs';
import { WORKSPACE_NAV_HTML, WORKSPACE_CSS, installDashboardWorkspace } from '../dashboard-workspace-view.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';
import { deriveAtmFibHold } from '../premium-workspace-model.js';
import { deriveLiveThreeIndexPcr } from '../live-three-index-pcr.js';

test('command shortcuts restore hidden chapters and Recorded opens only the saved ladder',()=>{
 const nodes=new Map<string,any>(),listeners:any={},calls:any[]=[];let page=0;
 const el=(id:string)=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'NIFTY',setAttribute(){},classList:{toggle(){}},querySelectorAll(){return [];},scrollIntoView(){}});return nodes.get(id);};
 const installer=evaluate('('+installDashboardWorkspace.toString()+')',{
  document:{body:{dataset:{}},getElementById:el,querySelectorAll(){return [];}},
  window:{addEventListener(n:string,fn:any){listeners[n]=fn;}},
  localStorage:{getItem(){return '[0]';},setItem(){}},deriveAtmFibHold,deriveLiveThreeIndexPcr,
  installPremiumWorkspace(){return {openLadder(v:any){calls.push(v);},setVisible(){},refreshRecorded(){}};}
 });
 const controller=installer({chapters:Array.from({length:13},(_,i)=>'Chapter '+i),page:()=>page,turn(i:number){page=i;},getState:()=>({})});
 controller.render();
 assert.equal((el('op-command-chapters').innerHTML.match(/data-op-chapter=/g)||[]).length,13);
 assert(el('op-command-chapters').innerHTML.includes('13 · Chapter 12'));
 el('op-command-chapters').onclick({target:{closest:()=>({dataset:{opChapter:'8'}})}});controller.render();
 assert.equal(page,8);assert(el('op-chapter-links').innerHTML.includes('data-op-chapter="8"'));
 el('op-one-actions').onclick({target:{closest:()=>({dataset:{opOne:'RECORDED'}})}});controller.render();
 assert.equal(page,7);assert.equal(calls.at(-1).source,'RECORDED');
 assert(el('op-chapter-links').innerHTML.includes('data-op-chapter="7"'));
 listeners['optionpilot:live-context']({detail:{connected:false,connectionState:'MARKET_CLOSED',snapshot:null}});
 assert.match(el('op-one-status').textContent,/MARKET CLOSED/);
 assert.equal(el('op-workspace-feed').textContent,'MARKET CLOSED');
 assert.match(el('op-one-rows').innerHTML,/Open recorded ladder/);
 listeners['optionpilot:live-context']({detail:{connected:false,connectionState:'SESSION_REQUIRED',snapshot:null}});
 assert.match(el('op-one-status').textContent,/SESSION_REQUIRED/);
 assert.equal(el('op-workspace-feed').textContent,'OFFLINE / STALE');
 assert(!el('op-one-status').textContent.includes('MARKET CLOSED'));
 const html=renderBusinessDashboardV1Html({} as any);
 assert.match(html,/<details id="op-summary-panel">/);
 assert.match(html,/<details id="op-atm-weeklies" open aria-label=/);
 assert(html.includes('<details id="op-atm-weeklies" open'));
});

test('one-stop card is a single top-level workspace panel, not hidden inside feed/settings',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/id="op-one-stop"/g)||[]).length,1);
 const head=html.indexOf('id="op-workspace-top"'),one=html.indexOf('id="op-one-stop"');
 const tools=html.indexOf('id="mb-tools"');
 assert(head>=0&&one>head&&tools>one);
 assert.match(WORKSPACE_NAV_HTML, /<\/div><\/div><section id="op-one-stop"/);
 assert.match(WORKSPACE_CSS, /\.op-one-scroll\{overflow-x:auto/);
});
test('one-stop exposes existing destinations including explicit recorded access and never requests or executes a trade',()=>{
 const buttons=[...WORKSPACE_NAV_HTML.matchAll(/data-op-one="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(buttons,['LIVE','LADDER','MULTIDAY','RAG','RECORDED']);
 const installer=readFileSync(new URL('../dashboard-workspace-view.ts',import.meta.url),'utf8');
 assert.match(installer,/openLadder\(\{source:'LIVE',symbol:atmSelected\}\)/);
 assert.match(installer,/openLadder\(\{source:'RECORDED',symbol:atmSelected\}\)/);
 assert.match(installer,/rag-evidence-card/);
 assert.doesNotMatch(installer,/new EventSource|fetch\(|placeOrder|sendOrder|orderSubmit/);
});
test('one-stop withholds disconnected, stale and incomplete values',()=>{
 const installer=readFileSync(new URL('../dashboard-workspace-view.ts',import.meta.url),'utf8');
 assert.match(installer,/d\?\.connected===true/);
 assert.match(installer,/q\?\.state==='LIVE'/);
 assert.match(installer,/deriveLiveThreeIndexPcr/);
 assert.match(installer,/x\.expiry===a\.expiry/);
 assert.match(installer,/server-observed/);
 assert.match(installer,/No fresh verified Kite snapshot/);
});
test('one-stop serialized browser script parses without changing existing source ordering',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert(scripts.length>=4);
 for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script));
 assert.equal((html.match(/dashboard-live\/stream/g)||[]).length,1);
 assert.match(html,/One shared stream; exact expiry and source timestamps/);
});

test('weekly expiry ATM design uses real date rows, CE/PE side-by-side and individual toggles',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/id="op-atm-weeklies"/g)||[]).length,1);
 assert.match(html,/id="op-atm-index"/);
 assert.match(html,/Actual listed expiry dates — not DTE 0–4/);
 assert.deepEqual([...html.matchAll(/data-atm-mode="(BOTH|CE|PE)"/g)].map(m=>m[1]),['BOTH','CE','PE']);
 const code=readFileSync(new URL('../dashboard-workspace-view.ts',import.meta.url),'utf8');
 assert.match(code,/snap\.atmExpiryLadder/);
 assert.match(code,/a\.expiry\.localeCompare\(b\.expiry\)/);
 assert.match(code,/id\?\.expiry!==expiry/);
 assert.match(code,/No connected, fresh expiry snapshot/);
 assert.doesNotMatch(code,/new EventSource|fetch\(|orderSubmit/);
});
test('ATM weekly expiry rows render two sides, switch individually and clear on disconnect',()=>{
 const nodes=new Map<string,any>(),listeners:any={};
 const el=(id:string)=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'NIFTY',dataset:{},
  setAttribute(){},classList:{toggle(){}},querySelectorAll(){return [{dataset:{atmMode:'BOTH'},setAttribute(){}},{dataset:{atmMode:'CE'},setAttribute(){}},{dataset:{atmMode:'PE'},setAttribute(){}}];},
  scrollIntoView(){}});return nodes.get(id);};
 const document:any={body:{dataset:{}},hidden:false,getElementById:el,querySelectorAll(){return [];}};
 const window:any={addEventListener(name:string,fn:any){listeners[name]=fn;}};
 const localStorage:any={getItem(){return null},setItem(){}};
 const installer=evaluate('('+installDashboardWorkspace.toString()+')',{document,window,localStorage,
  deriveLiveThreeIndexPcr,
  installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}});
 installer({chapters:Array.from({length:12},(_,i)=>'Chapter '+i),page(){return 0},turn(){},getState(){return {};}});
 const date=(days:number)=>new Date(Date.now()+19800000+days*86400000).toISOString().slice(0,10),at=new Date().toISOString();
 const quote=(side:string,expiry:string,strike:number,price:number)=>({state:'LIVE',price,observedAt:at,receivedAt:at,
  identity:{role:'OPTION',side,expiry,strike,symbol:'NIFTY'}});
 const first=date(1),second=date(8),strike=22000;
 const snapshot:any={runtimeId:'unit',asOf:at,tradeDate:date(0),indices:[],vix:null,omittedExpiries:[],
  atmExpiryLadder:[{symbol:'NIFTY',spot:{state:'LIVE',price:22005,observedAt:at,identity:{role:'SPOT',symbol:'NIFTY'}},
   rows:[{expiry:second,strike,ce:quote('CE',second,strike,111),pe:quote('PE',second,strike,222)},
         {expiry:first,strike,ce:quote('CE',first,strike,123),pe:quote('PE',first,strike,234)}]}]};
 const send=(connected:boolean)=>{const now=new Date().toISOString();snapshot.asOf=now;listeners['optionpilot:live-context']({detail:{connected,source:'KITE_WEBSOCKET_FULL',serverTime:now,snapshot:connected?snapshot:null,connectionState:connected?'OPEN':'DISCONNECTED'}});};
 send(true);
 const paired=el('op-atm-pairs').innerHTML;
 assert.equal((paired.match(/data-atm-side=/g)||[]).length,2);
 const shown=(v:string)=>v.slice(8)+'/'+v.slice(5,7)+'/'+v.slice(2,4);
 assert(paired.indexOf(shown(first))<paired.indexOf(shown(second)),'exact expiry rows should be chronologically sorted');
 assert(paired.includes('123')&&paired.includes('234')&&paired.includes('111')&&paired.includes('222'));
 const modes=el('op-atm-modes');modes.onclick({target:{closest:()=>({dataset:{atmMode:'PE'}})}});
 assert.equal((el('op-atm-pairs').innerHTML.match(/data-atm-side=/g)||[]).length,1);
 assert(el('op-atm-pairs').innerHTML.includes('ATM PE'));
 assert(!el('op-atm-pairs').innerHTML.includes('ATM CE'));
 snapshot.atmExpiryLadder[0].rows[0].pe.identity.side='CE';
 send(true);
 assert(el('op-atm-pairs').innerHTML.includes('No fresh exact-contract quote'),'wrong leg identity is withheld');
 send(false);
 assert(!el('op-atm-pairs').innerHTML.includes('234'));
 assert.match(el('op-atm-pairs').innerHTML,/LIVE unavailable/);
});

test('exact CE/PE PDH PDL crosses flash below their expiry row with observed time; FIB button reuses ladder',()=>{
 const nodes=new Map<string,any>(),listeners:any={},opened:any[]=[];
 const el=(id:string)=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'NIFTY',
  setAttribute(){},classList:{toggle(){}},querySelectorAll(){return ['PDL','PDH','FIB'].map(atmLevel=>({dataset:{atmLevel},setAttribute(){}}));},
  scrollIntoView(){}});return nodes.get(id);};
 const document:any={body:{dataset:{}},hidden:false,getElementById:el,querySelectorAll(){return [];}};
 const window:any={addEventListener(n:string,fn:any){listeners[n]=fn;}};
 const localStorage:any={getItem(){return null},setItem(){}};
 const at0=Date.now(),iso=(v:number)=>new Date(at0+v).toISOString(),day=iso(0).slice(0,10),expiry='2026-10-26';
 const current={NIFTY:{options:['CE','PE'].map(side=>({symbol:'NIFTY',expiry,strike:22000,option_type:side,
  minute_bucket:iso(-12000),truth_verdict:'TRUE',pdh:125,pdl:95}))}};
 const api:any={chapters:Array.from({length:12},(_,i)=>'Chapter '+i),page(){return 0},turn(){},getState(){return {date:day,current};}};
 const installer=evaluate('('+installDashboardWorkspace.toString()+')',{document,window,localStorage,
  deriveAtmFibHold,
  deriveLiveThreeIndexPcr,
  installPremiumWorkspace(){return {openLadder(d:any){opened.push(d);},setVisible(){},refreshRecorded(){}};}});
 installer(api);
 const q=(side:string,price:number,stamp:number,open:number,high:number)=>({state:'LIVE',price,
  dayOpen:open,dayHigh:high,observedAt:iso(stamp),receivedAt:iso(stamp),
  identity:{role:'OPTION',symbol:'NIFTY',expiry,strike:22000,side}});
 const snap:any={runtimeId:'same',asOf:iso(0),tradeDate:day,indices:[],omittedExpiries:[],atmExpiryLadder:[
  {symbol:'NIFTY',spot:{state:'LIVE',price:22000,observedAt:iso(-1000),identity:{role:'SPOT',symbol:'NIFTY'}},
   rows:[{expiry,strike:22000,ce:q('CE',100,-5000,120,120),pe:q('PE',110,-5000,105,130)}]}]};
 const send=(connected=true)=>listeners['optionpilot:live-context']({detail:{connected,source:'KITE_WEBSOCKET_FULL',serverTime:iso(0),connectionState:connected?'OPEN':'DISCONNECTED',snapshot:connected?snap:null}});
 send();
 let html=el('op-atm-pairs').innerHTML;
 assert.doesNotMatch(html,/PDL BREAK|PDH BREAK/,'first reading below/above level cannot fabricate event');
 assert.match(html,/DAY O=H/);
 assert.match(html,/PDL ₹95/);
 snap.atmExpiryLadder[0].rows[0].ce=q('CE',94,-2000,120,120);
 snap.atmExpiryLadder[0].rows[0].pe=q('PE',130,-2000,105,130);
 send();
 html=el('op-atm-pairs').innerHTML;
 assert.match(html,/↓ DAY O=H \+ PDL BREAK/);
 assert.match(html,/↑ PDH BREAK/);
 assert.match(html,/data-flash="true"/);
 assert.match(html,/first observed/);
 const isoAt=iso(-2000),stamp=new Date(isoAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
 assert(html.includes(stamp),'break event must use real tick observedAt');
 el('op-atm-levels').onclick({target:{closest:(selector:string)=>selector==='[data-atm-level]'?{dataset:{atmLevel:'PDH'}}:null}});
 assert.match(el('op-atm-pairs').innerHTML,/PDH ₹125/);
 el('op-atm-levels').onclick({target:{closest:(selector:string)=>selector==='[data-atm-level]'?{dataset:{atmLevel:'FIB'}}:null}});
 assert.equal(opened.length,0,'FIB is an additive level toggle, not forced navigation');
 assert.match(el('op-atm-pairs').innerHTML,/PDL ₹95/,'PDL remains visible alongside PDH');
 assert.match(el('op-atm-pairs').innerHTML,/PDH ₹125/);
 assert.match(el('op-atm-pairs').innerHTML,/FIB — source unavailable/,'missing earlier exact-contract FIB never fabricates a value');
 el('op-atm-levels').onclick({target:{closest:(selector:string)=>selector==='[data-atm-open-fib]'?{}:null}});
 assert.equal(opened.length,1,'optional detail action reuses existing ladder');
 assert.equal(opened[0].metric,'fib');
 assert.equal(opened[0].symbol,'NIFTY');
 send(false);
 assert.doesNotMatch(el('op-atm-pairs').innerHTML,/PDL BREAK|PDH BREAK|₹94/);
 // Disconnection cannot resurrect an old crossing if reconnect starts below PDL.
 send(true);
 assert.doesNotMatch(el('op-atm-pairs').innerHTML,/PDL BREAK|PDH BREAK/);
});
test('PDH/PDL flash guards require same expiry/strike/day evidence and actual Kite FULL daily O=H',()=>{
 const code=readFileSync(new URL('../dashboard-workspace-view.ts',import.meta.url),'utf8');
 assert.match(code,/String\(r\.expiry\)\.slice\(0,10\)===expiry&&r\.strike===strike&&r\.option_type===side/);
 assert.match(code,/truth_verdict==='TRUE'/);
 assert.match(code,/old\.price>=level\.pdl&&q\.price<level\.pdl/);
 assert.match(code,/old\.price<=level\.pdh&&q\.price>level\.pdh/);
 assert.match(code,/dayOpen/);
 assert.match(code,/first observed/);
 assert.match(WORKSPACE_CSS,/prefers-reduced-motion:reduce/);
 assert.doesNotMatch(code,/new EventSource|fetch\(|orderSubmit/);
});

test('multi-select ATM layer buttons keep independent PDH, PDL and sourced FIB per CE/PE expiry',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.match(html,/data-atm-level="PDH"/);
 assert.match(html,/data-atm-level="PDL"/);
 assert.match(html,/data-atm-level="FIB"/);
 assert.match(html,/data-atm-open-fib/);
 const code=readFileSync(new URL('../dashboard-workspace-view.ts',import.meta.url),'utf8');
 assert.match(code,/atmLayers=new Set(?:<string>)?\(\['PDL'\]\)/);
 assert.match(code,/atmLayers\.has\('FIB'\)/);
 assert.match(code,/atmLayers\.delete\(level\)/);
 assert.match(code,/deriveAtmFibHold/);
 assert.match(code,/session\?\.baseline\?\.\[atmSelected\]\?\.options/);
 assert.match(code,/session\?\.current\?\.\[atmSelected\]\?\.options/);
 assert.match(code,/held\.name/);
 assert.match(code,/HOLD unconfirmed/);
 assert.doesNotMatch(code,/new EventSource|fetch\(|orderSubmit/);
});

test('PR2 historical replay does not auto-fetch all three indices on every minute; manual refresh stays',()=>{
 const code=readFileSync(new URL('../business-dashboard-v1-view.ts',import.meta.url),'utf8');
 const begin=code.indexOf('function resumeRefresh(){'),end=code.indexOf('function restoreRefreshPreference',begin);
 assert(begin>=0&&end>begin);
 const block=code.slice(begin,end);
 assert.match(block,/!document\.hidden/);
 assert.match(block,/!completedReplayLoaded\(\)/);
 assert.match(block,/const today=new Date\(Date\.now\(\)\+19800000\)\.toISOString\(\)\.slice\(0,10\)/);
 assert.match(block,/if\(\$\('date'\)\.value===today\)load\(\)/,'auto replay restricted to current India market date');
 assert.match(code,/\$\('data-form'\)\.onsubmit=load/,'historical recorded sessions still load on explicit user action');
 assert.match(code,/setInterval\(resumeRefresh,60000\)/,'the recorder UI cadence was not changed');
 assert.match(block,/refreshQuoteSnapshots\(\)/,'separate quote context still refreshed as before');
 assert.match(block,/loadCashContext\(\)/,'saved FII DII still refreshed as before');
});

test('PR3 one-stop displays only verified Kite ticks and never upgrades partial OI to Full PCR',()=>{
 const nodes=new Map<string,any>(),listeners:any={};
 const el=(id:string)=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'NIFTY',
  setAttribute(){},classList:{toggle(){}},querySelectorAll(){return [];},scrollIntoView(){}});return nodes.get(id);};
 const document:any={body:{dataset:{}},hidden:false,getElementById:el,querySelectorAll(){return [];}};
 const window:any={addEventListener(n:string,fn:any){listeners[n]=fn;}};
 const localStorage:any={getItem(){return null},setItem(){}};
 const installer=evaluate('('+installDashboardWorkspace.toString()+')',{document,window,localStorage,
  deriveAtmFibHold,deriveLiveThreeIndexPcr,installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}});
 installer({chapters:Array.from({length:12},(_,i)=>'Chapter '+i),page(){return 0},turn(){},getState(){return {};}});
 const now=Date.now(),at=new Date(now).toISOString(),date=new Date(now+19800000).toISOString().slice(0,10),expiry='2026-10-26';
 const quote=(role:string,symbol:string,price:number,side?:string)=>({state:'LIVE',price,observedAt:at,receivedAt:at,
  identity:{role,symbol,expiry,strike:22000,side}});
 const a:any={symbol:'NIFTY',expiry,strike:22000,expiries:[expiry],
  spot:quote('SPOT','NIFTY',22001),future:quote('FUTURE','NIFTY',22015),
  ce:quote('OPTION','NIFTY',123,'CE'),pe:quote('OPTION','NIFTY',99,'PE'),
  pcrSnapshot:{state:'INCOMPLETE',source:'KITE_REST_FULL_EXPIRY_SNAPSHOT',checkedAt:at,
   coverage:{expected:100,freshOi:70,missing:30,stale:0,invalid:0,complete:false}}};
 const payload:any={connected:true,source:'KITE_WEBSOCKET_FULL',serverTime:at,connectionState:'OPEN',
  snapshot:{asOf:at,runtimeId:'run',tradeDate:date,indices:[a],atmExpiryLadder:[],vix:quote('VIX','INDIA VIX',14)}};
 listeners['optionpilot:live-context']({detail:payload});
 let html=el('op-one-rows').innerHTML;
 assert.match(html,/22,001/);
 assert.match(html,/Kite /);
 assert.match(html,/OI 70\/100/);
 assert.doesNotMatch(html,/FULL · OI/);
 // A wrong-side exact contract must not leak its premium number.
 listeners['optionpilot:live-context']({detail:{connected:false,connectionState:'DISCONNECTED'}});
 a.ce.identity.side='PE';a.ce.price=99999;payload.serverTime=new Date(Date.now()+650).toISOString();
 payload.snapshot.asOf=payload.serverTime;
 listeners['optionpilot:live-context']({detail:payload});
 html=el('op-one-rows').innerHTML;
 assert.doesNotMatch(html,/99,999/);
 assert.match(html,/Not verified/);
 // Server source ages out: summary must revoke all numeric fields.
 payload.serverTime=new Date(Date.now()-7000).toISOString();payload.snapshot.asOf=payload.serverTime;
 listeners['optionpilot:live-context']({detail:payload});
 assert.match(el('op-one-rows').innerHTML,/values withheld/);
});

test('PR4 narrow cards use compact metric grid without hiding exact expiry ATM CE and PE',()=>{
 assert.match(WORKSPACE_CSS,/@media\(max-width:600px\)[\s\S]*?\.op-one-scroll\{overflow-x:visible/);
 assert.match(WORKSPACE_CSS,/#op-one-stop tbody tr\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(WORKSPACE_CSS,/#op-atm-pairs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);overflow-x:visible/);
 const code=readFileSync(new URL('../dashboard-workspace-view.ts',import.meta.url),'utf8');
 assert.match(code,/data-metric="Full PCR"/);
 assert.match(code,/data-metric="CE wall"/);
 assert.match(code,/data-metric="PE wall"/);
 assert.match(code,/data-metric="'\+side\+' ₹"/);
 assert.doesNotMatch(code,/new EventSource|fetch\(/);
});

test('PR4 verified ticker, card and ATM revoke connected but stale, forged or wrong-identity readings',()=>{
 const nodes=new Map<string,any>(),listeners:any={};
 const el=(id:string)=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'NIFTY',
  setAttribute(){},classList:{toggle(){}},querySelectorAll(){return [];},scrollIntoView(){}});return nodes.get(id);};
 const document:any={body:{dataset:{}},hidden:false,getElementById:el,querySelectorAll(){return [];}};
 const window:any={addEventListener(n:string,fn:any){listeners[n]=fn;}};
 const localStorage:any={getItem(){return null},setItem(){}};
 const installer=evaluate('('+installDashboardWorkspace.toString()+')',{document,window,localStorage,
  deriveAtmFibHold,deriveLiveThreeIndexPcr,installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}});
 installer({chapters:Array.from({length:12},(_,i)=>'Chapter '+i),page(){return 0},turn(){},getState(){return {};}});
 const at=new Date().toISOString(),date=new Date(Date.now()+19800000).toISOString().slice(0,10);
 const spot:any={state:'LIVE',price:21234,observedAt:at,receivedAt:at,identity:{role:'SPOT',symbol:'NIFTY'}};
 const p:any={connected:true,source:'KITE_WEBSOCKET_FULL',serverTime:at,connectionState:'OPEN',
  snapshot:{asOf:at,runtimeId:'run',tradeDate:date,indices:[{symbol:'NIFTY',spot,expiry:'2026-10-26'}],atmExpiryLadder:[]}};
 const send=()=>listeners['optionpilot:live-context']({detail:p});
 send();assert.match(el('op-workspace-ticker').innerHTML,/21,234/);
 assert.match(el('op-one-rows').innerHTML,/21,234/);
 // The same previously displayed value may not survive an untrusted source.
 p.source='UNVERIFIED';send();
 assert.doesNotMatch(el('op-workspace-ticker').innerHTML,/21,234/);
 assert.doesNotMatch(el('op-one-rows').innerHTML,/21,234/);
 assert.match(el('op-atm-pairs').innerHTML,/LIVE unavailable/);
 assert.match(el('op-workspace-feed').textContent,/OFFLINE/);
 // Connected but wrong symbol identity also cannot recreate the numeric ticker.
 p.source='KITE_WEBSOCKET_FULL';spot.identity.symbol='SENSEX';send();
 assert.doesNotMatch(el('op-workspace-ticker').innerHTML,/21,234/);
 // Stale server time invalidates all cards even if socket connected.
 p.serverTime=new Date(Date.now()-8000).toISOString();p.snapshot.asOf=p.serverTime;send();
 assert.match(el('op-one-rows').innerHTML,/values withheld/);
 assert.match(el('op-workspace-feed').textContent,/STALE/);
});


test('PR5 repeated live packets preserve ATM DOM and flashing; new premium, disconnect and reconnect still redraw',()=>{
 let fakeNow=Date.now();
 class Clock extends Date{static now(){return fakeNow;}}
 const nodes=new Map<string,any>(),listeners:any={};
 const el=(id:string)=>{
  if(!nodes.has(id)){
   let html='',text='',css='';
   const node:any={value:'NIFTY',htmlWrites:0,textWrites:0,classWrites:0,
    setAttribute(){},classList:{toggle(){}},querySelectorAll(){return [];},scrollIntoView(){}};
   Object.defineProperties(node,{
    innerHTML:{get(){return html;},set(v){html=v;node.htmlWrites++;}},
    textContent:{get(){return text;},set(v){text=v;node.textWrites++;}},
    className:{get(){return css;},set(v){css=v;node.classWrites++;}}
   });
   nodes.set(id,node);
  }
  return nodes.get(id);
 };
 const document:any={body:{dataset:{}},hidden:false,getElementById:el,querySelectorAll(){return [];}};
 const window:any={addEventListener(n:string,fn:any){listeners[n]=fn;}};
 const localStorage:any={getItem(){return null},setItem(){}};
 const installer=evaluate('('+installDashboardWorkspace.toString()+')',{
  document,window,localStorage,Date:Clock,deriveLiveThreeIndexPcr,deriveAtmFibHold,
  installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}
 });
 installer({chapters:Array.from({length:12},(_,i)=>'Chapter '+i),page(){return 0},turn(){},getState(){return {};}});
 const at=()=>new Date(fakeNow).toISOString();
 const date=new Date(fakeNow+19800000).toISOString().slice(0,10),expiry='2026-10-26';
 const quote=(role:string,price:number,side?:string)=>({
  state:'LIVE',price,observedAt:at(),receivedAt:at(),
  identity:{role,symbol:'NIFTY',expiry,strike:22000,side}
 });
 const spot=quote('SPOT',22000),ce=quote('OPTION',112,'CE'),pe=quote('OPTION',102,'PE');
 const idx:any={symbol:'NIFTY',expiry,strike:22000,expiries:[expiry],spot,
  future:quote('FUTURE',22010),ce,pe,pcrSnapshot:{state:'INCOMPLETE',
   coverage:{expected:100,freshOi:60,missing:40,stale:0,invalid:0,complete:false}}};
 const p:any={source:'KITE_WEBSOCKET_FULL',connected:true,connectionState:'OPEN',serverTime:at(),
  snapshot:{runtimeId:'run',tradeDate:date,asOf:at(),indices:[idx],
   atmExpiryLadder:[{symbol:'NIFTY',spot,rows:[{expiry,strike:22000,ce,pe}]}],omittedExpiries:[]}};
 const send=()=>listeners['optionpilot:live-context']({detail:p});
 const count=()=>['op-atm-pairs','op-one-rows','op-workspace-ticker'].map(id=>el(id).htmlWrites);
 send();
 assert.match(el('op-atm-pairs').innerHTML,/112/);
 assert.match(el('op-one-rows').innerHTML,/112/);
 const initial=count();
 fakeNow+=650;send();fakeNow+=650;send();
 assert.deepEqual(count(),initial,'same visible evidence must not recreate rows or restart blink animations');
 fakeNow+=650;ce.price=115;ce.observedAt=at();ce.receivedAt=at();p.serverTime=at();p.snapshot.asOf=at();send();
 const updated=count();
 assert(updated[0]>initial[0]&&updated[1]>initial[1],'new premium paints immediately');
 assert.equal(updated[2],initial[2],'unchanged spot ticker does not repaint for CE ticks');
 assert.match(el('op-atm-pairs').innerHTML,/115/);
 p.connected=false;p.connectionState='DISCONNECTED';send();
 const invalid=count();
 assert(invalid[0]>updated[0]&&invalid[1]>updated[1]&&invalid[2]>updated[2]);
 assert.match(el('op-atm-pairs').innerHTML,/LIVE unavailable/);
 send();assert.deepEqual(count(),invalid,'repeated offline event must not recreate unavailable cards');
 fakeNow+=650;p.connected=true;p.connectionState='OPEN';p.serverTime=at();p.snapshot.asOf=at();send();
 assert.match(el('op-atm-pairs').innerHTML,/115/);
 assert.match(el('op-one-rows').innerHTML,/115/);
});
