import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderMarketBookLiveContext as live} from '../market-book-reading-guide.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {WORKSPACE_CSS} from '../dashboard-workspace-view.js';

const at='2026-10-16T04:03:00Z',expiry='2026-10-19';
function fixture(){
 const quote=(role:string,symbol:string,extra:any={})=>({identity:{role,symbol,expiry,strike:23000,...extra},state:'LIVE',observedAt:at,receivedAt:at,price:123.45,oi:0,volume:1234,pdc:120,changePct:2.875});
 const indices=['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>({symbol,expiry,strike:23000,spot:quote('SPOT',symbol),future:quote('FUTURE',symbol),ce:quote('OPTION',symbol,{side:'CE'}),pe:quote('OPTION',symbol,{side:'PE'}),futuresBasis:0,fullPcr:1.2345,pcrAt:at,coverage:{expected:10,freshOi:10,complete:true,sourceSkewMs:0},callWall:{strike:23100,oi:4000,tiedStrikes:[23100,23200]},putWall:{strike:22900,oi:5000,tiedStrikes:[22900]}}));
 return {connected:true,source:'KITE_WEBSOCKET_FULL',serverTime:at,snapshot:{asOf:at,tradeDate:'2026-10-16',indices,vix:quote('VIX',''),participation:[quote('STOCK','',{label:'HDFC'}),quote('SECTOR','',{label:'BANK'})]}} as any;
}
const kinds=(html:string)=>[...html.matchAll(/data-live-kind="([^"]+)"/g)].map(m=>m[1]);
test('all chapters project only the relevant existing live fields and keep historical exceptions explicit',()=>{
 const p=fixture(),before=structuredClone(p);
 for(let page=0;page<13;page++){const html=live(p,'NIFTY',page);assert(!html.includes('undefined'));assert(!html.includes('NaN'));if(page!==7)assert(html.includes('Kite feed'));}
 assert.deepEqual(kinds(live(p,'NIFTY',4)),['future','futureOi','futureVolume','basis','spot','pcr']);
 assert.deepEqual(kinds(live(p,'NIFTY',5)),['ceOi','peOi','pcr','callWall','putWall']);
 assert.equal(kinds(live(p,'NIFTY',9)).filter(k=>k==='pcr').length,3);
 assert(live(p,'NIFTY',2).includes('NIFTY · 2026-10-19 · 23000 · CE'));
 assert(live(p,'NIFTY',3).includes('selected expiry / strike pair'));
 assert(live(p,'NIFTY',7).includes('LIVE / RECORDED'));
 assert(live(p,'NIFTY',10).includes('dated EOD data'));
 assert.deepEqual(p,before);
});
test('disconnect, old server snapshot, wrong source or wrong session revokes every numeric live value',()=>{
 for(const change of [(p:any)=>p.connected=false,(p:any)=>p.source='RECORDED',(p:any)=>p.snapshot.tradeDate='2026-10-15',(p:any)=>p.snapshot.asOf='2026-10-16T04:02:55Z',(p:any)=>p.serverTime='invalid']){
  const p=fixture();change(p);const html=live(p,'NIFTY');assert(!html.includes('123.45'));assert.equal(kinds(html).length,0);
 }
 assert(live({connectionState:'MARKET_CLOSED'},'NIFTY').includes('MARKET_CLOSED'));
});
test('quote freshness, receipt freshness and exact option identity are independently enforced',()=>{
 for(const change of [(q:any)=>q.state='STALE',(q:any)=>q.observedAt='2026-10-16T04:02:29Z',(q:any)=>q.receivedAt='2026-10-16T04:02:29Z',(q:any)=>q.observedAt='2026-10-16T04:03:06Z',(q:any)=>q.receivedAt='2026-10-16T04:03:01Z',(q:any)=>q.identity.side='PE',(q:any)=>q.identity.symbol='SENSEX',(q:any)=>q.identity.strike=23100,(q:any)=>q.identity.expiry='2026-10-26']){
  const p=fixture();p.snapshot.indices[0].ce.price=987.65;p.snapshot.indices[0].ce.oi=987654;change(p.snapshot.indices[0].ce);
  const html=live(p,'NIFTY',2);assert(!html.includes('987.65'));assert(!html.includes('9,87,654'));assert(html.includes('WITHHELD'));assert(html.includes('123.45'),'independently fresh PE remains');
 }
});
test('PCR and walls share the same qualified cadence snapshot; no fallback when sampled coverage fails',()=>{
 const p=fixture();const a=p.snapshot.indices[0];
 p.pcrDisplay={NIFTY:{state:'COMPLETE',expiry,periodMs:180000,checkedAt:at,sourceMinAt:at,sourceMaxAt:at,fullPcr:2.3456,coverage:{complete:true,expected:10,freshOi:10},callWall:{strike:24000,oi:900,tiedStrikes:[24000]},putWall:{strike:22000,oi:800,tiedStrikes:[22000]}}};
 assert(live(p,'NIFTY',5).includes('2.3456'));assert(live(p,'NIFTY',5).includes('24,000'));assert(!live(p,'NIFTY',5).includes('23,100'));assert(live(p,'NIFTY',5).includes('3 min snapshot'));
 for(const change of [(s:any)=>s.expiry='2026-10-26',(s:any)=>s.coverage.freshOi=9,(s:any)=>s.sourceMinAt='2026-10-16T04:02:29Z',(s:any)=>s.checkedAt='2026-10-16T03:59:29Z',(s:any)=>s.periodMs=1000]){
  const copy=structuredClone(p);change(copy.pcrDisplay.NIFTY);const html=live(copy,'NIFTY',5);assert(!html.includes('2.3456'));assert(!html.includes('1.2345'));assert(!html.includes('24,000'));assert(!html.includes('23,100'));
 }
 delete p.pcrDisplay;assert(live(p,'NIFTY',5).includes('1.2345'));a.coverage.complete=false;assert(!live(p,'NIFTY',5).includes('1.2345'));assert(!live(p,'NIFTY',5).includes('23,100'));
});
test('zero OI/PCR/basis survive, missing does not become zero, and unsynchronized basis is withheld',()=>{
 const p=fixture(),a=p.snapshot.indices[0];a.fullPcr=0;assert(live(p,'NIFTY',5).includes('<strong>0</strong>'));
 a.ce.oi=null;a.pe.oi=null;a.fullPcr=null;a.callWall=null;a.putWall=null;assert(!live(p,'NIFTY',5).includes('<strong>0</strong>'));
 assert(live(p,'NIFTY',4).includes('data-live-kind="basis"><span>Futures − spot · points</span><strong>0</strong>'));
 a.futuresBasis=876.54;a.future.observedAt='2026-10-16T04:02:54Z';assert(!live(p,'NIFTY',4).includes('876.54'));
});
test('breadth uses fresh unweighted quotes with denominators, per-source times and escaped identities',()=>{
 const p=fixture();p.snapshot.participation.push({...p.snapshot.participation[0],identity:{role:'STOCK',label:'<unsafe>'},state:'STALE',changePct:-99});
 const html=live(p,'NIFTY',8);assert(html.includes('1/2 fresh unweighted quotes'));assert(html.includes('shared universe, not NIFTY weights'));assert(!html.includes('<unsafe>'));assert(html.includes('&lt;unsafe&gt;'));assert(!html.includes('-99'));assert(html.includes('source 16 Oct'));
});
test('serialized chapter navigation updates live values while recorded data remains untouched; mobile keeps live shell',()=>{
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>(),handlers:any={};
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},window:{addEventListener:(name:string,fn:any)=>handlers[name]=fn,dispatchEvent(){}},CustomEvent:class{},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];for(const script of scripts)new vm.Script(script[1]);vm.runInContext(scripts[0][1],ctx);
 let requests=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>({date:'2026-10-16',recordedDates:[],current:{},history:{},baseline:{},health:{}}),refresh(){requests++;},memory:async()=>{}};vm.runInContext('installMarketBook(api)',ctx);
 const turn=(page:number)=>nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:String(page)}})}});
 handlers['optionpilot:live-context']({detail:fixture()});turn(4);assert(nodes.get('mb-live-context').innerHTML.includes('Futures volume'));assert(nodes.get('mb-live-title').textContent.includes('Futures'));
 const recorded=nodes.get('mb-page').innerHTML;handlers['optionpilot:live-context']({detail:null});assert(!nodes.get('mb-live-context').innerHTML.includes('123.45'));assert.equal(nodes.get('mb-page').innerHTML,recorded);assert.equal(requests,0);
 nodes.get('mb-live-controls').onclick();assert.equal(nodes.get('op-feed-detail').open,true);
 assert(!WORKSPACE_CSS.includes('#mb-live-context-shell{display:none}'));assert(WORKSPACE_CSS.includes('#mb-live-context-shell{display:block}'));
});
