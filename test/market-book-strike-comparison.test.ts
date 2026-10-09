import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { deriveMarketBook } from '../market-book-model.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';

const date='2026-10-09', expiry='2026-10-13', other='2026-10-20';
function fixture() {
 const market=[0,3].map(min=>({symbol:'NIFTY',minute_bucket:new Date(Date.parse(date+'T05:00:00Z')+min*60000).toISOString(),truth_verdict:'TRUE',spot_ltp:22080}));
 const options=market.flatMap((m,i)=>[22000,22100].flatMap(strike=>['CE','PE'].map(option_type=>({...m,expiry,strike,option_type,ltp:(strike===22000?100:50)+i*10,oi:1000+i*100,pdh:150,pdl:25}))));
 return {market,options,chain:[]};
}
const derive=(current=fixture(),extra:any={})=>deriveMarketBook({symbol:'NIFTY',tradeDate:date,recordedDates:[date],current,window:'3m',strike:22000,compareStrike:22100,...extra});

test('different strikes retain exact CE/PE prices and interval changes',()=>{
 const m=derive();assert.equal(m.ce.value,110);assert.equal(m.comparison!.ce.value,60);
 assert.equal(m.ce.delta,10);assert.equal(m.comparison!.ce.delta,10);
 assert.equal(m.comparison!.pe.strike,22100);assert.equal(m.comparison!.pe.expiry,expiry);
 assert.equal(m.comparison!.ce.at,m.ce.at);
});
test('missing second-strike side or baseline never borrows another contract',()=>{
 const c=fixture();c.options=c.options.filter(r=>!(r.strike===22100&&(r.option_type==='PE'||r.minute_bucket===c.market[0].minute_bucket)));
 const m=derive(c);assert.equal(m.comparison!.pe.value,null);assert.equal(m.comparison!.ce.from,null);
 assert.equal(m.comparison!.ce.percent,null);assert.equal(m.comparison!.ce.value,60);
 assert.equal(derive(c,{compareStrike:22500}).comparison,null);
});
test('strike choices include both independently chosen expiries with missing opposite sides explicit',()=>{
 const c=fixture();c.options=c.options.filter(r=>r.strike===22000);
 c.options.push(...c.options.filter(r=>r.option_type==='PE').map(r=>({...r,expiry:other,strike:22200,ltp:44})));
 const m=derive(c,{oppositeExpiry:other,compareStrike:22200});
 assert.deepEqual(m.strikes,[22000,22200]);assert.equal(m.comparison!.ce.value,null);
 assert.equal(m.comparison!.pe.value,44);assert.equal(m.comparison!.pe.expiry,other);
});
test('chapter controls compare, preserve selection on refresh, and reset across index/date changes',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0,open:false,showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const state:any={date,recordedDates:[date],current:{NIFTY:fixture()},history:{},baseline:{},health:{},stocks:{},sectors:null};
 let requests=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{}};
 vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);
 const page=nodes.get('mb-page');nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'2'}})}});
 page.onchange({target:{id:'mb-primary-strike',value:'22000'}});
 page.onchange({target:{id:'mb-compare-strike',value:'22100'}});
 assert(page.innerHTML.includes('Strike A vs B'));assert(page.innerHTML.includes('B · 22100 CE'));
 assert(page.innerHTML.includes('Strike B · 22100 · show CE / PE charts'));
 assert(html.includes('position:sticky;top:var(--mb-header-offset'));assert(html.includes('aria-labelledby="mb-chart-title"'));assert(page.innerHTML.includes('Pivots · OFF'));assert(page.innerHTML.includes('15m H / L · OFF'));assert(!page.innerHTML.includes('>15m H* '));
 const chartClick=(dataset:any)=>page.onclick({target:{closest:(selector:string)=>selector==='[data-level-toggle]'&&dataset.levelToggle||selector==='[data-expand-chart]'&&dataset.expandChart?{dataset}:null}});
 chartClick({levelToggle:'opening'});assert(page.innerHTML.includes('15m H / L · ON'));
 const identity='NIFTY|'+expiry+'|22000|CE';chartClick({expandChart:identity});
 const dialog=nodes.get('mb-chart-dialog');assert.equal(dialog.open,true);assert(nodes.get('mb-chart-title').textContent.includes('22000 CE'));
 assert(nodes.get('mb-chart-body').innerHTML.includes('PDH / PDL · ON'));
 dialog.onclick({target:{closest:(selector:string)=>selector==='[data-level-toggle]'?{dataset:{levelToggle:'levels'}}:null}});
 assert(nodes.get('mb-chart-body').innerHTML.includes('PDH / PDL · OFF'));
 state.current.NIFTY=fixture();state.current.NIFTY.options.find((r:any)=>r.strike===22000&&r.option_type==='CE'&&r.minute_bucket.endsWith('03:00.000Z'))!.ltp=123;vm.runInContext('installed.render()',ctx);assert.equal(dialog.open,true);assert(nodes.get('mb-chart-body').innerHTML.includes('123'));
 nodes.get('mb-chart-close').onclick();assert.equal(dialog.open,false);
 assert.equal(nodes.get('mb-pinned-compare').value,'22100');
 nodes.get('mb-pinned-compare').value='';nodes.get('mb-pinned-compare').onchange();assert(!page.innerHTML.includes('Strike A vs B'));
 nodes.get('mb-pinned-compare').value='22100';nodes.get('mb-pinned-compare').onchange();
 state.current.NIFTY=fixture();vm.runInContext('installed.render()',ctx);
 assert(page.innerHTML.includes('value="22100" selected'));assert.equal(requests,0);
 page.onclick({target:{closest:()=>({})}});assert.equal(nodes.get('mb-strike').value,22100);
 assert(!page.innerHTML.includes('Strike A vs B'));
 page.onchange({target:{id:'mb-premium-view',value:'EXPIRY'}});
 assert(page.innerHTML.includes('Fourth expiry unavailable'));assert(page.innerHTML.includes('data-expand-chart="NIFTY|'+expiry+'|22100|CE"'));
 assert(page.innerHTML.includes('Pivots · OFF'));
 nodes.get('mb-next').onclick();assert(page.innerHTML.includes('<h2>Futures</h2>'));
 nodes.get('mb-prev').onclick();assert(page.innerHTML.includes('<h2>Premium comparison</h2>'));
 nodes.get('mb-index').value='SENSEX';nodes.get('mb-index').onchange();
 assert(!page.innerHTML.includes('Strike A vs B'));assert(!page.innerHTML.includes('undefined'));
});


test('unified strike rows use one expiry for both sides and exact level distances',()=>{
 const c=fixture();c.options.push(...c.options.map(r=>({...r,expiry:other,ltp:999})));
 const m=derive(c,{comparisonView:'STRIKE',oppositeExpiry:other});
 assert.equal(m.comparisonRows.length,4);assert(m.comparisonRows.every(r=>r.p.expiry===expiry));
 const a=m.comparisonRows[0];assert.equal(a.distance.pdhDelta,-40);assert.equal(a.distance.pdlDelta,85);
 assert(Math.abs(a.distance.pdhPercent!-(-40/150*100))<1e-9);assert(Math.abs(a.distance.pdlPercent!-340)<1e-9);
 assert.equal(m.graphPairs.CE.aligned,true);assert.equal(m.graphPairs.PE.aligned,true);
 assert(m.graphPairs.PE.series.every(s=>s.label.includes(expiry)));
});
test('expiry scope compares actual identities, preserves missing sides and ties',()=>{
 const c=fixture();c.options.push(...c.options.map(r=>({...r,expiry:other})));
 const m=derive(c,{comparisonView:'EXPIRY',oppositeExpiry:other,expiryScope:'PAIR'});
 assert.equal(m.comparisonRows.length,4);assert.deepEqual(m.comparisonRows.map(r=>r.p.expiry),[expiry,expiry,other,other]);
 assert(m.observedChanges.every(o=>o.aligned&&o.leaders.length===2));
 assert.equal(m.graphPairs.CE.aligned,true);assert.notEqual(m.graphPairs.CE.series[0].identity,m.graphPairs.CE.series[1].identity);
 c.options=c.options.filter(r=>!(r.expiry===other&&r.option_type==='PE'));
 const missing=derive(c,{comparisonView:'EXPIRY',oppositeExpiry:other});
 assert.equal(missing.comparisonRows.find(r=>r.p.expiry===other&&r.p.type==='PE')!.p.value,null);
 assert.equal(missing.graphPairs.PE.aligned,false);assert.equal(missing.observedChanges[1].aligned,false);
});
test('shared graph percentages start at exact baseline and never substitute absent B',()=>{
 const m=derive(fixture(),{comparisonView:'STRIKE'});
 assert.deepEqual(m.graphPairs.CE.series.map(s=>s.points[0].percent),[0,0]);
 assert.deepEqual(m.graphPairs.CE.series.map(s=>s.points.at(-1)!.rupees),[110,60]);
 assert.equal(derive(fixture(),{comparisonView:'STRIKE',compareStrike:null}).graphPairs.PE.aligned,false);
 const c=fixture();c.options=c.options.filter(r=>!(r.strike===22100&&r.minute_bucket===c.market[0].minute_bucket));
 assert.equal(derive(c,{comparisonView:'STRIKE'}).graphPairs.CE.aligned,false);
 assert.equal(derive(c,{comparisonView:'STRIKE'}).observedChanges[0].aligned,false);
});
test('invalid levels and zero baseline cannot fabricate distances or normalized movements',()=>{
 const c=fixture();c.options.forEach(r=>{r.pdh=0;r.pdl=null as any;if(r.minute_bucket===c.market[0].minute_bucket)r.ltp=0;});
 const m=derive(c,{comparisonView:'STRIKE'});
 assert(m.comparisonRows.every(r=>r.distance.pdhDelta===null&&r.distance.pdlDelta===null&&r.distance.state==='Levels unavailable'));
 assert.equal(m.graphPairs.CE.aligned,false);assert.equal(m.observedChanges[0].aligned,false);
});
test('same-identity expiry A/B graph and mismatched endpoint comparisons stay unavailable',()=>{
 const c=fixture();c.options.push(...c.options.map(r=>({...r,expiry:other,minute_bucket:new Date(Date.parse(r.minute_bucket)+60000).toISOString()})));
 assert.equal(derive(c,{comparisonView:'EXPIRY',oppositeExpiry:expiry}).graphPairs.CE.aligned,false);
 assert.equal(derive(c,{comparisonView:'EXPIRY',oppositeExpiry:other}).graphPairs.CE.aligned,false);
});
