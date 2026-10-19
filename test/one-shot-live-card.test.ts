import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installOneShotLiveCard} from '../one-shot-live-card.js';
import {installDashboardWorkspace,WORKSPACE_NAV_HTML} from '../dashboard-workspace-view.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {deriveLiveThreeIndexPcr} from '../live-three-index-pcr.js';
import {deriveAtmFibHold} from '../premium-workspace-model.js';

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
 const models=Object.fromEntries(symbols.map(symbol=>[symbol,{symbol,tradeDate:date,spot:{pdh:101,pdl:90,at:stamp()}}]));
 const context:any={document:{body:{dataset:{}},getElementById:el,querySelectorAll(){return [];}},window:{addEventListener(n:string,f:any){listeners[n]=f;}},localStorage:{getItem(){return null;},setItem(){}},Date:Clock,__name:(fn:any)=>fn,deriveLiveThreeIndexPcr,deriveAtmFibHold,installPremiumWorkspace(){return {openLadder(){},setVisible(){},refreshRecorded(){}};}};
 vm.createContext(context);vm.runInContext('var installOneShotLiveCard='+installOneShotLiveCard.toString(),context);
 const installer=vm.runInContext('('+installDashboardWorkspace.toString()+')',context);
 installer({chapters:Array.from({length:13},(_,i)=>'Chapter '+i),page:()=>0,turn(){},getState:()=>({date,current:{}}),getModels:()=>models});
 const send=(p:any)=>listeners['optionpilot:live-context']({detail:p});
 return {el,payload,send,writes,advance(ms:number){now+=ms;},newCycle(){cycle=now;},stamp};
}

test('production HTML mounts the real new design once, with ten categories and existing real controls',()=>{
 const html=renderBusinessDashboardV1Html({} as any);
 assert.equal((html.match(/data-os-version="ONE_SHOT_LIVE_V1"/g)||[]).length,1);
 assert.equal((WORKSPACE_NAV_HTML.match(/data-os-go=/g)||[]).length,10);
 for(const name of ['3-index market radar','Spot × Full PCR pulse','Multi-expiry premium ladder','VIX + agreement radar'])assert(WORKSPACE_NAV_HTML.includes(name));
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
 assert(h.el('os-pulse-chart').innerHTML.includes('Market closed'));
 assert(h.el('os-future-response').innerHTML.includes('no stale comparison'));
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
