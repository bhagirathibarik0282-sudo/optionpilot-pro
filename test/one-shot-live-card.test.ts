import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installOneShotLiveCard} from '../one-shot-live-card.js';
import {installDashboardWorkspace,WORKSPACE_NAV_HTML} from '../dashboard-workspace-view.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {deriveLiveThreeIndexPcr,deriveRecordedThreeIndexPcr} from '../live-three-index-pcr.js';
import {derivePremiumWorkspace,derivePremiumSeriesInventory,deriveAtmFibHold} from '../premium-workspace-model.js';

function harness(){
 let now=Date.parse('2026-10-19T04:15:00Z');
 class Clock extends Date{constructor(value?:any){super(value??now);}static now(){return now;}}
 const nodes=new Map<string,any>(),listeners:any={},writes=new Map<string,number>();
 const el=(id:string)=>{if(!nodes.has(id)){let html='';nodes.set(id,{tagName:['os-pulse','os-vix','os-stocks','os-sectors'].includes(id)?'DETAILS':'DIV',open:false,hidden:false,textContent:'',value:'NIFTY',dataset:{},attrs:{},
  get innerHTML(){return html;},set innerHTML(v:string){html=v;writes.set(id,(writes.get(id)||0)+1);},
  setAttribute(k:string,v:string){this.attrs[k]=v;},removeAttribute(k:string){delete this.attrs[k];},classList:{toggle(){}},querySelectorAll(){return [];},scrollIntoView(){this.scrolled=true;}});}return nodes.get(id);};
 const symbols=['NIFTY','SENSEX','BANKNIFTY'],stamp=()=>new Date(now).toISOString(),date='2026-10-19',expiry='2026-10-22';
 const quote=(role:string,symbol:string,price=100,patch:any={})=>({state:'LIVE',price,pdc:95,oi:1000,observedAt:stamp(),receivedAt:stamp(),identity:{role,symbol,token:role==='FUTURE'?2:role==='OPTION'?3:1,expiry,...(role==='OPTION'?{side:'CE',strike:100}:{})},...patch});
 let cycle=now;
 const payload=()=>({connected:true,connectionState:'OPEN',source:'KITE_WEBSOCKET_FULL',serverTime:stamp(),pcrDisplay:Object.fromEntries(symbols.map(symbol=>[symbol,{state:'COMPLETE',source:'KITE_REST_FULL_EXPIRY_SNAPSHOT',expiry,periodMs:60000,checkedAt:new Date(cycle).toISOString(),cycleStartedAt:new Date(cycle).toISOString(),sourceMinAt:new Date(cycle).toISOString(),sourceMaxAt:new Date(cycle).toISOString(),ceTotal:100,peTotal:120,fullPcr:1.2,coverage:{expected:4,freshOi:4,complete:true,sourceSkewMs:0},callWall:{strike:105,oi:500},putWall:{strike:95,oi:600}}])),snapshot:{runtimeId:'test',asOf:stamp(),tradeDate:date,
  indices:symbols.map(symbol=>({symbol,expiry,expiries:[expiry],strike:100,spot:quote('SPOT',symbol),future:quote('FUTURE',symbol),ce:quote('OPTION',symbol),pe:quote('OPTION',symbol,90,{identity:{role:'OPTION',symbol,expiry,strike:100,side:'PE',token:4}})})),
  atmExpiryLadder:symbols.map(symbol=>({symbol,spot:quote('SPOT',symbol),rows:[{expiry,strike:100,ce:quote('OPTION',symbol,120),pe:quote('OPTION',symbol,90,{identity:{role:'OPTION',symbol,expiry,strike:100,side:'PE',token:4}})}]})),
  vix:quote('VIX','',14,{pdc:13}),participation:[quote('STOCK','',150,{identity:{role:'STOCK',label:'HDFC <Bank>',token:99},pdc:100}),quote('SECTOR','',90,{identity:{role:'SECTOR',label:'PSU Bank',token:98},pdc:100})]}});
 let saved:any={date,current:{}},loadArgs:any=null;
 const models=Object.fromEntries(symbols.map(symbol=>[symbol,{symbol,tradeDate:date,spot:{pdh:101,pdl:90,at:stamp()}}]));
 const context:any={document:{body:{dataset:{}},getElementById:el,querySelectorAll(){return [];}},window:{addEventListener(n:string,f:any){listeners[n]=f;}},localStorage:{getItem(){return null;},setItem(){}},Date:Clock,__name:(fn:any)=>fn,deriveLiveThreeIndexPcr,deriveRecordedThreeIndexPcr,deriveAtmFibHold,derivePremiumWorkspace,derivePremiumSeriesInventory,installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}};
 vm.createContext(context);vm.runInContext('var installOneShotLiveCard='+installOneShotLiveCard.toString(),context);
 const installer=vm.runInContext('('+installDashboardWorkspace.toString()+')',context);
 installer({chapters:Array.from({length:13},(_,i)=>'Chapter '+i),page:()=>0,turn(){},getState:()=>saved,getModels:()=>models,setDate:async(date:string,options:any)=>{loadArgs={date,options};saved={...saved,date,scope:options.scope};}});
 el('os-chart-cadence').onchange({target:{value:'0'}});
 el('os-window').onclick({target:{closest:()=>({dataset:{osWindow:'1'}})}});
 const send=(p:any)=>listeners['optionpilot:live-context']({detail:p});
 return {el,payload,send,writes,loadArgs:()=>loadArgs,setSaved(value:any){saved=value;},advance(ms:number){now+=ms;},newCycle(){cycle=now;},stamp};
}

test('production HTML mounts the real new design once, with ten categories and existing real controls',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/data-os-version="ONE_SHOT_LIVE_V1"/g)||[]).length,1);
 assert.equal((WORKSPACE_NAV_HTML.match(/data-os-go=/g)||[]).length,10);
 for(const name of ['Market overview · selected index','Spot × Full PCR pulse','Premium Ladder (Multi-DTE)','VIX + agreement radar'])assert(WORKSPACE_NAV_HTML.includes(name));
 assert.equal((WORKSPACE_NAV_HTML.match(/id="op-atm-pairs"/g)||[]).length,1);
 assert.equal((html.match(/dashboard-live\/stream/g)||[]).length,1);
 for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);
 assert(html.includes('const installOneShotLiveCard='));
 assert.doesNotMatch(installOneShotLiveCard.toString(),/fetch\(|setInterval|new EventSource|Math\.sin|Math\.random|localStorage|placeOrder/);
});

test('new radar, PCR, VIX and source walls render verified values and revoke them on disconnect',()=>{
 const h=harness(),p=h.payload();h.send(p);
 assert(h.el('os-market-radar').innerHTML.includes('Full PCR 1.2'));
 assert(h.el('os-vix-value').innerHTML.includes('>14<'));
 assert(h.el('os-wall-ladder').innerHTML.includes('105 / 95'));
 assert(h.el('os-wall-ladder').innerHTML.includes('OI 500 / 600'));
 assert(!h.el('os-pulse-chart').innerHTML.includes('<path'));
 h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 for(const id of ['os-market-radar','os-pcr-strip','os-vix-value','os-wall-ladder'])assert(!h.el(id).innerHTML.includes('1.2'));
 assert(h.el('os-pulse-chart').innerHTML.includes('RECORDED'));
 assert.equal(h.el('op-one-stop').dataset.osSource,'RECORDED');
 assert(h.el('os-future-response').innerHTML.includes('no stale comparison'));
});

test('three-index level radar and futures chapter show PDH/PDC/PDL with exact source gates',()=>{
 const h=harness(),p=h.payload();
 for(const a of p.snapshot.indices){
   a.future.pdc=a.symbol==='NIFTY'?23123.45:a.symbol==='SENSEX'?74789.12:55912.34;
   a.future.pdh=999999;a.future.pdl=888888; // forged / unsupported futures H/L must never display
 }
 h.send(p);
 const radar=h.el('os-market-radar').innerHTML,levels=h.el('os-future-response').innerHTML;
 for(const symbol of ['NIFTY','SENSEX','BANKNIFTY']){
  const card=radar.split('data-os-index="'+symbol+'"')[1].split('</button>')[0];
  assert(card.includes('SPOT · PDH / PDC / PDL'));
  assert(card.includes('FUT '));
  assert(card.includes('PDH / PDC / PDL'));
  assert(card.includes('101'));assert(card.includes('90'));
  assert(levels.includes(symbol));
 }
 for(const value of ['23,123.45','74,789.12','55,912.34']){
  assert(radar.includes(value),'all futures PDC visible in compact radar');
  assert(levels.includes(value),'all futures PDC visible in chapter 04');
 }
 assert(!radar.includes('999,999'));assert(!radar.includes('888,888'));
 assert(!levels.includes('999,999'));assert(!levels.includes('888,888'));
 assert(levels.includes('same-contract previous-session high/low source unavailable'));
 h.send({connected:false,connectionState:'DISCONNECTED',snapshot:null});
 for(const value of ['23,123.45','74,789.12','55,912.34']){
  assert(!h.el('os-market-radar').innerHTML.includes(value));
  assert(!h.el('os-future-response').innerHTML.includes(value));
 }
});

test('index choice drives exact expiry ATM selection; malformed identities and partial PCR stay unavailable',()=>{
 const h=harness();h.send(h.payload());
 h.el('os-market-radar').onclick({target:{closest:()=>({dataset:{osIndex:'SENSEX'}})}});
 assert.equal(h.el('op-atm-index').value,'SENSEX');
 assert(h.el('os-dte-alignment').innerHTML.includes('SENSEX'));
 h.advance(1000);const p=h.payload();p.pcrDisplay.NIFTY.coverage.complete=false;p.snapshot.indices[0].spot.identity.symbol='SENSEX';h.send(p);
 const radar=h.el('os-market-radar').innerHTML.split('data-os-index="NIFTY"')[1].split('</button>')[0];
 assert(radar.includes('>—</strong>'));assert(!radar.includes('Full PCR 1.2'));
 h.advance(1000);const old=h.payload();old.snapshot.tradeDate='2026-10-18';h.send(old);
 assert(h.el('os-pulse-chart').innerHTML.includes('unavailable'));
});

test('real samples build the pulse; changing expiry resets PCR history rather than stitching contracts',()=>{
 const h=harness();h.send(h.payload());
 for(let i=1;i<=6;i++){h.advance(10000);if(i===6)h.newCycle();const p=h.payload();for(const a of p.snapshot.indices)a.spot.price=100+i;h.send(p);}
 assert(h.el('os-pulse-chart').innerHTML.includes('stroke="#3be6ff"'));
 assert(h.el('os-pulse-chart').innerHTML.includes('stroke="#ff8ed9"'));
 h.advance(10000);const p=h.payload();p.snapshot.indices[0].expiry='2026-10-29';p.snapshot.indices[0].expiries=['2026-10-29'];p.pcrDisplay.NIFTY.expiry='2026-10-29';h.send(p);
 assert(!h.el('os-pulse-chart').innerHTML.includes('stroke="#ff8ed9"'));
});

test('three-index same-side alert requires observed crossings and disappears after recovery',()=>{
 const h=harness();h.send(h.payload());h.advance(10000);const p=h.payload();for(const a of p.snapshot.indices)a.spot.price=102;h.send(p);
 assert(h.el('os-events').innerHTML.includes('3-index same-side PDH BREAK'));
 h.advance(10000);const recovered=h.payload();h.send(recovered);
 assert(!h.el('os-events').innerHTML.includes('os-alert'));
});

test('rank panels stay lazy, escape labels, and revoke rows immediately when disconnected',()=>{
 const h=harness();h.send(h.payload());const count=h.writes.get('os-stock-ranks');
 h.advance(1000);h.send(h.payload());assert.equal(h.writes.get('os-stock-ranks'),count);
 h.el('os-stocks').open=true;h.el('os-stocks').ontoggle();
 assert(h.el('os-stock-ranks').innerHTML.includes('HDFC &lt;Bank&gt;'));
 assert(h.el('os-stock-ranks').innerHTML.includes('+50%'));
 assert(h.el('os-stock-ranks').innerHTML.includes('₹ 150'));
 h.el('os-sectors').open=true;h.el('os-sectors').ontoggle();
 assert(h.el('os-sector-ranks').innerHTML.includes('Index points 90'));
 assert(!h.el('os-sector-ranks').innerHTML.includes('₹ 90'));
 h.send({connected:false,connectionState:'DISCONNECTED',snapshot:null});
 assert(!h.el('os-stock-ranks').innerHTML.includes('+50%'));
 h.el('os-stocks').open=false;h.el('os-stocks').ontoggle();assert.equal(h.el('os-stock-ranks').innerHTML,'');
});


test('futures response compares exact matched live endpoints and does not claim a causal follower',()=>{
 const h=harness();h.send(h.payload());
 for(let i=1;i<=6;i++){h.advance(10000);if(i===6)h.newCycle();const p=h.payload();p.snapshot.indices[0].future.price=100+i;p.snapshot.atmExpiryLadder[0].rows[0].ce.price=120+i;p.snapshot.atmExpiryLadder[0].rows[0].pe.price=90-i;h.send(p);}
 const html=h.el('os-future-response').innerHTML;
 assert(html.includes('Same direction'));assert(html.includes('Opposite direction'));assert(html.includes('09:45:00 → 09:46:00 IST'));
 h.advance(1000);const p=h.payload();p.snapshot.indices[0].future.identity.expiry='2026-10-18';h.send(p);
 assert(h.el('os-future-response').innerHTML.includes('unavailable'));
});

test('forged PCR totals cannot upgrade wall/ratio readings; stale VIX is independently withheld',()=>{
 const h=harness(),p=h.payload();p.pcrDisplay.NIFTY.fullPcr=3.1415;p.snapshot.vix.price=987.65;p.snapshot.vix.observedAt='2026-10-19T04:14:00Z';h.send(p);
 assert(!h.el('os-pcr-strip').innerHTML.includes('3.1415'));assert(!h.el('os-vix-value').innerHTML.includes('987.65'));
 assert(h.el('os-market-radar').innerHTML.includes('Full PCR 1.2'),'other independently valid indices retain their source');
});

test('Multi-DTE awareness shows sorted actual expiries, independent CE PE and calendar DTE',()=>{
 const h=harness(),p=h.payload(),group=p.snapshot.atmExpiryLadder[0],r=group.rows[0];
 const later=structuredClone(r);later.expiry='2026-10-29';for(const q of [later.ce,later.pe]){q.identity.expiry=later.expiry;q.identity.token+=10;}
 group.rows=[later,r];h.send(p);
 const html=h.el('os-dte-radar').innerHTML;
 assert(html.indexOf('data-expiry="2026-10-22"')<html.indexOf('data-expiry="2026-10-29"'));
 assert(html.includes('3 calendar days'));assert(html.includes('10 calendar days'));
 assert(html.includes('data-side="CE"'));assert(html.includes('data-side="PE"'));
 assert(html.includes('26.32%'));assert(html.includes('-5.26%'));
 assert(html.includes('SOURCE MATCHED'));assert(!html.includes('NaN'));
 assert(!WORKSPACE_NAV_HTML.includes('<details id="op-atm-weeklies" open'));
 assert(WORKSPACE_NAV_HTML.includes('Multi-DTE awareness'));
});

test('Multi-DTE rejects duplicate expiries and impossible dates without inventing a row',()=>{
 const h=harness(),p=h.payload(),group=p.snapshot.atmExpiryLadder[0],r=group.rows[0];
 const invalid=structuredClone(r);invalid.expiry='2026-02-30';
 group.rows=[r,structuredClone(r),invalid];h.send(p);
 const html=h.el('os-dte-radar').innerHTML;
 assert(!html.includes('data-expiry='));assert(html.includes('No fresh verified expiry inventory'));
});

test('Multi-DTE stale or wrong-contract leg is withheld, and disconnect revokes all tiles',()=>{
 const h=harness(),p=h.payload(),r=p.snapshot.atmExpiryLadder[0].rows[0];
 r.ce.price=987.65;r.ce.state='STALE';h.send(p);
 let html=h.el('os-dte-radar').innerHTML;
 assert(!html.includes('987.65'));assert(html.includes('PAIR INCOMPLETE / UNSYNCED'));assert(html.includes('>90</b>'));
 h.advance(1000);const forged=h.payload();forged.snapshot.atmExpiryLadder[0].rows[0].ce.identity.strike=101;h.send(forged);
 html=h.el('os-dte-radar').innerHTML;assert(!html.includes('>120</b>'));
 h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 assert(!h.el('os-dte-radar').innerHTML.includes('data-expiry='));
});

test('Multi-DTE window compares fixed contracts only and rebuilds after an ATM roll',()=>{
 const h=harness();h.send(h.payload());
 h.el('os-dte-metric').onclick({target:{closest:()=>({dataset:{osDteMetric:'window'}})}});
 assert(h.el('os-dte-radar').innerHTML.includes('BUILDING MATCHED HISTORY'));
 for(let i=1;i<=6;i++){
  h.advance(10000);const p=h.payload();p.snapshot.atmExpiryLadder[0].rows[0].ce.price=120+i;p.snapshot.atmExpiryLadder[0].rows[0].pe.price=90-i;h.send(p);
 }
 let html=h.el('os-dte-radar').innerHTML;
 assert(html.includes('SOURCE MATCHED'));assert(html.includes('5%'));assert(html.includes('-6.67%'));
 assert(html.includes('09:45:00 → 09:46:00 IST'));assert(h.el('os-dte-context').innerHTML.includes('1m matched contracts'));
 h.advance(1000);const roll=h.payload(),r=roll.snapshot.atmExpiryLadder[0].rows[0];r.strike=105;
 for(const q of [r.ce,r.pe]){q.identity.strike=105;q.identity.token+=100;}
 h.send(roll);html=h.el('os-dte-radar').innerHTML;
 assert(html.includes('BUILDING MATCHED HISTORY'));assert(!html.includes('5%</em>'));
});

test('Multi-DTE window withholds unsynced pair changes while keeping fresh individual LTP',()=>{
 const h=harness();h.send(h.payload());
 for(let i=1;i<=6;i++){h.advance(10000);const p=h.payload();p.snapshot.atmExpiryLadder[0].rows[0].ce.price=120+i;h.send(p);}
 h.el('os-dte-metric').onclick({target:{closest:()=>({dataset:{osDteMetric:'window'}})}});
 h.advance(1000);const p=h.payload();p.snapshot.atmExpiryLadder[0].rows[0].pe.observedAt=new Date(Date.parse(h.stamp())-10000).toISOString();h.send(p);
 const html=h.el('os-dte-radar').innerHTML;
 assert(html.includes('PAIR INCOMPLETE / UNSYNCED'));assert(!html.includes('5%</em>'));assert(html.includes('>120</b>'));
});

test('preface switches pages without interrupting shared feed or losing index selection',()=>{
 const h=harness();h.send(h.payload());
 h.el('os-market-radar').onclick({target:{closest:()=>({dataset:{osIndex:'SENSEX'}})}});
 assert.equal(h.el('os-preface').hidden,true);assert.equal(h.el('os-dashboard').hidden,false);
 h.el('os-open-preface').onclick();
 assert.equal(h.el('os-preface').hidden,false);assert.equal(h.el('os-dashboard').hidden,true);
 assert.equal(h.el('os-open-preface').attrs['aria-expanded'],'true');
 h.advance(1000);const p=h.payload();p.snapshot.indices[1].spot.price=103;h.send(p);
 assert(h.el('os-market-radar').innerHTML.includes('>103</strong>'));
 h.el('os-open-dashboard').onclick();
 assert.equal(h.el('os-dashboard').hidden,false);assert.equal(h.el('os-preface').hidden,true);
 assert.equal(h.el('op-atm-index').value,'SENSEX');
 assert.equal(h.el('os-open-dashboard').attrs['aria-pressed'],'true');
 h.el('os-open-preface').onclick();h.el('os-open-preface').onclick();
 assert.equal(h.el('os-preface').hidden,true);assert.equal(h.el('os-dashboard').hidden,false);
 assert.equal((WORKSPACE_NAV_HTML.match(/id="os-pcr-strip"/g)||[]).length,1);
 assert(WORKSPACE_NAV_HTML.indexOf('id="os-pcr-strip"')<WORKSPACE_NAV_HTML.indexOf('id="os-pulse"'));
});

test('all three PCR cards distinguish complete full ratio, band and comparable arrows',()=>{
 const h=harness();h.send(h.payload());
 let html=h.el('os-pcr-strip').innerHTML;
 for(const symbol of ['NIFTY','SENSEX','BANKNIFTY'])assert(html.includes('data-pcr-index="'+symbol+'"'));
 assert.equal((html.match(/1\.2000/g)||[]).length,3);
 assert(html.includes('ATM ±7 band: —'));assert(html.includes('waiting for comparable snapshot'));
 h.advance(60000);h.newCycle();const p=h.payload();
 p.pcrDisplay.NIFTY.peTotal=130;p.pcrDisplay.NIFTY.fullPcr=1.3;
 p.pcrDisplay.SENSEX.peTotal=110;p.pcrDisplay.SENSEX.fullPcr=1.1;
 p.pcrDisplay.BANKNIFTY.coverage.complete=false;h.send(p);
 html=h.el('os-pcr-strip').innerHTML;
 assert(html.includes('1.3000'));assert(html.includes('PCR up">↑'));
 assert(html.includes('1.1000'));assert(html.includes('PCR down">↓'));
 const bank=html.split('data-pcr-index="BANKNIFTY"')[1];
 assert(!bank.includes('1.2000'));assert(bank.includes('Full expiry OI not verified'));
 assert(html.includes('09:45:00 → 09:46:00 IST'));
});

function savedPcrState(patch:any={}){
 const date='2026-10-19',expiry='2026-10-22';
 return {date,current:Object.fromEntries(['NIFTY','SENSEX','BANKNIFTY'].map((symbol,i)=>[symbol,{chain:[{symbol,expiry,minute_bucket:date+'T04:14:00Z',truth_verdict:'TRUE',full_pcr_source:'Exact archived full-chain source',full_chain_oi_pcr:1.8765+i,...patch}],market:[]}]))};
}

test('incomplete live PCR explains exact coverage and separately shows verified same-expiry archive',()=>{
 const h=harness(),p=h.payload();h.setSaved(savedPcrState());
 for(const a of p.snapshot.indices){
  const raw=structuredClone(p.pcrDisplay[a.symbol]);raw.state='INCOMPLETE';raw.reason='STALE_OI_TIMESTAMPS';
  Object.assign(raw.coverage,{complete:false,freshOi:2,stale:2,missing:0,invalid:0});
  a.pcrSnapshot=raw;p.pcrDisplay[a.symbol]=raw;
 }
 h.send(p);const html=h.el('os-pcr-strip').innerHTML;
 assert.equal((html.match(/RECORDED · Full PCR/g)||[]).length,3);
 for(const value of ['1.8765','2.8765','3.8765'])assert(html.includes(value));
 assert(html.includes('OI 2/4 fresh · stale 2 · missing 0 · invalid 0'));
 assert(html.includes('checked 09:45:00 IST'));
 assert(html.includes('2026-10-19 · 09:44:00 IST'));
 assert(html.includes('UNAVAILABLE · Fresh Full PCR'));assert(!html.includes('LIVE · Full OI PCR'));
 assert(!html.includes('PCR up">↑'));
 assert(!h.el('os-wall-ladder').innerHTML.includes('1.8765'));
 assert(!h.el('os-pulse-chart').innerHTML.includes('stroke="#ff8ed9"'));
 h.send({connected:false,connectionState:'DISCONNECTED',snapshot:null});
 assert(!h.el('os-pcr-strip').innerHTML.includes('1.8765'));
});

test('recorded PCR refuses wrong date, expiry, future, duplicate, false or unverified sources',()=>{
 for(const kind of ['date','expiry','future','duplicate','false','source']){
  const h=harness(),p=h.payload(),state=savedPcrState();
  if(kind==='date')state.date='2026-10-18';
  for(const a of p.snapshot.indices){
   p.pcrDisplay[a.symbol].coverage.complete=false;
   const chain=state.current[a.symbol].chain;
   if(kind==='expiry')chain[0].expiry='2026-10-29';
   if(kind==='future')chain[0].minute_bucket='2026-10-19T04:16:00Z';
   if(kind==='duplicate')chain.push({...chain[0]});
   if(kind==='false')chain[0].truth_verdict='FALSE';
   if(kind==='source')chain[0].full_pcr_source='ATM band';
  }
  h.setSaved(state);h.send(p);
  assert(!h.el('os-pcr-strip').innerHTML.includes('RECORDED · Full PCR'),kind);
 }
});

test('a fresh verified live PCR takes precedence without relabelling recorded data as live',()=>{
 const h=harness();h.setSaved(savedPcrState());h.send(h.payload());
 const html=h.el('os-pcr-strip').innerHTML;
 assert(!html.includes('1.8765'));assert(!html.includes('RECORDED · Full PCR'));
 assert.equal((html.match(/OI 4\/4 verified/g)||[]).length,3);
});


function recordedSession(){
 const date='2026-10-19',expiries=['2026-10-22','2026-10-29'];
 return {date,scope:'CORE',current:Object.fromEntries(['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>[symbol,{
  market:['04:14:00','04:15:00'].map((t,i)=>({symbol,minute_bucket:date+'T'+t+'Z',spot_ltp:100+i,truth_verdict:'TRUE'})),
  options:expiries.flatMap(expiry=>['CE','PE'].flatMap(option_type=>['04:14:00','04:15:00'].map((t,i)=>({symbol,expiry,option_type,strike:100,minute_bucket:date+'T'+t+'Z',truth_verdict:'TRUE',ltp:(option_type==='CE'?120:90)+i,pdc:95,pdh:125,pdl:85})))),
  chain:expiries.flatMap(expiry=>['04:14:00','04:15:00'].map((t,i)=>({symbol,expiry,minute_bucket:date+'T'+t+'Z',truth_verdict:'TRUE',full_pcr_source:'Exact archived full-chain source',full_chain_oi_pcr:1.5+i/10})))
 }]))};
}

test('closed market opens four recorded slots with exact saved prices and three PCR readings',()=>{
 const h=harness();h.setSaved(recordedSession());h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 const html=h.el('os-dte-radar').innerHTML;
 assert.equal((html.match(/class="os-dte-tile/g)||[]).length,4);
 assert.equal((html.match(/data-recorded-expiry=/g)||[]).length,2);
 assert(html.includes('>121</b>'));assert(html.includes('>91</b>'));assert(html.includes('PDH 125'));
 assert(html.includes('Saved 09:45:00 IST'));assert(html.includes('No recorded inventory'));
 assert(h.el('os-dte-context').innerHTML.includes('RECORDED · 2026-10-19'));
 assert.equal((h.el('os-pcr-strip').innerHTML.match(/RECORDED · Full OI PCR/g)||[]).length,3);
 assert.equal((h.el('os-pcr-strip').innerHTML.match(/1.6000/g)||[]).length,3);
 assert(h.el('os-pulse-chart').innerHTML.includes('stroke="#ff8ed9"'));
 assert(!h.el('os-agreement').innerHTML.includes('3/3 verified'));
 assert(h.el('os-expiry-clock').innerHTML.includes('3 calendar days as of 2026-10-19'));
});

test('Live only refuses recorded substitution and changing back restores recorded panels',()=>{
 const h=harness();h.setSaved(recordedSession());h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 h.el('os-source').onchange({target:{value:'LIVE'}});
 assert(!h.el('os-dte-radar').innerHTML.includes('>121</b>'));assert(!h.el('os-pcr-strip').innerHTML.includes('1.6000'));
 h.el('os-source').onchange({target:{value:'RECORDED'}});
 assert(h.el('os-dte-radar').innerHTML.includes('>121</b>'));
 h.send(h.payload());assert(h.el('os-dte-context').innerHTML.includes('RECORDED'));
 h.el('os-source').onchange({target:{value:'LIVE'}});
 assert(h.el('os-dte-context').innerHTML.includes('vs contract PDC'));
 assert(!h.el('os-dte-radar').innerHTML.includes('data-recorded-expiry='));
});

test('recorded side and index controls filter all expiries without crossing index identity',()=>{
 const h=harness(),s=recordedSession();s.current.SENSEX.options.forEach(r=>r.ltp+=1000);h.setSaved(s);
 h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 h.el('os-sides').onclick({target:{closest:()=>({dataset:{osSide:'PE'}})}});
 assert(!h.el('os-dte-radar').innerHTML.includes('data-side="CE"'));
 assert.equal((h.el('os-dte-radar').innerHTML.match(/data-side="PE"/g)||[]).length,2);
 h.el('os-index').onchange({target:{value:'SENSEX'}});
 assert(h.el('os-dte-radar').innerHTML.includes('1,091'));assert.equal(h.el('op-atm-index').value,'SENSEX');
 assert(h.el('os-dte-context').innerHTML.includes('SENSEX'));
});

test('recorded conflicting latest premium and missing Spot anchor fail closed',()=>{
 for(const failure of ['conflict','spot','wrongday','future']){
  const h=harness(),s=recordedSession(),data=s.current.NIFTY;
  if(failure==='conflict')data.options.push({...data.options[1],ltp:98765});
  if(failure==='spot')data.market.forEach(r=>r.truth_verdict='FALSE');
  if(failure==='wrongday')data.options.forEach(r=>r.minute_bucket='2026-10-18T04:15:00Z');
  if(failure==='future'){data.options.forEach(r=>{r.minute_bucket='2026-10-19T04:16:00Z';r.ltp=98765;});data.chain.forEach(r=>r.minute_bucket='2026-10-19T04:16:00Z');}
  h.setSaved(s);h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
  const html=h.el('os-dte-radar').innerHTML;
  assert(!html.includes('98,765'));if(failure==='spot'||failure==='wrongday')assert(!html.includes('>121</b>'));
  if(failure==='future')assert(!h.el('os-pcr-strip').innerHTML.split('data-pcr-index="NIFTY"')[1].split('data-pcr-index="SENSEX"')[0].includes('1.6000'));
 }
});

test('recorded window requires matching pair endpoints and source change preserves no live event',()=>{
 const h=harness(),s=recordedSession();s.current.NIFTY.options=s.current.NIFTY.options.filter(r=>!(r.option_type==='PE'&&r.minute_bucket.includes('04:14')));
 h.setSaved(s);h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 h.el('os-dte-metric').onclick({target:{closest:()=>({dataset:{osDteMetric:'window'}})}});
 const html=h.el('os-dte-radar').innerHTML;assert(!html.includes('0.83%'));assert(html.includes('Incomplete pair'));
 assert(!h.el('os-events').innerHTML.includes('PDH BREAK'));
});

test('full-session action reuses existing loader and selects Recorded after completion',async()=>{
 const h=harness();h.setSaved(recordedSession());h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 h.el('os-recorded-date').value='2026-10-19';await h.el('os-load-recorded').onclick();
 assert.equal(h.loadArgs().date,'2026-10-19');assert.equal(h.loadArgs().options.scope,'FULL');assert.equal(h.loadArgs().options.fullSession,true);
 assert.equal(h.el('os-source').value,'RECORDED');assert.equal(h.el('os-load-recorded').disabled,false);
 assert(h.el('os-dte-alignment').innerHTML.includes('full session loaded'));
});

test('3-minute chart custom throttles painting while manual refresh and invalid source revoke immediately',()=>{
 const h=harness();h.el('os-chart-cadence').onchange({target:{value:'180000'}});h.send(h.payload());
 const count=h.writes.get('os-pulse-chart');
 h.advance(10000);h.send(h.payload());const firstSampleCount=h.writes.get('os-pulse-chart');
 h.advance(10000);h.send(h.payload());assert.equal(h.writes.get('os-pulse-chart'),firstSampleCount);
 h.el('os-chart-refresh').onclick();assert(h.el('os-pulse-chart').innerHTML.includes('stroke="#3be6ff"'));
 h.el('os-chart-series').onchange({target:{value:'PCR'}});assert(!h.el('os-pulse-chart').innerHTML.includes('stroke="#3be6ff"'));
 h.send({connected:false,connectionState:'DISCONNECTED',snapshot:null});assert(!h.el('os-pulse-chart').innerHTML.includes('<path'));
 assert(count!==undefined);
});


test('a historically stale option quote is withheld without rolling ATM to another contract',()=>{
 const h=harness(),s=recordedSession();
 s.current.NIFTY.options.forEach((r:any)=>{if(r.option_type==='CE'){r.quote_timestamp='2026-10-19T04:00:00Z';r.quote_age_seconds=900;r.ltp=12345;}});
 h.setSaved(s);h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 assert(!h.el('os-dte-radar').innerHTML.includes('12,345'));assert(h.el('os-dte-radar').innerHTML.includes('ATM 100'));
 assert(h.el('os-dte-radar').innerHTML.includes('>91</b>'));
});


test('the default 3m window renders historical 3m observations without interpolation',()=>{
 assert(WORKSPACE_NAV_HTML.includes('data-os-window="3" aria-pressed="true"'));
 assert(WORKSPACE_NAV_HTML.includes('data-os-window="1" aria-pressed="false"'));
 const h=harness(),s=recordedSession();s.date='2026-10-16';
 for(const data of Object.values(s.current))for(const key of ['market','options','chain'])data[key].forEach((r:any)=>{r.minute_bucket=r.minute_bucket.replace('2026-10-19','2026-10-16').replace('04:14:00','04:12:00');});
 h.setSaved(s);h.send({connected:false,connectionState:'MARKET_CLOSED',snapshot:null});
 assert(!h.el('os-pulse-chart').innerHTML.includes('<path'));
 h.el('os-window').onclick({target:{closest:()=>({dataset:{osWindow:'3'}})}});
 assert(h.el('os-pulse-chart').innerHTML.includes('stroke="#3be6ff"'));
 assert(h.el('os-pulse-chart').innerHTML.includes('stroke="#ff8ed9"'));
});


test('reported full-chain PCR stays labelled apart from fresh values, charts and alignment',()=>{
 const h=harness(),p=h.payload();
 for(const a of p.snapshot.indices){
  const raw:any=structuredClone(p.pcrDisplay[a.symbol]);raw.state='INCOMPLETE';raw.fetchState='OK';raw.reason='STALE_OI_TIMESTAMPS';
  Object.assign(raw.coverage,{complete:false,freshOi:2,stale:2,missing:0,invalid:0});
  raw.reportedPcr={basis:'LATEST_REPORTED_MIXED_TIMESTAMPS',symbol:a.symbol,expiry:a.expiry,value:1.3333,ceTotal:10000,peTotal:13333,expected:4,reported:4,olderThan30s:2,sourceMinAt:'2026-10-19T04:10:00Z',sourceMaxAt:raw.checkedAt,checkedAt:raw.checkedAt};
  a.pcrSnapshot=raw;delete p.pcrDisplay[a.symbol];
 }
 h.send(p);const html=h.el('os-pcr-strip').innerHTML;
 assert.equal((html.match(/Full-chain reported PCR/g)||[]).length,3);assert.equal((html.match(/1.3333/g)||[]).length,3);
 assert(html.includes('4/4 contracts · 2 older than 30s'));assert(html.includes('Source 09:40:00 → 09:45:00 IST'));
 assert(!html.includes('LIVE · Full OI PCR'));assert(!h.el('os-wall-ladder').innerHTML.includes('1.3333'));assert(!h.el('os-pulse-chart').innerHTML.includes('1.3333'));
 h.send({connected:false,connectionState:'DISCONNECTED',snapshot:null});assert(!h.el('os-pcr-strip').innerHTML.includes('1.3333'));
});

test('reference premium table retains exact identities, side/index controls and revocation',()=>{
 const h=harness(),p=h.payload();h.send(p);
 const table=h.el('os-premium-table').innerHTML;
 assert(table.includes('<table'));assert(table.includes('LTP ₹'));assert(table.includes('>120<'));
 assert(!table.includes('82%'));assert(table.includes('Source time · IST'));
 const bad=h.payload();bad.snapshot.atmExpiryLadder[0].rows[0].ce.identity.side='PE';h.advance(600);h.send(bad);
 assert(!h.el('os-premium-table').innerHTML.includes('>120<'),'wrong-side quote must be withheld');
 h.el('os-reference-indices').onclick({target:{closest:()=>({dataset:{osSelect:'SENSEX'}})}});
 assert.equal(h.el('os-index').value,'SENSEX');
 h.send({connected:false,connectionState:'DISCONNECTED',snapshot:null});
 assert(!h.el('os-premium-table').innerHTML.includes('>120<'),'disconnected premiums must be revoked');
});
