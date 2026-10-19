import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { WORKSPACE_NAV_HTML, WORKSPACE_CSS, installDashboardWorkspace } from '../dashboard-workspace-view.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';

test('one-stop card is a single top-level workspace panel, not hidden inside feed/settings',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/id="op-one-stop"/g)||[]).length,1);
 const head=html.indexOf('id="op-workspace-top"'),one=html.indexOf('id="op-one-stop"');
 const tools=html.indexOf('id="mb-tools"');
 assert(head>=0&&one>head&&tools>one);
 assert.match(WORKSPACE_NAV_HTML, /<\/div><\/div><section id="op-one-stop"/);
 assert.match(WORKSPACE_CSS, /\.op-one-scroll\{overflow-x:auto/);
});
test('one-stop exposes exactly four existing destinations and never requests or executes a trade',()=>{
 const buttons=[...WORKSPACE_NAV_HTML.matchAll(/data-op-one="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(buttons,['LIVE','LADDER','MULTIDAY','RAG']);
 const installer=installDashboardWorkspace.toString();
 assert.match(installer,/openLadder\(\{source:'LIVE'\}\)/);
 assert.match(installer,/openLadder\(\{source:'RECORDED'\}\)/);
 assert.match(installer,/rag-evidence-card/);
 assert.doesNotMatch(installer,/new EventSource|fetch\(|placeOrder|sendOrder|orderSubmit/);
});
test('one-stop withholds disconnected, stale and incomplete values',()=>{
 const installer=installDashboardWorkspace.toString();
 assert.match(installer,/d\?\.connected===true/);
 assert.match(installer,/q\?\.state==='LIVE'/);
 assert.match(installer,/p\.coverage\?\.complete===true/);
 assert.match(installer,/p\.expiry===a\.expiry/);
 assert.match(installer,/serverMs-at/);
 assert.match(installer,/No fresh Kite stream/);
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
 const code=installDashboardWorkspace.toString();
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
 const installer=vm.runInNewContext('('+installDashboardWorkspace.toString()+')',{document,window,localStorage,
  installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}});
 installer({chapters:Array.from({length:12},(_,i)=>'Chapter '+i),page(){return 0},turn(){},getState(){return {};}});
 const date=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10),at=new Date().toISOString();
 const quote=(side:string,expiry:string,strike:number,price:number)=>({state:'LIVE',price,observedAt:at,receivedAt:at,
  identity:{role:'OPTION',side,expiry,strike,symbol:'NIFTY'}});
 const first=date(1),second=date(8),strike=22000;
 const snapshot:any={tradeDate:date(0),indices:[],vix:null,omittedExpiries:[],
  atmExpiryLadder:[{symbol:'NIFTY',spot:{state:'LIVE',price:22005,observedAt:at,identity:{role:'SPOT',symbol:'NIFTY'}},
   rows:[{expiry:second,strike,ce:quote('CE',second,strike,111),pe:quote('PE',second,strike,222)},
         {expiry:first,strike,ce:quote('CE',first,strike,123),pe:quote('PE',first,strike,234)}]}]};
 const send=(connected:boolean)=>listeners['optionpilot:live-context']({detail:{connected,serverTime:new Date().toISOString(),snapshot:connected?snapshot:null,connectionState:connected?'OPEN':'DISCONNECTED'}});
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
