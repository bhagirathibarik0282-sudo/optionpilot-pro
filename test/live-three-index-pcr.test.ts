import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { deriveLiveThreeIndexPcr as derive, renderLiveThreeIndexPcr as render, LIVE_THREE_INDEX_PCR_CSS as css } from '../live-three-index-pcr.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
const start=Date.parse('2026-10-16T04:00:00Z'),iso=(n:number)=>new Date(n).toISOString();
const symbols=['NIFTY','SENSEX','BANKNIFTY'],expiries=['2026-10-20','2026-10-22','2026-10-27'];
function fixture(offset=0,values=[1,1.2,1.4],periodMs=60000){
 const at=iso(start+offset);return {connected:true,source:'KITE_WEBSOCKET_FULL',serverTime:at,snapshot:{runtimeId:'test-runtime',tradeDate:'2026-10-16',asOf:at,indices:symbols.map((symbol,i)=>({symbol,expiry:expiries[i],expiries:[expiries[i]]}))},pcrDisplay:Object.fromEntries(symbols.map((s,i)=>[s,{source:'KITE_REST_FULL_EXPIRY_SNAPSHOT',state:'COMPLETE',expiry:expiries[i],periodMs,cycleStartedAt:at,checkedAt:at,sourceMinAt:at,sourceMaxAt:at,fullPcr:values[i],ceTotal:1000,peTotal:values[i]*1000,coverage:{complete:true,expected:100,freshOi:100,sourceSkewMs:0}}]))} as any;
}
test('all three exact-expiry full PCR values require two qualified cycles for arrows and alignment',()=>{
 const first=derive(fixture(),null,100);assert.equal(first.alignment,'WAIT');assert(first.rows.every(r=>r.direction==='WAIT'&&r.current&&r.blinkUntil===0));
 const p=fixture(60000,[1.1,1.3,1.5]),before=structuredClone(p);const next=derive(p,first,200);assert.equal(next.alignment,'ALL_UP');assert(next.rows.every(r=>r.direction==='UP'&&r.blinkUntil===2000));assert.deepEqual(p,before);
 const html=render(next,200);assert.equal((html.match(/data-pcr-index=/g)||[]).length,3);assert.equal((html.match(/class="mb-pcr-blink"/g)||[]).length,3);assert(html.includes('BANKNIFTY'));assert(html.includes(expiries[2]+' · M'));
});
test('same sample does not restart blinking, later live ticks preserve finite expiry and flat never blinks',()=>{
 const first=derive(fixture(),null,0),next=derive(fixture(60000,[1.1,1.3,1.5]),first,200);
 const tick=fixture(60000,[1.1,1.3,1.5]);tick.serverTime=iso(start+60500);tick.snapshot.asOf=tick.serverTime;
 const duplicate=derive(tick,next,700);assert.deepEqual(duplicate.rows,next.rows);assert(!render(duplicate,2001).includes('mb-pcr-blink'));
 const flat=derive(fixture(120000,[1.1,1.3,1.5]),next,2000);assert.equal(flat.alignment,'ALL_FLAT');assert(!render(flat,2000).includes('mb-pcr-blink'));
 assert(css.includes('prefers-reduced-motion'));assert(!css.includes('infinite'));
});
test('falling and mixed directions are descriptive, never trade signals',()=>{
 const base=derive(fixture());assert.equal(derive(fixture(60000,[.9,1.1,1.3]),base).alignment,'ALL_DOWN');assert.equal(derive(fixture(60000,[1.1,1.1,1.4]),base).alignment,'MIXED');assert(!/bullish|bearish|BUY|SELL|win rate/.test(render(base)));
});
test('missing, partial, stale, source mismatch, invalid totals and duplicate identities fail closed without tick fallback',()=>{
 const mutations=[(p:any)=>p.connected=false,(p:any)=>p.source='RECORDED',(p:any)=>p.snapshot.runtimeId='',(p:any)=>p.snapshot.asOf=iso(start-5000),(p:any)=>delete p.pcrDisplay,(p:any)=>p.pcrDisplay.NIFTY.fullPcr=null,(p:any)=>p.pcrDisplay.NIFTY.fullPcr='1',(p:any)=>p.pcrDisplay.NIFTY.ceTotal=0,(p:any)=>p.pcrDisplay.NIFTY.peTotal=-1,(p:any)=>p.pcrDisplay.NIFTY.peTotal=999,(p:any)=>p.pcrDisplay.NIFTY.coverage.freshOi=99,(p:any)=>p.pcrDisplay.NIFTY.coverage.sourceSkewMs=30001,(p:any)=>p.pcrDisplay.NIFTY.source='TEST_ONLY',(p:any)=>p.pcrDisplay.NIFTY.sourceMinAt=iso(start-31000),(p:any)=>p.pcrDisplay.NIFTY.sourceMaxAt=iso(start+6000),(p:any)=>p.pcrDisplay.NIFTY.expiry='2026-10-30',(p:any)=>p.snapshot.indices[0].expiry='2026-02-30',(p:any)=>p.snapshot.indices.push({...p.snapshot.indices[0]}),(p:any)=>p.pcrDisplay.NIFTY.cycleStartedAt=iso(start+1000)];
 for(const mutate of mutations){const p=fixture();p.snapshot.indices[0].fullPcr=987.654;mutate(p);const view=derive(p);assert.equal(view.rows[0].value,null);assert.equal(view.alignment,'WAIT');assert(!render(view).includes('987.654'));}
});
test('live values remain independent when a different index is unavailable; real zero PCR is retained',()=>{
 const p=fixture(0,[0,1.2,1.4]);delete p.pcrDisplay.SENSEX;const v=derive(p);assert.equal(v.rows[0].value,0);assert.equal(v.rows[1].value,null);assert.equal(v.rows[2].value,1.4);assert(render(v).includes('0.0000'));assert.equal(v.alignment,'WAIT');
});
test('expiry, period, runtime, disconnect, incomplete cycle or inventory change resets the comparison baseline',()=>{
 const base=derive(fixture(),null,0);
 for(const modify of [(p:any)=>{p.snapshot.indices[0].expiry='2026-10-28';p.snapshot.indices[0].expiries=['2026-10-28'];p.pcrDisplay.NIFTY.expiry='2026-10-28';},(p:any)=>p.pcrDisplay.NIFTY.periodMs=180000,(p:any)=>p.snapshot.runtimeId='new-runtime',(p:any)=>{p.pcrDisplay.NIFTY.coverage.expected=102;p.pcrDisplay.NIFTY.coverage.freshOi=102;}]){const p=fixture(60000,[1.1,1.3,1.5]);modify(p);const v=derive(p,base,100);assert.equal(v.rows[0].direction,'WAIT');assert.equal(v.alignment,'WAIT');}
 const broken=fixture(60000);broken.pcrDisplay.NIFTY.coverage.complete=false;const invalid=derive(broken,base);const recovered=derive(fixture(120000,[1.1,1.3,1.5]),invalid);assert.equal(recovered.rows[0].direction,'WAIT');
 const disconnected=derive(null,base);assert(derive(fixture(60000),disconnected).rows.every(r=>r.direction==='WAIT'));
});
test('different baseline/current cycles, periods or cross-index source skew cannot claim three-index alignment',()=>{
 const base=derive(fixture());
 const p=fixture(90000,[1.1,1.3,1.5]);for(const s of ['NIFTY','SENSEX']){const q=p.pcrDisplay[s];q.cycleStartedAt=iso(start+60000);q.checkedAt=iso(start+60000);q.sourceMinAt=q.checkedAt;q.sourceMaxAt=q.checkedAt;}
 const v=derive(p,base);assert(v.rows.every(r=>r.direction==='UP'));assert.equal(v.alignment,'TIME_MISMATCH');
 const skew=fixture(60000,[1.1,1.3,1.5]);skew.pcrDisplay.NIFTY.sourceMinAt=iso(start+30000);skew.pcrDisplay.NIFTY.sourceMaxAt=iso(start+30000);skew.pcrDisplay.SENSEX.sourceMaxAt=iso(start+65000);assert.equal(derive(skew,base).alignment,'TIME_MISMATCH');
});
test('out-of-order, mutated same-cycle snapshots and skipped periods cannot create arrows',()=>{
 const base=derive(fixture(60000),null,100);
 const older=fixture();assert(derive(older,base).rows.every(r=>r.value===null));
 const conflict=fixture(60000,[1.1,1.2,1.4]);assert.equal(derive(conflict,base).rows[0].value,null);
 assert.equal(derive(fixture(180000,[1.1,1.3,1.5]),base).rows[0].direction,'WAIT');
});
test('3-minute cadence compares complete snapshots on 3-minute endpoints and clears old samples',()=>{
 const base=derive(fixture(0,[1,1.2,1.4],180000));assert.equal(derive(fixture(180000,[1.1,1.3,1.5],180000),base).alignment,'ALL_UP');
 const p=fixture(0,[1,1.2,1.4],180000);p.serverTime=iso(start+210001);p.snapshot.asOf=p.serverTime;assert(derive(p).rows.every(r=>r.value===null));
});
test('generated browser functions parse and chapter integration uses only the existing live event',()=>{
 const html=renderBusinessDashboardV1Html({} as any);for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);assert(html.includes('id="mb-full-pcr-strip"'));assert(html.includes('deriveLiveThreeIndexPcr(latestLive'));assert(!html.includes('/api/research/three-index-pcr'));assert(css.includes('table-layout:fixed'));assert(render(derive(fixture())).includes('ATM ±7 · 15 strikes'));
});
test('actual serialized live event updates all three PCR values and revokes them on disconnect without touching recordings',()=>{
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>(),handlers:any={};
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},getAttribute(){return null;},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},window:{addEventListener:(name:string,fn:any)=>handlers[name]=fn,dispatchEvent(){}},CustomEvent:class{},setTimeout:()=>1,clearTimeout(){},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);
 vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],ctx);
 let requests=0;const data:any={date:'2026-10-16',recordedDates:[],current:{},history:{},baseline:{},health:{}};const before=structuredClone(data);
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>data,refresh(){requests++;},memory:async()=>{}};vm.runInContext('installMarketBook(api)',ctx);
 const turn=(page:number)=>nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:String(page)}})}});
 turn(5);const recorded=nodes.get('mb-page').innerHTML;
 handlers['optionpilot:live-context']({detail:withBand(fixture())});handlers['optionpilot:live-context']({detail:withBand(fixture(60000,[1.1,1.3,1.5]),[2,1.9,1.8])});
 let content=nodes.get('mb-full-pcr-strip').innerHTML;assert(content.includes('ALL RISING'));assert(content.includes('ALL FALLING'));assert(content.includes('1.8000'));assert(content.includes('1.5000'));assert.equal(nodes.get('mb-full-pcr-strip').hidden,false);assert(!nodes.get('mb-live-context').innerHTML.includes('data-live-kind="pcr"'));assert.equal(nodes.get('mb-page').innerHTML,recorded);
 turn(9);assert.equal(nodes.get('mb-full-pcr-strip').hidden,false);assert(!nodes.get('mb-live-context').innerHTML.includes('data-live-kind="pcr"'));
 handlers['optionpilot:live-context']({detail:null});content=nodes.get('mb-full-pcr-strip').innerHTML;assert(!content.includes('1.5000'));assert(!content.includes('ALL RISING'));assert(content.includes('UNAVAILABLE'));
 turn(4);assert.equal(nodes.get('mb-full-pcr-strip').hidden,true);assert.deepEqual(data,before);assert.equal(requests,0);
});
function withBand(p:any,values=[2.1,2,1.9]){
 for(const [i,symbol] of symbols.entries()){const q=p.pcrDisplay[symbol];q.bandPcr={state:'COMPLETE',value:values[i],halfWidth:7,strikeCount:15,expected:30,freshOi:30,anchorStrike:24000,fromStrike:23650,toStrike:24350,ceTotal:200,peTotal:values[i]*200,anchorAt:q.checkedAt};}return p;
}
test('compact ladder shows full and band PCR separately; opposite alignments are retained without scope mixing',()=>{
 const base=derive(withBand(fixture()),null,0);const next=derive(withBand(fixture(60000,[1.1,1.3,1.5]),[2,1.9,1.8]),base,200);
 assert.equal(next.alignment,'ALL_UP');assert.equal(next.bandAlignment,'ALL_DOWN');assert(next.rows.every(r=>r.bandDirection==='DOWN'));
 const html=render(next,200);assert.equal((html.match(/<tr data-pcr-index=/g)||[]).length,3);assert.equal((html.match(/data-pcr-metric="full"/g)||[]).length,3);assert.equal((html.match(/data-pcr-metric="band"/g)||[]).length,3);assert(html.includes('ATM ±7 · 15 strikes'));assert.equal((html.match(/<summary>/g)||[]).length,1);
});
test('band scope, anchor and ratio validation is independent of a valid full PCR',()=>{
 for(const modify of [(b:any)=>b.halfWidth=3,(b:any)=>b.strikeCount=7,(b:any)=>b.freshOi=29,(b:any)=>b.peTotal=-1,(b:any)=>b.peTotal=10000,(b:any)=>b.value=999,(b:any)=>b.fromStrike=b.anchorStrike,(b:any)=>b.anchorAt=iso(start-31000)]){const p=withBand(fixture());modify(p.pcrDisplay.NIFTY.bandPcr);const v=derive(p);assert.equal(v.rows[0].value,1);assert.equal(v.rows[0].bandValue,null);}
 const p=withBand(fixture());p.pcrDisplay.NIFTY.bandPcr.peTotal=0;p.pcrDisplay.NIFTY.bandPcr.value=0;assert.equal(derive(p).rows[0].bandValue,0);
});
test('new ATM resets only band comparison; same-cycle band mutation revokes only its displayed value',()=>{
 const base=derive(withBand(fixture()),null,0),p=withBand(fixture(60000,[1.1,1.3,1.5]),[2,1.9,1.8]);
 p.pcrDisplay.NIFTY.bandPcr.anchorStrike+=50;p.pcrDisplay.NIFTY.bandPcr.fromStrike+=50;p.pcrDisplay.NIFTY.bandPcr.toStrike+=50;
 const next=derive(p,base,200);assert.equal(next.alignment,'ALL_UP');assert.equal(next.bandAlignment,'WAIT');assert.equal(next.rows[0].bandValue,2);assert.equal(next.rows[0].bandDirection,'WAIT');
 p.pcrDisplay.NIFTY.bandPcr.value=1.5;p.pcrDisplay.NIFTY.bandPcr.peTotal=300;const changed=derive(p,next,300);assert.equal(changed.rows[0].value,1.1);assert.equal(changed.rows[0].bandValue,null);
});
test('three-index band alignment also requires synchronized ATM source times at both endpoints',()=>{
 const p=withBand(fixture());p.pcrDisplay.NIFTY.bandPcr.anchorAt=iso(start-30000);p.pcrDisplay.SENSEX.bandPcr.anchorAt=iso(start+5000);
 const base=derive(p);assert(base.rows.every(r=>r.bandValue!==null));const next=derive(withBand(fixture(60000,[1.1,1.3,1.5]),[2,1.9,1.8]),base);assert.equal(next.alignment,'ALL_UP');assert.equal(next.bandAlignment,'TIME_MISMATCH');
});

test('recorded PCR strip keeps source proof, exact expiry, gaps and backward seeks',async()=>{
 const {deriveRecordedThreeIndexPcr:deriveRecorded}=await import('../live-three-index-pcr.js');
 const state:any={date:'2026-10-16',current:Object.fromEntries(symbols.map((s,i)=>[s,{chain:[0,180000,360000].map((n,j)=>({symbol:s,expiry:expiries[i],minute_bucket:iso(start+n),truth_verdict:'TRUE',full_pcr_source:'Exact archived full-chain source',full_chain_oi_pcr:1+j*.1}))}]))};
 const first=deriveRecorded(state,iso(start+180000),null,100);assert.equal(first.alignment,'SYNC');assert(first.rows.every(r=>r.value===1.1&&r.direction==='UP'&&r.blinkUntil===0));
 const next=deriveRecorded(state,iso(start+360000),first,200);assert(next.rows.every(r=>r.blinkUntil===2000));
 assert(deriveRecorded(state,iso(start+180000),next,300).rows.every(r=>r.blinkUntil===0));
 state.current.SENSEX.chain[2].full_pcr_source='unverified';assert.equal(deriveRecorded(state).rows[1].value,null);
 state.current.NIFTY.chain.splice(1,1);assert.equal(deriveRecorded(state).rows[0].direction,'WAIT');
 state.current.BANKNIFTY.chain.push({...state.current.BANKNIFTY.chain[2]});assert.equal(deriveRecorded(state).rows[2].value,null);
});
