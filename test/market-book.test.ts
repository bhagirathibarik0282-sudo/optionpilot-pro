import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {deriveMarketBook as book,derivePremiumBreakConsensus as consensus} from '../market-book-model.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
const symbol='NIFTY',expiry='2026-10-13',tradeDate='2026-10-08',recordedDates=['2026-10-05','2026-10-06','2026-10-07','2026-10-08'];
const at=(min:number,day=tradeDate)=>new Date(Date.parse(day+'T03:45:00Z')+min*60000).toISOString();
function fixture(){const market=[0,3,6,9,12,15,18].map(min=>({symbol,minute_bucket:at(min),truth_verdict:'TRUE',spot_ltp:22000+min,spot_high:22050,spot_low:21950,pdh:22015,pdl:21980,future_ltp:22010+min,india_vix:15+min/100}));const options=market.flatMap(m=>['CE','PE'].map(type=>({symbol,expiry,expiry_bucket:'CURRENT',strike:22000,option_type:type,truth_verdict:'TRUE',minute_bucket:m.minute_bucket,ltp:type==='CE'?100+(m.spot_ltp-22000):100-(m.spot_ltp-22000),iv:18,oi:1000+(m.spot_ltp-22000)*10,pdh:110,pdl:90,day_high:125,day_low:75})));const chain=market.map(m=>({symbol,expiry,minute_bucket:m.minute_bucket,truth_verdict:'TRUE',full_chain_oi_pcr:1.1,full_pcr_source:'Exact archived full-chain source',call_wall_strike:22100,call_wall_oi:1000,put_wall_strike:21900,put_wall_oi:1200}));return {market,options,chain};}
const run=(current=fixture(),extra:any={})=>book({current,symbol,tradeDate,recordedDates,window:'3m',...extra});
test('Research tables retain separate recorded identities and missing evidence without inventing PCR or futures levels',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=html.match(/<script>([\s\S]*?)<\/script>/)![1];
 const nodes=new Map<string,any>();for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 const current=fixture();current.chain.forEach(r=>{r.full_chain_oi_pcr=9.8765;r.full_pcr_source='Unverified source';});
 current.market.forEach(r=>{r.pdh=21900;r.pdl=22100;});
 current.options.forEach(r=>{r.pdh=80;r.pdl=90;});
 const state={date:tradeDate,recordedDates,current:{NIFTY:current},history:{},baseline:{},health:{},stocks:{},sectors:null,cash:null};
 let requests=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{requests++;}};
 vm.runInContext('installMarketBook(api)',ctx);
 const output=nodes.get('mb-page').innerHTML;
 assert.equal((output.match(/class="mb-research-section"/g)||[]).length,7);
 for(const label of ['Spot &amp; Futures · recorded levels','PCR &amp; OI walls · recorded context','Premiums · exact recorded contracts','NIFTY Spot','NIFTY Futures','SENSEX Spot','BANKNIFTY Futures','22000 CE','22000 PE',expiry,'Window endpoints · IST'])assert(output.includes(label),label);
 const pcr=output.match(/aria-label="PCR &amp; OI walls · recorded context">([\s\S]*?)<\/section>/)![1];
 assert(!pcr.includes('9.8765'));assert(pcr.includes('Unavailable'));assert(pcr.includes('Unverified source'));
 const future=output.match(/<tr><td[^>]*>NIFTY Futures<\/td>([\s\S]*?)<\/tr>/)![1];
 for(const label of ['PDH','PDC','PDL','First 15m sampled H / L'])assert(future.includes('data-op-label="'+label+'">Unavailable'));
 const tables=output.split('<details class="mb-event" data-event-key="research-overview-cards">')[0];
 assert(tables.includes('Recorded DTE'));assert(!tables.includes('Calendar DTE'));
 assert(tables.includes('not exchange candle extremes'));
 assert(!/data-op-label="PD[HL]">(?!Unavailable)/.test(tables),'contradictory spot/premium levels withheld');
 assert(output.includes('first 1 of 1 available recorded expiries'));
 assert(!output.includes('NaN'));assert(!output.includes('undefined'));assert.equal(requests,0);
});
test('Research participation loads only on click and rejects future, stale and duplicate quote evidence',async()=>{
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>();
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const receipt=new Date(Date.parse(at(18))-1000).toISOString(),quoteAt=new Date(Date.parse(receipt)-1000).toISOString();
 const row=(name:string,price:number,extra:any={})=>({name,symbol:'NSE:'+name,price,previousClose:100,exchangeTimestamp:quoteAt,weight:99,contribution:999,...extra});
 const snapshot:any={source:'SERVER_BACKGROUND_KITE_QUOTES',tradingDate:tradeDate,timestamp:receipt,
  stocks:{NIFTY:[row('<Gain>',105),row('Loss',95),row('Stale',110,{exchangeTimestamp:at(15)}),row('Dup',150),row('Dup',160)]},
  sectors:[row('Broad proxy',102),row('Missing price',0)]};
 let requests=0;
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math,AbortSignal,
  fetch:async(url:string)=>{requests++;assert.equal(url,'/api/research/background-quotes/history?date='+tradeDate);return {ok:true,json:async()=>({date:tradeDate,snapshots:[snapshot,{...snapshot,timestamp:at(21),stocks:{NIFTY:[row('Future leak',200)]}}],truncated:false})};}};
 vm.createContext(ctx);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],ctx);
 const state:any={date:tradeDate,recordedDates,current:{NIFTY:fixture()},history:{},baseline:{},health:{}};
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){throw Error('No broker refresh');},memory:async()=>{}};
 vm.runInContext('globalThis.book=installMarketBook(api)',ctx);assert.equal(requests,0);
 const click=()=>nodes.get('mb-page').onclick({target:{closest:(selector:string)=>selector==='[data-agreement-load]'?{}:null}});
 click();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);
 const output=nodes.get('mb-page').innerHTML;
 const stocks=output.match(/aria-label="Tracked heavyweights">([\s\S]*?)<\/section>/)![1];
 assert(stocks.includes('&lt;Gain&gt;'));assert(!stocks.includes('<Gain>'));assert(stocks.includes('+5%'));assert(stocks.includes('-5%'));
 assert(!output.includes('Future leak'));assert(stocks.includes('Ambiguous identity'));assert(stocks.includes('Quote time / prices unavailable'));
 assert(!stocks.includes('>150<'));assert(!stocks.includes('>160<'));assert(!stocks.includes('>110<'));
 assert(!stocks.includes('>99<'));assert(!stocks.includes('>999<'));assert(output.includes('not selected-index sector weights'));
 snapshot.timestamp=at(6);click();await new Promise(resolve=>setImmediate(resolve));
 assert(!nodes.get('mb-page').innerHTML.includes('&lt;Gain&gt;'),'old receipt outside six minutes withheld');
});
test('Research notable events reuse exact event contracts, filter categories and retain missing forward targets',()=>{
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>();
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};
 vm.createContext(ctx);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],ctx);
 const current=fixture();current.options.push(...current.options.filter(r=>r.option_type==='CE').map(r=>({...r,strike:22100})));
 current.chain.forEach((r,i)=>{r.full_chain_oi_pcr=1+i/10;});
 const state={date:tradeDate,recordedDates,current:{NIFTY:current},history:{},baseline:{},health:{}};
 let requests=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{requests++;}};
 vm.runInContext('globalThis.book=installMarketBook(api)',ctx);
 const section=()=>nodes.get('mb-page').innerHTML.match(/aria-label="Recorded notable events">([\s\S]*?)<\/section>/)![1];
 assert(section().includes('retrospective research'));assert(section().includes('latest 10 retained per category'));assert(section().includes('no O=H, RAG match or probability is inferred'));
 nodes.get('mb-page').onchange({target:{id:'mb-notable-filter',value:'PREMIUM'}});
 assert(section().includes('22100 CE'));assert(section().includes('NIFTY '+expiry+' 22100 CE / PE'));
 assert(section().includes('Unavailable: event premium missing'));assert(section().includes('Unavailable: target record missing')||section().includes('Pending beyond latest recording'));
 nodes.get('mb-page').onchange({target:{id:'mb-notable-filter',value:'OI'}});
 const filtered=section();assert(filtered.includes('OI adding'));assert(!filtered.includes('22100 CE ABOVE PDH'));assert(filtered.includes('value="OI" selected'));
 vm.runInContext('book.render()',ctx);assert(section().includes('value="OI" selected'));assert.equal(requests,0);
});
test('Research memory keeps exact prior contract references and opens the shared Recorder without loading or playback',()=>{
 const html=renderBusinessDashboardV1Html({} as any),nodes=new Map<string,any>();
 for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 let timers=0,requests=0;
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math,setTimeout(){timers++;return 1;},clearTimeout(){}};
 vm.createContext(ctx);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],ctx);
 const prior=fixture();for(const kind of ['market','options','chain'] as const)prior[kind].forEach(r=>r.minute_bucket=r.minute_bucket.replace(tradeDate,'2026-10-07'));
 prior.options=prior.options.filter(r=>r.option_type==='CE');prior.options.forEach(r=>{r.ltp=77;});
 prior.options.push(...prior.options.map(r=>({...r,option_type:'PE',strike:22100,ltp:999})));
 const state={date:tradeDate,recordedDates,current:{NIFTY:fixture()},history:{},baseline:{NIFTY:prior},health:{}};
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{requests++;}};
 vm.runInContext('installMarketBook(api)',ctx);
 const memory=nodes.get('mb-page').innerHTML.match(/aria-label="Recorder memory and replay">([\s\S]*?)<\/section>/)![1];
 assert(memory.includes('CE · NIFTY '+expiry+' 22000'));assert(memory.includes('>77<'));assert(!memory.includes('>999<'));
 const pe=memory.match(/<tr><td[^>]*>PE · NIFTY[^<]*<\/td>([\s\S]*?)<\/tr>/)![1];assert(pe.includes('data-op-label="Prior recorded value">Unavailable'));
 assert(memory.includes('Historical matches / probability: unavailable.'));assert(memory.includes('not official closes or historical matches'));
 nodes.get('mb-page').onclick({target:{closest:(selector:string)=>selector==='[data-research-replay]'?{}:null}});
 assert.equal(nodes.get('mb-tools').open,true);assert.equal(nodes.get('recorded-replay').open,true);
 assert(nodes.get('rr-status').textContent.includes('Paused'));assert.equal(timers,0);assert.equal(requests,0);
 assert.equal((html.match(/id="recorded-replay"/g)||[]).length,1);
});
test('monthly premium board uses every recorded month expiry and preserves exact missing contracts',()=>{
 const c=fixture();const base=[...c.options];for(const expiry of ['2026-10-14','2026-10-15','2026-10-19','2026-10-27','2026-11-24'])c.options.push(...base.map(r=>({...r,expiry})));
 const b=run(c,{boardMonth:'2026-10',boardStrike:22000}).monthlyPremiumBoard;assert.equal(b.expiries.length,5);assert.equal(b.rows.length,10);assert(b.rows.every(r=>r.premium.expiry.startsWith('2026-10')));
 const missing=run(c,{boardMonth:'2026-10',boardStrike:22100}).monthlyPremiumBoard;assert.equal(missing.strike,22100);assert(missing.rows.every(r=>r.premium.value===null&&!r.fresh));
 assert.equal(run(c,{boardMonth:'2026-12'}).monthlyPremiumBoard.rows.length,0);
});
test('monthly board keeps stale contracts neutral and requires each exact opening sample',()=>{
 const c=fixture();c.options=c.options.filter(r=>!(r.option_type==='CE'&&r.minute_bucket===at(6)));c.options.push({...c.options[0],minute_bucket:at(7)});
 let b=run(c).monthlyPremiumBoard;assert.equal(b.rows.find(r=>r.premium.type==='CE')!.refs.H15,null);assert.equal(b.rows.find(r=>r.premium.type==='PE')!.refs.H15,100);
 c.options=c.options.filter(r=>!(r.option_type==='PE'&&r.minute_bucket===at(18)));b=run(c).monthlyPremiumBoard;assert.equal(b.rows.find(r=>r.premium.type==='PE')!.fresh,false);
 c.options.forEach(r=>{r.pdh=0;r.pdl=-1;});b=run(c).monthlyPremiumBoard;assert(b.rows.every(r=>r.refs.PDH===null&&r.refs.PDL===null));
});
test('monthly board Fibonacci uses only exact previous-session same-contract close',()=>{
 const prior=fixture();prior.options=[{...prior.options[0],minute_bucket:'2026-10-07T10:00:00Z',day_high:120,day_low:80,ltp:100}];
 let b=run(fixture(),{history:[prior]}).monthlyPremiumBoard;assert.equal(b.rows[0].refs.P,100);assert.equal(b.rows[0].refs.R1,115.28);assert.equal(b.rows[1].refs.P,null);
 prior.options[0].expiry='2026-10-19';b=run(fixture(),{history:[prior]}).monthlyPremiumBoard;assert.equal(b.rows[0].refs.P,null);
});
test('monthly board index strikes, month and Fibonacci selection survive rerenders without new requests',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();
 for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const bank=fixture();for(const kind of ['market','options','chain'] as const)bank[kind].forEach(r=>r.symbol='BANKNIFTY');
 const state={date:tradeDate,recordedDates,current:{NIFTY:fixture(),BANKNIFTY:bank},history:{},baseline:{},health:{}};ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);
 const page=nodes.get('mb-page');nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'7'}})}});assert(page.innerHTML.includes('Month-wise premium references'));
 page.onchange({target:{id:'mb-board-strike',value:'22100'}});ctx.installed.render();assert(page.innerHTML.includes('22100 CE'));assert(page.innerHTML.includes('Unavailable / older recording'));
 page.onclick({target:{closest:(s:string)=>s==='[data-board-index]'?{dataset:{boardIndex:'BANKNIFTY'}}:null}});assert(page.innerHTML.includes('monthly observation only'));assert(page.innerHTML.includes('22000 CE'));
 page.onclick({target:{closest:(s:string)=>s==='[data-board-index]'?{dataset:{boardIndex:'NIFTY'}}:null}});assert(page.innerHTML.includes('22100 CE'));
 page.onclick({target:{closest:(s:string)=>s==='#mb-board-fib'?{}:null}});ctx.installed.render();assert(page.innerHTML.includes('Hide Fibonacci R3–S3'));assert(page.innerHTML.includes('<th>R3 ₹</th>'));
 page.onchange({target:{id:'mb-board-month',value:'2026-11'}});ctx.installed.render();assert(page.innerHTML.includes('No recorded expiry contracts in this month'));
});
test('premium behaviour rejects zero levels and uses the common positioning timestamp',()=>{const c=fixture();c.options.forEach(r=>{r.pdh=0;r.pdl=0;});c.options.push({...c.options[0],strike:22200,minute_bucket:at(15),ltp:9999});const p=run(c).premiumOverview;assert.equal(p.total,2);assert.equal(p.missingLevels,2);assert.equal(p.above,0);assert.equal(p.below,0);assert.equal(p.at,at(18));assert.equal(p.rows[0].range.complete,true);});
test('notable PCR and selected-pair OI changes require verified adjacent exact records',()=>{const c=fixture();c.chain.forEach((r,i)=>r.full_chain_oi_pcr=1+i/100);const m=run(c);assert.equal(m.notableGroups.find(g=>g.category==='PCR')!.count,6);assert.equal(m.notableGroups.find(g=>g.category==='OI')!.count,12);c.chain.forEach(r=>r.full_pcr_source='Unverified');c.options=c.options.filter(r=>r.minute_bucket!==at(9));const gap=run(c);assert.equal(gap.notableGroups.find(g=>g.category==='PCR')!.count,0);assert.equal(gap.notableGroups.find(g=>g.category==='OI')!.count,8);});
test('premium notable response retains the event strike instead of the selected strike',()=>{const c=fixture();c.options.push(...c.options.filter(r=>r.option_type==='CE').map(r=>({...r,strike:22100,ltp:r.ltp+20,pdh:130})));const e=run(c).notableGroups.find(g=>g.category==='PREMIUM')!.events.find(e=>e.strike===22100&&e.kind==='Observed crossing interval');assert(e);assert.equal(e.responseStrike,22100);assert.equal(e.responses[0].sides[0].from,132);assert.equal(e.responses[0].sides[0].value,135);assert.match(e.responses[0].sides[1].state,/event premium missing/);});
test('positioning ranks only same-time recorded strikes and retains same-contract OI baselines',()=>{const c=fixture();c.options.push(...c.options.filter(r=>r.option_type==='CE').map(r=>({...r,strike:22100,oi:r.oi*2})));c.options.push({...c.options[0],strike:22200,minute_bucket:at(15),oi:999999});const p=run(c).positioning;assert.equal(p.topCalls[0].strike,22100);assert.equal(p.topCalls.length,2);assert(Math.abs(p.topCalls[0].share!-200/3)<1e-10);assert.equal(p.topCalls[0].oi.delta,60);assert(!p.changes.some(r=>r.strike===22200));assert.equal(p.at,at(18));assert.equal(p.spot,22018);assert.match(p.scope,/returned recorded strikes/);});
test('wall persistence resets at missing buckets and migration OI never compares different strikes',()=>{const c=fixture();c.chain.splice(5,1);c.chain.at(-1)!.call_wall_strike=22150;const m=run(c,{window:'15m'});assert.equal(m.callWall.oiDelta,null);assert.equal(m.positioning.callPersistence.samples,1);assert.equal(m.positioning.putPersistence.samples,1);assert.equal(m.positioning.gaps.length,1);assert.equal(m.positioning.gaps[0].minutes,6);assert.equal(m.positioning.timeline.filter(e=>e.side==='CALL').length,0);});
test('event responses require exact event contract and exact future timestamp',()=>{const c=fixture();c.chain[4].call_wall_strike=22150;const m=run(c),e=m.positioning.timeline.find(e=>e.side==='CALL'&&e.minute_bucket===at(12));assert(e);assert.equal(e.responses[0].sides[0].value,115);assert.equal(e.responses[0].sides[1].value,85);assert.match(e.responses[1].sides[0].state,/Pending/);const gap=fixture();gap.chain[4].call_wall_strike=22150;gap.options=gap.options.filter(r=>r.minute_bucket!==at(15));const missing=run(gap).positioning.timeline.find(e=>e.side==='CALL'&&e.minute_bucket===at(12));assert.equal(missing.responses[0].sides[0].value,null);assert.match(missing.responses[0].sides[0].state,/target record missing/);});
test('multi-expiry positioning keeps exact swing expiry and unknown PCR provenance excluded',()=>{const c=fixture(),prior=fixture();for(const kind of ['market','options','chain'] as const)prior[kind].forEach(r=>r.minute_bucket=r.minute_bucket.replace(tradeDate,'2026-10-07'));prior.chain.forEach(r=>r.expiry='2026-10-19');assert.equal(run(c,{history:[prior],window:'1s'}).positioning.expiryContext[0].previousCall,null);c.chain.forEach(r=>r.full_pcr_source='Unverified');assert.equal(run(c).positioning.expiryContext[0].pcr,null);});
test('neon direction requires exact synchronized spot and opposite premiums',()=>{const m=run();assert.equal(m.bias,'CE_SUPPORTING');assert.equal(m.spot.delta,3);assert.equal(m.ce.delta,3);assert.equal(m.pe.delta,-3);const c=fixture();c.options.find(r=>r.option_type==='PE'&&r.minute_bucket===at(18))!.minute_bucket=at(17);assert.equal(run(c).bias,'UNVERIFIED');const bear=fixture();bear.market.forEach(r=>r.spot_ltp=22000-(Date.parse(r.minute_bucket)-Date.parse(at(0)))/60000);bear.options.forEach(r=>r.ltp=r.option_type==='CE'?100-(Date.parse(r.minute_bucket)-Date.parse(at(0)))/60000:100+(Date.parse(r.minute_bucket)-Date.parse(at(0)))/60000);assert.equal(run(bear).bias,'PE_SUPPORTING');});
test('five-minute missing stays missing; unknown rows cannot substitute',()=>{const c=fixture();c.market.push({...c.market[0],minute_bucket:at(13),truth_verdict:'UNKNOWN',spot_ltp:999});const m=run(c,{window:'5m'});assert.equal(m.spot.from,null);assert.equal(m.bias,'UNVERIFIED');assert.equal(m.spot.value,22018);assert.equal(run(fixture(),{window:'15m'}).spot.from,22003);});
test('cross-expiry comparisons retain exact identity without directional colour',()=>{const c=fixture();c.options.push(...c.options.filter(r=>r.option_type==='PE').map(r=>({...r,expiry:'2026-10-19',ltp:r.ltp+20})));const m=run(c,{oppositeExpiry:'2026-10-19'});assert.equal(m.pe.expiry,'2026-10-19');assert.equal(m.pe.value,102);assert.equal(m.bias,'UNVERIFIED');assert.equal(m.expiryPairs.length,2);assert(m.fourthExpiryMissing);});
test('intrinsic/extrinsic uses exact same-time spot; implied IV remains separate',()=>{const m=run();assert.equal(m.ce.intrinsic,18);assert.equal(m.ce.extrinsic,100);assert.equal(m.ce.impliedIv,18);assert.equal(m.ce.open,null);const c=fixture();c.options.find(r=>r.option_type==='CE'&&r.minute_bucket===at(18))!.ltp=5;assert.equal(run(c).ce.extrinsic,null);c.market.pop();assert.equal(run(c).ce.intrinsic,null);});
test('first 15m range requires opening coverage; gaps do not create cross events',()=>{const m=run();assert(m.spot.range.complete);assert.equal(m.spot.range.high,22012);assert.equal(m.spot.range.events[0].at,at(15));const c=fixture();c.market.shift();assert.equal(run(c).spot.range.complete,false);const gap=fixture();gap.market.splice(5,1);assert.equal(run(gap).spot.range.events.length,0);});
test('pivots require exact previous session and 15:30 endpoint',()=>{const prior=fixture();prior.market=[{...prior.market[0],minute_bucket:'2026-10-07T10:00:00Z',spot_high:22100,spot_low:21900,spot_ltp:22000}];prior.options=[{...prior.options[0],minute_bucket:'2026-10-07T10:00:00Z',day_high:120,day_low:80,ltp:100}];const m=run(fixture(),{history:[prior]});assert.equal(m.spot.pivot.P,22000);assert.equal(m.spot.pivot.R3,22200);assert.equal(m.ce.pivot.S3,60);prior.market[0].minute_bucket='2026-10-07T09:57:00Z';assert.equal(run(fixture(),{history:[prior]}).spot.pivot,null);});
test('swing exact session/contract keeps missing histories missing and blocks futures rollover',()=>{const prior=fixture();for(const kind of ['market','options','chain'] as const)prior[kind].forEach(r=>r.minute_bucket=r.minute_bucket.replace(tradeDate,'2026-10-07'));const m=run(fixture(),{history:[prior],window:'1s'});assert.equal(m.spot.from,22018);assert.equal(m.spot.points.length,2);assert.equal(m.ce.points.length,2);assert.equal(m.pcr.points.length,2);assert.equal(m.future.from,null);assert.equal(m.future.pdh,null);assert.equal(m.future.pivot,null);assert.equal(m.ce.from,118);prior.options.forEach(r=>r.expiry='2026-10-06');assert.equal(run(fixture(),{history:[prior],window:'1s'}).ce.from,null);assert.equal(run(fixture(),{history:[prior],window:'3s'}).spot.from,null);});
test('full PCR provenance and wall migration do not imply same-strike OI',()=>{const c=fixture();c.chain.at(-1)!.call_wall_strike=22150;const m=run(c);assert.equal(m.callWall.delta,50);assert.equal(m.callWall.oiDelta,null);c.chain.forEach(r=>r.full_pcr_source='Source provenance unverified');assert.equal(run(c).pcr.value,null);assert.equal(run(c).pcr.delta,null);});
test('BANKNIFTY keeps actual recorded expiry identities; relative buckets are not frequency labels',()=>{const c=fixture();for(const k of ['market','options','chain'] as const)c[k].forEach(r=>r.symbol='BANKNIFTY');assert.equal(run(c,{symbol:'BANKNIFTY'}).expiries.length,1);c.options.forEach(r=>r.expiry_bucket='MONTHLY');assert.equal(run(c,{symbol:'BANKNIFTY'}).expiries.length,1);assert.equal(run().behaviour.length,2);});
test('crossing events never bracket UNKNOWN rows or wide gaps',()=>{const c=fixture();c.options.forEach(r=>{if(r.option_type==='CE'&&r.minute_bucket===at(9))r.truth_verdict='UNKNOWN';});const m=run(c);assert.equal(m.events.filter(e=>e.minute_bucket===at(12)&&e.option_type==='CE'&&e.kind==='Observed crossing interval').length,0);assert(m.events.some(e=>e.minute_bucket===at(12)&&e.option_type==='CE'&&e.kind==='First observed outside level'));});
test('serialized production book renders every chapter and preserves selections',()=>{const html=renderBusinessDashboardV1Html({} as any),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);const nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(scripts[0],ctx);const state={date:tradeDate,recordedDates,current:{NIFTY:fixture()},history:{},baseline:{},health:{},stocks:{},sectors:null,cash:null};ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){},memory:async()=>{}};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);assert(nodes.get('mb-page').innerHTML.includes('CE-supporting'));for(let i=1;i<13;i++){nodes.get('mb-next').onclick();assert(nodes.get('mb-page').innerHTML.includes('<h2>'));assert(!nodes.get('mb-page').innerHTML.includes('undefined'));}nodes.get('mb-window').value='5m';nodes.get('mb-window').onchange();assert(nodes.get('mb-page').innerHTML.includes('Market agreement comparisons'));assert.equal((html.match(/id="market-book"/g)||[]).length,1);assert(!html.includes('min-width:540px'));nodes.get('mb-window').value='3m';nodes.get('mb-window').onchange();nodes.get('mb-next').onclick();nodes.get('mb-next').onclick();assert(nodes.get('mb-page').innerHTML.includes('viewBox="0 0 480 340"'));assert(nodes.get('mb-page').innerHTML.includes('PDH'));assert(nodes.get('mb-page').innerHTML.includes('PDL'));nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'6'}})}});assert(nodes.get('mb-page').innerHTML.includes('05 · Previous-session connection'));nodes.get('mb-page').onchange({target:{id:'mb-notable-filter',value:'OI'}});assert(nodes.get('mb-page').innerHTML.includes('value="OI" selected'));nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'7'}})}});assert(nodes.get('mb-page').innerHTML.includes('05 · Exact-expiry comparison'));assert(nodes.get('mb-page').innerHTML.includes('mb-neon-red'));assert(nodes.get('mb-page').innerHTML.includes('mb-neon-green'));assert(html.includes('mb-neon-red 1.8s'));nodes.get('mb-page').onchange({target:{id:'mb-behaviour-filter',value:'PDL'}});assert(nodes.get('mb-page').innerHTML.includes('1 of 2 returned contracts'));assert(nodes.get('mb-page').innerHTML.includes('value="PDL" selected'));nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});assert(nodes.get('mb-page').innerHTML.includes('viewBox="0 0 480 390"'));assert(nodes.get('mb-page').innerHTML.includes('Exact interval changes'));assert(nodes.get('mb-page').innerHTML.includes('Latest six paired'));assert(nodes.get('mb-page').innerHTML.includes('Spot ↑ / PCR →')); });

test('missing canonical wall fields never claim migration',()=>{const c=fixture();c.chain.forEach(r=>(r as any).call_wall_strike=null);const m=run(c);assert.equal(m.callWall.strike,null);assert.equal(m.callWall.oiDelta,null);assert.equal(m.callWall.reason,'Wall strike unavailable');assert.equal(m.positioning.callPersistence.samples,0);});

test('premium neon is contract-specific: below PDL red and recovery green',()=>{const c=fixture();const ce=c.options.filter(r=>r.option_type==='CE');ce.forEach((r,i)=>r.ltp=[100,95,88,85,91,95,99][i]);const m=run(c);assert.equal(m.ce.levelBehaviour.tone,'GREEN');assert.equal(m.ce.levelBehaviour.state,'PDL recovered');assert.equal(m.ce.levelBehaviour.since,at(12));assert.equal(m.pe.levelBehaviour.tone,'RED');assert.equal(m.pe.levelBehaviour.state,'Below PDL');assert.equal(m.premiumOverview.rows.find(r=>r.type==='CE')!.levelBehaviour.tone,'GREEN');ce.at(-1)!.ltp=89;assert.equal(run(c).ce.levelBehaviour.tone,'RED');});
test('PDH touch is green; rejection needs two exact lower samples and persists below PDH',()=>{const c=fixture();const ce=c.options.filter(r=>r.option_type==='CE');ce.forEach((r,i)=>r.ltp=[100,110,108,105,106,104,103][i]);const m=run(c);assert.equal(m.ce.levelBehaviour.tone,'RED');assert.match(m.ce.levelBehaviour.state,/2 lower samples/);assert.equal(m.ce.levelBehaviour.since,at(9));const touch=fixture();touch.options.filter(r=>r.option_type==='CE').at(-1)!.ltp=110;assert.equal(run(touch).ce.levelBehaviour.state,'At PDH');assert.equal(run(touch).ce.levelBehaviour.tone,'GREEN');c.options=c.options.filter(r=>Date.parse(r.minute_bucket)<=Date.parse(at(6)));assert.equal(run(c).ce.levelBehaviour.tone,'NEUTRAL');});
test('gaps, changed levels and UNKNOWN quotes never fabricate premium recovery or rejection',()=>{for(const mode of ['gap','level','unknown']){const c=fixture();const ce=c.options.filter(r=>r.option_type==='CE');ce.forEach((r,i)=>r.ltp=i<5?85:95);if(mode==='gap')c.options=c.options.filter(r=>r.option_type!=='CE'||r.minute_bucket!==at(12));if(mode==='level')ce.at(-1)!.pdl=92;if(mode==='unknown')ce[4].truth_verdict='UNKNOWN';assert.equal(run(c).ce.levelBehaviour.tone,'NEUTRAL',mode);}const invalid=fixture();invalid.options.forEach(r=>{r.pdh=0;r.pdl=0;});assert.equal(run(invalid).ce.levelBehaviour.tone,'NEUTRAL');invalid.options.forEach(r=>{r.pdh=80;r.pdl=90;});assert.match(run(invalid).ce.levelBehaviour.state,/invalid/);});
test('PDH rejection never migrates between expiry or strike identities',()=>{const c=fixture();c.options.push(...c.options.filter(r=>r.option_type==='CE').map((r,i)=>({...r,expiry:'2026-10-19',ltp:[100,110,108,105,106,104,103][i]})));const m=run(c);assert.equal(m.ce.levelBehaviour.tone,'GREEN');assert.equal(m.expiryPairs[1].ce.levelBehaviour.tone,'RED');});

test('spot-PCR relation requires matching exact current and baseline times',()=>{const c=fixture();c.chain.forEach((r,i)=>r.full_chain_oi_pcr=1+i/100);const p=run(c).spotPcr;assert.equal(p.ready,true);assert.equal(p.state,'Spot ↑ / PCR ↑');assert.equal(p.windows.find(r=>r.minutes===5)!.state,'Unverified');assert.equal(p.windows.find(r=>r.minutes===15)!.spotDelta,15);assert.equal(p.timeline[0].spotDelta,3);c.chain.pop();assert.equal(run(c).spotPcr.ready,false);assert.equal(run(c).spotPcr.at,null);assert.equal(run(c).spotPcr.windows[0].state,'Unverified');});
test('paired changes never bridge missing PCR provenance or recorder gaps',()=>{const c=fixture();c.chain.forEach((r,i)=>r.full_chain_oi_pcr=1+i/100);c.chain[5].full_pcr_source='Unverified';let p=run(c).spotPcr;assert.equal(p.ready,false);assert.equal(p.timeline[0].pcrDelta,null);assert.equal(p.timeline[0].state,'Unverified');c.chain.splice(5,1);p=run(c).spotPcr;assert.equal(p.timeline[0].spotDelta,null);assert.equal(p.timeline[0].pcrDelta,null);});
test('prior-session PCR context and swing comparison retain exact expiry',()=>{const prior=fixture();for(const kind of ['market','options','chain'] as const)prior[kind].forEach(r=>r.minute_bucket=r.minute_bucket.replace(tradeDate,'2026-10-07'));prior.chain.forEach(r=>r.full_chain_oi_pcr=.9);const p=run(fixture(),{history:[prior],window:'1s'}).spotPcr;assert.equal(p.priorPcr.value,.9);assert.equal(p.ready,true);prior.chain.forEach(r=>r.expiry='2026-10-19');assert.equal(run(fixture(),{history:[prior],window:'1s'}).spotPcr.ready,false);assert.equal(run(fixture(),{history:[prior]}).spotPcr.priorPcr.value,null);});

test('participation chapter keeps one relevant card and excludes unrelated quote snapshots',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const state:any={date:tradeDate,recordedDates,current:{NIFTY:fixture()},history:{},baseline:{},health:{},stocks:{NIFTY:{timestamp:'2026-10-09T03:45:00Z',stocks:[{name:'Wrong day stock',change:50}]}},sectors:null};
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){},memory:async()=>{}};vm.runInContext('installMarketBook(api)',ctx);
 nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'8'}})}});
 const page=nodes.get('mb-page').innerHTML;assert.match(page,/Market agreement comparisons/);assert.match(page,/Data incomplete/);assert(!page.includes('Wrong day stock'));assert(!page.includes('full PCR'));assert(!page.includes('data-agreement-category'));assert.equal(nodes.get('mb-live-context-shell').hidden,true);assert(!page.includes('NaN'));
});

test('structured spot-PCR view isolates selected detail, chart layers and timestamp mismatch',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const state:any={date:tradeDate,recordedDates,current:{NIFTY:fixture()},history:{},baseline:{},health:{}};let requests=0;
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{}};
 vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});
 const page=nodes.get('mb-page'),svg=()=>page.innerHTML.match(/<svg class="mb-chart" viewBox="0 0 480 390"[\s\S]*?<\/svg>/)![0];
 assert(page.innerHTML.includes('Three-index snapshot'));assert.equal((page.innerHTML.match(/selected detail<\/h3>/g)||[]).length,1);
 assert(page.innerHTML.includes('Exact pair aligned'));assert(page.innerHTML.includes('Spot level distances'));assert(svg().includes('PDH 22,015'));assert(!svg().includes('15m H'));
 page.onchange({target:{id:'mb-spot-levels',value:'NONE'}});assert(!svg().includes('PDH'));assert(!svg().includes('15m H'));assert(page.innerHTML.includes('value="NONE" selected'));
 vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('value="NONE" selected'));
 page.onclick({target:{closest:(selector:string)=>selector==='[data-spot-setting]'?{dataset:{spotIndex:'NIFTY',spotSetting:'spotOpening'}}:null}});assert(svg().includes('15m H'));assert(!svg().includes('PDH'));
 state.current.NIFTY.chain.pop();vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('Pair unverified: compare each series timestamp'));assert(!page.innerHTML.includes('Exact pair aligned'));
 nodes.get('mb-index').value='SENSEX';nodes.get('mb-index').onchange();assert(page.innerHTML.includes('SENSEX · selected detail'));assert(!page.innerHTML.includes('NIFTY · selected detail'));assert(page.innerHTML.includes('Spot / full PCR observations unavailable'));assert(!page.innerHTML.includes('undefined'));assert.equal(requests,0);
});

test('recorded swing turns require adjacent valid samples and later confirmation',()=>{
 const c=fixture(),prices=[22000,22006,22002,22008,22004,22010,22006];c.market.forEach((r,i)=>r.spot_ltp=prices[i]);c.chain.forEach((r,i)=>r.full_chain_oi_pcr=[1,1.2,1.1,1.3,1.2,1.4,1.3][i]);
 let m=run(c);assert.equal(m.spotPcr.turns.spot.length,5);assert.equal(m.spotPcr.turns.spot[0].type,'HIGH');assert.equal(m.spotPcr.turns.spot[0].at,at(3));assert.equal(m.spotPcr.turns.spot[0].confirmedAt,at(6));assert.equal(m.spotPcr.alignment,'SAME_DIRECTION');assert(!m.spotPcr.turns.spot.some(r=>r.at===at(18)));
 c.market[2].truth_verdict='UNKNOWN';m=run(c);assert(!m.spotPcr.turns.spot.some(r=>[at(3),at(6),at(9)].includes(r.at)));
 c.chain.pop();assert.equal(run(c).spotPcr.alignment,'Unavailable');
 const flat=fixture();assert.equal(run(flat).spotPcr.alignment,'FLAT');assert.equal(run(flat).spotPcr.turns.pcr.length,0);
});
test('daily sampled turns require adjacent recorded sessions, without filling absent days',()=>{
 const days=['2026-10-05','2026-10-06','2026-10-07'],history=days.map((day,i)=>{const f=fixture();f.market=[{...f.market[0],minute_bucket:at(18,day),spot_ltp:[22000,22020,22010][i]}];return f;});
 const m=run(fixture(),{history,window:'3s'});assert.equal(m.spotPcr.turns.spot[0].at,at(18,days[1]));assert.equal(m.spotPcr.turns.spot[0].confirmedAt,at(18,days[2]));
 history.splice(1,1);assert.equal(run(fixture(),{history,window:'3s'}).spotPcr.turns.spot.length,0);
});
test('three-index percentage overlay, actual units, swing toggles and full chart reuse exact data',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0,open:false,showModal(){this.open=true;},close(){this.open=false;this.onclose?.();}});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const current:any={};for(const [s,factor] of [['NIFTY',1],['SENSEX',3],['BANKNIFTY',2]] as const){const c=fixture();for(const kind of ['market','options','chain'] as const)c[kind].forEach(r=>r.symbol=s);c.market.forEach((r,i)=>r.spot_ltp=[22000,22006,22002,22008,22004,22010,22006][i]*factor);c.chain.forEach((r,i)=>r.full_chain_oi_pcr=[1,1.2,1.1,1.3,1.2,1.4,1.3][i]);current[s]=c;}
 const state:any={date:tradeDate,recordedDates,current,history:{},baseline:{},health:{}};let requests=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{}};
 vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});const page=nodes.get('mb-page');
 assert.equal((page.innerHTML.match(/independent left PCR and right spot axes/g)||[]).length,3);assert(page.innerHTML.includes('UNPROVEN: full-chain strike inventory'));assert(page.innerHTML.includes('3/3 same direction'));assert(page.innerHTML.includes('T+18m'));assert(page.innerHTML.includes('6m'));
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])page.onchange({target:{id:'mb-local-'+index+'-mode',value:'NORMALIZED'}});
 assert.equal((page.innerHTML.match(/percentage overlay/g)||[]).length,3);assert(page.innerHTML.includes('3 / 3 indices share exact baseline'));assert(page.innerHTML.includes('★ Same-direction change'));assert(page.innerHTML.includes('>SH</text>'));assert(page.innerHTML.includes('>SL</text>'));
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])page.onchange({target:{id:'mb-local-'+index+'-span',value:'WINDOW'}});assert(!page.innerHTML.split('Selected index ·')[0].includes('>SL</text>'));
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])page.onchange({target:{id:'mb-local-'+index+'-span',value:'SESSION'}});
 page.onclick({target:{closest:(s:string)=>s==='[data-expand-spot-pcr]'?{}:null}});const dialog=nodes.get('mb-chart-dialog');assert(dialog.open);assert(nodes.get('mb-chart-title').textContent.includes('three-index comparison'));assert.equal((nodes.get('mb-chart-body').innerHTML.match(/percentage overlay/g)||[]).length,3);
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])dialog.onchange({target:{id:'mb-modal-'+index+'-mode',value:'RECORDED'}});assert.equal((nodes.get('mb-chart-body').innerHTML.match(/viewBox="0 0 480 390"/g)||[]).length,3);assert(nodes.get('mb-chart-body').innerHTML.includes('66,030'));assert(nodes.get('mb-chart-body').innerHTML.includes('44,020'));
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])for(const key of ['spotTurns','pcrTurns'])dialog.onclick({target:{closest:(s:string)=>s==='[data-spot-setting]'?{dataset:{spotIndex:index,spotSetting:key}}:null}});assert(!nodes.get('mb-chart-body').innerHTML.includes('>SH</text>'));assert(nodes.get('mb-chart-body').innerHTML.includes('Spot SH / SL · OFF'));
 nodes.get('mb-chart-close').onclick();assert(!dialog.open);
 for(const index of ['NIFTY','SENSEX','BANKNIFTY'])page.onchange({target:{id:'mb-local-'+index+'-mode',value:'NORMALIZED'}});current.SENSEX.chain.pop();vm.runInContext('installed.render()',ctx);assert.equal((page.innerHTML.match(/percentage overlay/g)||[]).length,2);assert(page.innerHTML.includes('Overlay unavailable'));assert(page.innerHTML.includes('UNSYNCED / MISSING'));assert.equal(requests,0);
});

test('six-minute PCR comparisons require exact endpoints; T0 never uses missing provenance',()=>{
 const c=fixture();c.chain.forEach((r,i)=>r.full_chain_oi_pcr=1+i/10);
 let m=run(c);assert(Math.abs(m.spotPcr.windows.find(r=>r.minutes===6)!.pcrDelta!-.2)<1e-10);
 c.chain=c.chain.filter(r=>r.minute_bucket!==at(12));m=run(c);assert.equal(m.spotPcr.windows.find(r=>r.minutes===6)!.pcrDelta,null);
 c.chain[0].full_pcr_source='Unverified';m=run(c);assert.equal(m.spotPcr.session.fromAt,at(3));
 assert.equal(m.pcr.verification.coverage,null);assert.equal(m.pcr.verification.difference,null);assert.equal(m.pcr.sourceAt,null);
});

test('day change is independent of interval baseline and missing previous close fails closed',()=>{const c=fixture();c.market.forEach(r=>(r as any).spot_prev_close=22100);const m=run(c);assert.equal(m.spot.delta,3);assert.equal(m.spot.day.delta,-82);assert.equal(m.spot.day.from,22100);assert.equal(run(fixture()).spot.day.delta,null);(c.market.at(-1) as any).spot_prev_close=0;assert.equal(run(c).spot.day.percent,null);});

test('simple multi-expiry behaviour preserves locked strike and independent expiry states',()=>{
 const c=fixture(),base=[...c.options];c.options.push(...base.map(r=>({...r,expiry:'2026-10-19',ltp:r.option_type==='CE'?200-r.ltp:200-r.ltp})));
 const rows=run(c).premiumBehaviourRows;assert.equal(rows.length,2);assert.equal(rows[0].state,'CE rising · PE falling');assert.equal(rows[1].state,'PE rising · CE falling');assert(rows.every(r=>r.ce.premium.strike===22000&&r.pe.premium.strike===22000));assert.equal(rows[0].ce.levelState,'Above PDH');assert.equal(rows[0].pe.levelState,'Below PDL');
});
test('simple behaviour withholds stale pairs, missing exact baselines and invalid own levels',()=>{
 const c=fixture();c.options=c.options.filter(r=>!(r.option_type==='PE'&&r.minute_bucket===at(18)));let r=run(c).premiumBehaviourRows[0];assert.equal(r.state,'Comparison unavailable');assert.equal(r.pe.usable,false);assert.equal(r.pe.tone,'NEUTRAL');
 r=run(fixture(),{window:'5m'}).premiumBehaviourRows[0];assert.equal(r.aligned,false);assert.equal(r.state,'Comparison unavailable');
 const invalid=fixture();invalid.options.forEach(r=>{r.pdh=80;r.pdl=90;});r=run(invalid).premiumBehaviourRows[0];assert.equal(r.ce.levelState,'Levels unavailable');assert.equal(r.ce.tone,'NEUTRAL');
 const missing=fixture();missing.options=missing.options.filter(r=>r.option_type==='CE');assert.equal(run(missing).premiumBehaviourRows[0].pe.usable,false);
});
test('simple behaviour serializes in production chapter and follows selected index without new fetches',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();
 for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const c=fixture();c.options.forEach(r=>{r.pdh=116;r.pdl=84;});c.options.push(...c.options.map(r=>({...r,expiry:'2026-10-19'})));let fetches=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>({date:tradeDate,recordedDates,current:{NIFTY:c},history:{},baseline:{},health:{}}),refresh(){fetches++;}};vm.runInContext('installMarketBook(api)',ctx);
 nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'7'}})}});const page=nodes.get('mb-page');assert(page.innerHTML.includes('Premium behaviour · NIFTY · strike 22'));assert(page.innerHTML.includes('2 recorded expiries'));assert(page.innerHTML.includes('Aligned expiries · 2026-10-13 / 2026-10-19'));assert(page.innerHTML.includes('PDH BREAK ↑'));assert(page.innerHTML.includes('PDL BREAK ↓'));assert(page.innerHTML.includes('mb-premium-flash mb-up'));assert(page.innerHTML.includes('Latest event · PDH BREAK ↑'));assert(page.innerHTML.includes('Recent PDH / PDL event times'));assert(page.innerHTML.includes('Recorded session 2026-10-08'));assert(page.innerHTML.includes('CE rising · PE falling'));assert(page.innerHTML.includes('Detailed month board, all strikes &amp; history'));assert(!page.innerHTML.includes('undefined'));
 nodes.get('mb-index').value='SENSEX';nodes.get('mb-index').onchange();assert(page.innerHTML.includes('Premium behaviour · SENSEX'));assert(page.innerHTML.includes('No recorded expiry contracts.'));assert.equal(fetches,0);
});

test('premium break badges require an exact new own-level crossing and reset after the next recording',()=>{
 const c=fixture();c.options.forEach(r=>{r.pdh=116;r.pdl=84;});let r=run(c).premiumBehaviourRows[0];assert.equal(r.ce.breakEvent?.label,'PDH BREAK ↑');assert.equal(r.pe.breakEvent?.label,'PDL BREAK ↓');assert.equal(r.ce.breakEvent?.fromAt,at(15));assert.equal(r.ce.breakEvent?.at,at(18));
 assert.equal(run(fixture()).premiumBehaviourRows[0].ce.breakEvent,null);
 c.options.push(...c.options.filter(r=>r.minute_bucket===at(18)).map(r=>({...r,minute_bucket:at(21),ltp:r.option_type==='CE'?121:79})));c.market.push({...c.market.at(-1)!,minute_bucket:at(21),spot_ltp:22021});r=run(c).premiumBehaviourRows[0];assert.equal(r.ce.breakEvent,null);assert.equal(r.pe.breakEvent,null);
});
test('break alerts reject missing adjacent data, reference changes and stale sides',()=>{
 for(const mutate of [
  (c:any)=>{c.options=c.options.filter((r:any)=>r.minute_bucket!==at(15));},
  (c:any)=>{c.options.filter((r:any)=>r.minute_bucket===at(15)).forEach((r:any)=>r.pdh=117);},
  (c:any)=>{c.options=c.options.filter((r:any)=>r.minute_bucket!==at(18));}
 ]){const c=fixture();c.options.forEach(r=>{r.pdh=116;r.pdl=84;});mutate(c);const r=run(c).premiumBehaviourRows[0];assert.equal(r.ce.breakEvent,null);assert.equal(r.pe.breakEvent,null);}
});
test('expiry alignment lists every matching expiry and excludes opposite, flat, stale or unsynchronized peers',()=>{
 const c=fixture(),base=[...c.options];for(const ex of ['2026-10-19','2026-10-26','2026-10-30'])c.options.push(...base.map(r=>({...r,expiry:ex})));
 let m=run(c);assert.equal(m.premiumExpiryAlignment[0].expiries.length,4);
 c.options=c.options.filter(r=>!(r.expiry==='2026-10-30'&&r.minute_bucket===at(18)));m=run(c);assert.equal(m.premiumExpiryAlignment[0].expiries.length,3);assert(!m.premiumExpiryAlignment[0].expiries.includes('2026-10-30'));
 c.options.filter(r=>r.expiry==='2026-10-26').forEach(r=>r.ltp=200-r.ltp);m=run(c);assert.deepEqual(m.premiumExpiryAlignment[0].expiries,[expiry,'2026-10-19']);assert.equal(m.premiumExpiryAlignment.length,1);
 assert.equal(run(c,{window:'5m'}).premiumExpiryAlignment.length,0);
});

test('timestamped own-level timeline preserves break/recovery/rejection intervals after the event',()=>{
 const c=fixture();const prices=[100,89,92,110,108,105,104];c.options.filter(r=>r.option_type==='CE').forEach((r,i)=>r.ltp=prices[i]);const side=run(c).premiumBehaviourRows[0].ce;
 assert.deepEqual(side.levelTimeline.map(e=>e.label),['PDH REJECTION · 2 lower samples','PDH LOST ↓','PDL RECOVERY ↑']);assert.equal(side.levelTimeline[0].fromAt,at(9));assert.equal(side.levelTimeline[0].at,at(15));assert.equal(side.levelTimeline[2].at,at(6));assert.equal(side.breakEvent,null);
 const gap=fixture();gap.options=gap.options.filter(r=>r.minute_bucket!==at(3));gap.options.filter(r=>r.option_type==='CE').forEach((r,i)=>r.ltp=i===0?89:92);assert.equal(run(gap).premiumBehaviourRows[0].ce.levelTimeline.length,0);
});

function consensusFixture(){const models:any={};for(const symbol of ['NIFTY','SENSEX','BANKNIFTY']){const c=fixture();for(const k of ['market','options','chain'] as const)c[k].forEach(r=>r.symbol=symbol);c.options.forEach(r=>{r.pdh=116;r.pdl=84;});c.options.push(...c.options.map(r=>({...r,expiry:'2026-10-27'})));c.chain.push(...c.chain.map(r=>({...r,expiry:'2026-10-27'})));models[symbol]=run(c,{symbol});}return models;}
test('independent behaviour strikes retain exact side identity without substituting absent expiry contracts',()=>{const c=fixture();c.options.push(...c.options.filter(r=>r.option_type==='PE').map(r=>({...r,strike:22100,ltp:r.ltp+5})));const m=run(c,{behaviourCEStrike:22000,behaviourPEStrike:22100});assert.equal(m.premiumBehaviourRows[0].ce.premium.strike,22000);assert.equal(m.premiumBehaviourRows[0].pe.premium.strike,22100);assert.equal(m.premiumBehaviourRows[0].pe.premium.value,87);assert.equal(run(c,{behaviourPEStrike:22200}).premiumBehaviourRows[0].pe.premium.value,null);});
test('three-index agreement freezes VIX and expiry-specific full PCR at the exact event interval',()=>{const ms=consensusFixture(),c=consensus(ms);assert.equal(c.events.length,2);const ce=c.events.find(e=>e.side==='CE');assert.equal(ce.label,'PDH BREAK ↑');assert.equal(ce.groups.length,3);assert.equal(ce.at,at(18));assert.equal(ce.fromAt,at(15));assert(ce.contextComplete);assert.equal(ce.groups[0].vix.value,15.18);assert(ce.groups.every(g=>g.contracts.length===2));assert(ce.groups.every(g=>g.pcr.length===2&&g.pcr.every(p=>p.value===1.1)));});
test('consensus cannot promote partial expiry inventory, different side/level/timestamps or conflicting session',()=>{for(const mutate of [
 (m:any)=>{m.SENSEX.premiumBreakGroups=[];},
 (m:any)=>{m.BANKNIFTY.premiumBreakGroups.forEach(g=>g.at=at(15));},
 (m:any)=>{m.SENSEX.premiumBreakGroups.forEach(g=>g.contracts.pop());},
 (m:any)=>{m.SENSEX.tradeDate='2026-10-07';}
]){const m=consensusFixture();mutate(m);assert.equal(consensus(m).events.length,0);}
 const m=consensusFixture();m.SENSEX.premiumBreakGroups.forEach(g=>g.pcr.forEach(p=>{p.value=null;p.delta=null;}));assert(consensus(m).events.every(e=>!e.contextComplete));
});

test('serialized premium selectors preserve independent strikes across index switches and refresh',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);const current:any={};for(const symbol of ['NIFTY','SENSEX','BANKNIFTY']){const c=fixture();for(const k of ['market','options','chain'] as const)c[k].forEach(r=>r.symbol=symbol);c.options.forEach(r=>{r.pdh=116;r.pdl=84;});c.options.push(...c.options.map(r=>({...r,expiry:'2026-10-27'})));c.chain.push(...c.chain.map(r=>({...r,expiry:'2026-10-27'})));if(symbol==='NIFTY')c.options.push(...c.options.filter(r=>r.option_type==='CE').map(r=>({...r,strike:22100,ltp:r.ltp+20,pdh:r.pdh+20,pdl:r.pdl+20})));current[symbol]=c;}
 let fetches=0;const state:any={date:tradeDate,recordedDates,current,history:{},baseline:{},health:{}};ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){fetches++;}};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'7'}})}});const page=nodes.get('mb-page');assert(page.innerHTML.includes('🚨 🚦🚦🚦 CE'));assert(page.innerHTML.includes('Premium index'));assert(page.innerHTML.includes('CE strike'));assert(page.innerHTML.includes('PE strike'));
 page.onchange({target:{id:'mb-behaviour-ce',value:'22100'}});assert(page.innerHTML.includes('strike 22100 CE / 22000 PE'));ctx.installed.render();assert(page.innerHTML.includes('strike 22100 CE / 22000 PE'));
 page.onchange({target:{id:'mb-behaviour-index',value:'SENSEX'}});assert(page.innerHTML.includes('Premium behaviour · SENSEX'));
 page.onchange({target:{id:'mb-behaviour-index',value:'NIFTY'}});assert(page.innerHTML.includes('strike 22100 CE / 22000 PE'));assert.equal(fetches,0);
 state.date='2026-10-09';ctx.installed.render();assert(!page.innerHTML.includes('strike 22100 CE / 22000 PE'));
});

test('historical consensus uses event-time context and cannot borrow later VIX or unverified full PCR',()=>{const models:any={};for(const symbol of ['NIFTY','SENSEX','BANKNIFTY']){const c=fixture();for(const k of ['market','options','chain'] as const)c[k].forEach(r=>r.symbol=symbol);c.options.forEach(r=>{r.pdh=114;r.pdl=84;});c.options.push(...c.options.map(r=>({...r,expiry:'2026-10-27'})));c.chain.push(...c.chain.map(r=>({...r,expiry:'2026-10-27'})));c.market.at(-1)!.india_vix=99;if(symbol==='SENSEX')c.chain.filter(r=>r.expiry==='2026-10-27').forEach(r=>r.full_pcr_source='Unverified');models[symbol]=run(c,{symbol});}const e=consensus(models).events.find(e=>e.side==='CE');assert(e);assert.equal(e.at,at(15));assert.equal(e.groups[0].vix.value,15.15);assert.equal(e.latest,false);assert.equal(e.contextComplete,false);assert.equal(e.groups[1].pcr.find(p=>p.expiry==='2026-10-27').value,null);});

test('unchanged health refresh preserves premium selector DOM and reuses the month board models',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);const state:any={date:tradeDate,recordedDates,current:{NIFTY:fixture()},history:{},baseline:{},health:{}};let derives=0,writes=0,markup='';Object.defineProperty(nodes.get('mb-page'),'innerHTML',{get:()=>markup,set:v=>{writes++;markup=v;}});const derive=vm.runInContext('deriveMarketBook',ctx);ctx.api={derive:(input:any)=>{derives++;return derive(input);},getState:()=>state};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'7'}})}});ctx.installed.refreshHealth();ctx.installed.refreshHealth();const before=writes,calls=derives;ctx.installed.refreshHealth();ctx.installed.refreshHealth();assert.equal(writes,before,'same recording/controls must keep the native selector node');assert.equal(derives,calls);
 nodes.get('mb-page').onchange({target:{id:'mb-behaviour-index',value:'SENSEX'}});assert(markup.includes('Premium behaviour · SENSEX'));assert(writes>before);
 state.current.SENSEX={...fixture(),market:fixture().market.map(r=>({...r,symbol:'SENSEX'})),options:fixture().options.map(r=>({...r,symbol:'SENSEX'})),chain:fixture().chain.map(r=>({...r,symbol:'SENSEX'}))};ctx.installed.refreshHealth();assert(markup.includes('Premium behaviour · SENSEX · strike 22000'));
});

test('opening references require five exact valid buckets independently for spot and qualified exact-expiry PCR',()=>{
 const c=fixture();c.chain.forEach((r,i)=>r.full_chain_oi_pcr=[1,1.2,.9,1.1,1.05,5,6][i]);
 let refs=run(c).spotPcr.opening;
 assert.equal(refs.spot.high,22012);assert.equal(refs.spot.low,22000);
 assert.equal(refs.pcr.high,1.2);assert.equal(refs.pcr.low,.9);
 assert.equal(refs.pcr.at,at(15));
 for(const mode of ['gap','unqualified','conflict','expiry','zero']){
  const f=structuredClone(c);
  if(mode==='gap')f.chain.splice(2,1);
  if(mode==='unqualified')f.chain[2].full_pcr_source='Unverified';
  if(mode==='conflict')f.chain.push({...f.chain[2],full_chain_oi_pcr:8});
  if(mode==='expiry')f.chain[2].expiry='2026-10-19';
  if(mode==='zero')f.chain[2].full_chain_oi_pcr=0;
  refs=run(f).spotPcr.opening;assert.equal(refs.pcr.complete,false,mode);assert.equal(refs.pcr.high,null);assert.equal(refs.spot.complete,true);
 }
 const early=fixture();for(const kind of ['market','options','chain'] as const)early[kind]=early[kind].slice(0,5);
 assert.equal(run(early).spotPcr.opening.spot.complete,false);
 const missing=fixture();missing.market.splice(2,1);assert.equal(run(missing).spotPcr.opening.spot.complete,false);assert.equal(run(missing).spotPcr.opening.pcr.complete,true);
});

test('individual chart controls isolate index and series, survive refresh, and render in all modes and fullscreen',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0,open:false,showModal(){this.open=true;},close(){this.open=false;}});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const current:any={};for(const s of ['NIFTY','SENSEX','BANKNIFTY']){current[s]=fixture();for(const kind of ['market','options','chain'])current[s][kind].forEach((r:any)=>r.symbol=s);}
 const state:any={date:tradeDate,recordedDates,current,history:{},baseline:{},health:{}};let requests=0;
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;},memory:async()=>{}};
 vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});
 const page=nodes.get('mb-page');
 const toggle=(target:any,index:string,key:string)=>target.onclick({target:{closest:(s:string)=>s==='[data-spot-setting]'?{dataset:{spotIndex:index,spotSetting:key}}:null}});
 const charts=(target:any)=>[...target.innerHTML.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m=>m[0]).filter(m=>m.includes('independent left PCR')||m.includes('percentage overlay')||m.includes('spot above full PCR'));
 toggle(page,'NIFTY','pcrOpening');let cs=charts(page);assert(cs[0].includes('PCR 15m H'));assert(!cs[0].includes('Spot 15m H'));assert(!cs[1].includes('15m H'));assert(!cs[2].includes('15m H'));
 toggle(page,'NIFTY','spotOpening');assert(charts(page)[0].includes('Spot 15m H'));
 for(const mode of ['NORMALIZED','RECORDED','DUAL']){page.onchange({target:{id:'mb-local-NIFTY-mode',value:mode}});cs=charts(page);assert(cs[0].includes('15m H'));assert(cs[1].includes('independent left PCR'));}
 page.onchange({target:{id:'mb-local-NIFTY-span',value:'WINDOW'}});assert(page.innerHTML.includes('id="mb-local-SENSEX-span"'));vm.runInContext('installed.render()',ctx);assert(charts(page)[0].includes('PCR 15m H'));
 const ids=[...page.innerHTML.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 page.onclick({target:{closest:(s:string)=>s==='[data-expand-spot-pcr]'?{}:null}});const dialog=nodes.get('mb-chart-dialog'),body=nodes.get('mb-chart-body');assert(charts(body)[0].includes('PCR 15m H'));
 toggle(dialog,'SENSEX','pcrOpening');assert(charts(body)[1].includes('PCR 15m H'));assert(!charts(body)[2].includes('15m H'));
 current.NIFTY.chain.splice(2,1);vm.runInContext('installed.render()',ctx);assert(!charts(body)[0].includes('PCR 15m H'));assert(charts(body)[0].includes('Spot 15m H'));assert(body.innerHTML.includes('Missing, invalid or conflicting opening'));
 nodes.get('mb-window').value='1s';nodes.get('mb-window').onchange();assert(!charts(body).some(c=>c.includes('data-opening-series')));assert(body.innerHTML.includes('Unavailable in swing endpoint view'));assert.equal(requests,0);
});


test('PCR-only expiry observations retain exact chain identity without inventing a premium ladder',()=>{
 const c=fixture(),next='2026-10-19';c.chain.push(...c.chain.map(r=>({...r,expiry:next,full_chain_oi_pcr:2})));const b=run(c,{observationExpiry:next});
 assert.equal(b.expiry,next);assert.equal(b.pcr.value,2);assert.equal(b.pcr.from,2);assert.equal(b.ce.value,null);assert.deepEqual(b.expiries,[expiry]);assert.deepEqual(b.recordedPcrExpiries,[expiry,next]);
 assert.equal(run(c,{observationExpiry:'2026-12-31'}).expiry,expiry);
 const noOptions={...c,options:[]};assert.equal(run(noOptions).expiry,expiry);assert.equal(run(noOptions,{observationExpiry:next}).pcr.value,2);
 const prior=structuredClone(c);prior.chain.forEach(r=>r.minute_bucket=r.minute_bucket.replace(tradeDate,'2026-10-07'));assert.equal(run(fixture(),{history:[prior],observationExpiry:next}).expiry,expiry);
});

test('selected and next recorded PCR charts stack on one time domain and withhold unsynchronized spreads',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();
 for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0,open:false,showModal(){this.open=true;},close(){this.open=false;}});
 const c=fixture(),next='2026-10-19';c.chain.forEach((r,i)=>r.full_chain_oi_pcr=1+i/100);c.chain.push(...c.chain.slice(2).map((r,i)=>({...r,expiry:next,full_chain_oi_pcr:2+i/100})));
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 let requests=0;const state:any={date:tradeDate,recordedDates,current:{NIFTY:c},history:{},baseline:{},health:{}};ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;}};
 vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});const page=nodes.get('mb-page');
 assert(page.innerHTML.includes('Selected expiry · '+expiry));assert(page.innerHTML.includes('Next recorded expiry · '+next));assert(page.innerHTML.includes('B − A PCR · ratio points'));assert(page.innerHTML.includes('>0.98<'));assert(page.innerHTML.includes('No later exact-expiry chain recording'));
 const charts=()=>[...page.innerHTML.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m=>m[0]).filter(s=>s.includes('independent left PCR'));let cs=charts();assert.equal(cs.length,2);
 const labels=(s:string)=>[...s.matchAll(/y="318"[^>]*>([^<]+)</g)].map(m=>m[1]);assert.deepEqual(labels(cs[0]),labels(cs[1]));
 for(const mode of ['NORMALIZED','RECORDED']){page.onchange({target:{id:'mb-local-NIFTY-mode',value:mode}});const xs=[...page.innerHTML.split('data-event-key="spot-pcr-selected-detail"')[0].matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(m=>m[0]).filter(s=>s.includes(mode==='NORMALIZED'?'percentage overlay':'spot above full PCR'));assert.equal(xs.length,2);const timeLabels=(s:string)=>[...s.matchAll(/y="(?:267|378)"[^>]*>([^<]+)</g)].map(m=>m[1]);assert.deepEqual(timeLabels(xs[0]),timeLabels(xs[1]));}page.onchange({target:{id:'mb-local-NIFTY-mode',value:'DUAL'}});
 const ids=[...page.innerHTML.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 c.chain=c.chain.filter(r=>!(r.expiry===next&&r.minute_bucket===at(18)));vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('Compare the two expiries · Missing / unsynchronized'));assert(!page.innerHTML.includes('>0.98<'));cs=charts();assert.deepEqual(labels(cs[0]),labels(cs[1]));
 c.chain.filter(r=>r.expiry===next).forEach(r=>r.full_pcr_source='Unverified');vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('Next recorded expiry · '+next));assert(!page.innerHTML.includes('Compare the two expiries · Exact buckets aligned'));assert.equal(requests,0);
});

test('failed replay is a retryable source failure, not a claim that recordings do not exist',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);let retries=0;const state={date:tradeDate,recordedDates,current:{},history:{},baseline:{},health:{NIFTY:{state:'UNAVAILABLE',message:'Timed out after retry'}}};ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){retries++;}};vm.runInContext('installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});const page=nodes.get('mb-page');assert(page.innerHTML.includes('Saved data could not be loaded'));assert(page.innerHTML.includes('Timed out after retry'));assert(!page.innerHTML.includes('NO RECORDING'));page.onclick({target:{closest:(s:string)=>s==='[data-replay-retry]'?{}:null}});assert.equal(retries,1);
});


function bandEvidenceFixture(){
 const market=[0,1,2,3].map(min=>({symbol,minute_bucket:at(min),backend_timestamp:new Date(Date.parse(at(min))+20000).toISOString(),snapshot_id:'band-'+min,spot_ltp:7800+min,truth_verdict:'TRUE',india_vix:15+min/10}));
 const ce:any={7700:1823400,7800:3448575,7900:5367450},pe:any={7700:5783025,7800:4864125,7900:2559375};
 const options=market.flatMap(m=>Array.from({length:15},(_,i)=>['CE','PE'].map(side=>({symbol,expiry,minute_bucket:m.minute_bucket,snapshot_id:m.snapshot_id,truth_verdict:'TRUE',atm_offset:i-7,strike:7450+i*50,option_type:side,oi:(side==='CE'?ce:pe)[7450+i*50]||0,quote_timestamp:new Date(Date.parse(m.minute_bucket)+19000).toISOString(),volume:1000+Number(m.minute_bucket===at(1)?1:m.minute_bucket===at(2)?2:m.minute_bucket===at(3)?3:0)*(side==='CE'?10:20),ltp:100,pdh:120,pdl:80})))).flat();
 const chain=market.map(m=>({symbol,expiry,minute_bucket:m.minute_bucket,truth_verdict:'TRUE',atm_strike:7800,full_chain_oi_pcr:1.1,full_pcr_source:'Exact archived full-chain source',max_pain:7900,call_wall_strike:7900,put_wall_strike:7700}));return {market,options,chain};
}
test('expiry context reproduces the documented payout example on the exact 15-strike band',()=>{
 const c=bandEvidenceFixture(),e=run(c,{expiryEvidence:true}).expiryEvidence!;assert.equal(e.band.latest.coverage,30);assert.equal(e.band.latest.pain,7800);assert.equal(e.band.latest.ceWall,7900);assert.equal(e.band.latest.peWall,7700);assert.equal(e.band.latest.ceOi,10639425);assert.equal(e.band.latest.peOi,13206525);assert.equal(e.band.latest.pcr,13206525/10639425);assert.equal(e.recorded.latest.pain,7900);assert.equal(e.recorded.latest.pcr,1.1);assert.equal(e.band.comparable,true);assert.equal(e.band.differences.pain,0);assert.equal(run(c).expiryEvidence,null);
 c.options.find(r=>r.minute_bucket===at(3)&&r.option_type==='PE'&&r.strike===7900)!.oi=20000000;let b=run(c,{expiryEvidence:true}).expiryEvidence!.band;assert.equal(b.differences.peWall,200);assert(b.migrations.some(r=>r.field==='peWall'&&r.from===7700&&r.to===7900&&r.at===at(3)));
 c.options.filter(r=>r.minute_bucket===at(3)).forEach(r=>r.strike+=50);c.chain[3].atm_strike+=50;b=run(c,{expiryEvidence:true}).expiryEvidence!.band;assert(b.latest.pcr>0);assert.equal(b.comparable,false);assert.equal(b.differences.pcr,null);assert(!b.migrations.some(r=>r.at===at(3)));
});
test('band evidence refuses missing/stale/future/cross-session/conflicting identities and zero denominator',()=>{
 for(const mode of ['missing','stale','future','prior','snapshot','duplicate','offset','zero','unknown-clock','skew']){const c=bandEvidenceFixture();const last=c.options.filter(r=>r.minute_bucket===at(3));
  if(mode==='missing')c.options=c.options.filter(r=>r!==last[0]);if(mode==='stale')last[0].quote_timestamp=new Date(Date.parse(c.market[3].backend_timestamp)-30001).toISOString();if(mode==='future')last[0].quote_timestamp=new Date(Date.parse(c.market[3].backend_timestamp)+5001).toISOString();if(mode==='prior')last[0].quote_timestamp=last[0].quote_timestamp.replace(tradeDate,'2026-10-07');if(mode==='snapshot')last[0].snapshot_id='other';if(mode==='duplicate')c.options.push({...last[0],oi:123});if(mode==='offset')last[0].atm_offset=0;if(mode==='zero')last.filter(r=>r.option_type==='CE').forEach(r=>r.oi=0);if(mode==='unknown-clock')c.market[3].backend_timestamp='';if(mode==='skew'){last[0].quote_timestamp=new Date(Date.parse(c.market[3].backend_timestamp)-30000).toISOString();last[1].quote_timestamp=new Date(Date.parse(c.market[3].backend_timestamp)+5000).toISOString();}
  const e=run(c,{expiryEvidence:true}).expiryEvidence!.band;assert.equal(e.latest.pcr,null,mode);assert.equal(e.latest.pain,null,mode);assert.equal(e.differences.pcr,null,mode);
 }
 const c=bandEvidenceFixture();c.options.push({...c.options[0]});assert.equal(run(c,{expiryEvidence:true}).expiryEvidence!.band.frames[0].coverage,30);
});
test('band maxima and payout ties stay explicit; a different expiry cannot supply evidence',()=>{
 const c=bandEvidenceFixture();c.options.forEach(r=>r.oi=100);let e=run(c,{expiryEvidence:true}).expiryEvidence!.band;assert.equal(e.latest.ceWall,null);assert.equal(e.latest.peWall,null);assert.equal(e.latest.ceTies.length,15);assert.equal(e.latest.pain,7800);
 c.options.filter(r=>r.minute_bucket===at(3)&&r.option_type==='PE').forEach(r=>r.expiry='2026-10-19');e=run(c,{expiryEvidence:true}).expiryEvidence!.band;assert.equal(e.latest.pain,null);assert.equal(e.latest.pcr,null);
});

test('serialized expiry context uses stacked scope buttons, exact band labels and one VIX context per index',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const c=bandEvidenceFixture(),next='2026-10-19';c.options.push(...c.options.map(r=>({...r,expiry:next})));c.chain.push(...c.chain.map(r=>({...r,expiry:next,full_chain_oi_pcr:null as any,max_pain:null as any})));const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);let requests=0;const state:any={date:tradeDate,recordedDates,current:{NIFTY:c},history:{},baseline:{},health:{}};ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state,refresh(){requests++;}};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});const page=nodes.get('mb-page');
 assert(page.innerHTML.includes('15-strike pain minimum'));assert(page.innerHTML.includes('>7,800<'));assert(page.innerHTML.includes('ATM ±7 PCR · ratio'));assert(page.innerHTML.includes('ATM ±7 OI · lakh source units'));assert(page.innerHTML.includes('1 lakh = 100,000'));assert(page.innerHTML.includes('India VIX · shared market context'));assert(page.innerHTML.includes('formula')||page.innerHTML.includes('Formula'));assert(page.innerHTML.includes('data-evidence-scope="BAND" aria-pressed="true"'));assert(!page.innerHTML.includes('undefined'));
 page.onclick({target:{closest:(s:string)=>s==='[data-evidence-scope]'?{dataset:{evidenceScope:'RECORDED',evidenceIndex:'NIFTY'}}:null}});assert(page.innerHTML.includes('Recorded max-pain estimate'));assert(page.innerHTML.includes('data-evidence-scope="RECORDED" aria-pressed="true"'));assert(!page.innerHTML.includes('aria-label="ATM ±7 PCR · ratio"'));vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('data-evidence-scope="RECORDED" aria-pressed="true"'));assert.equal(requests,0);
 state.archiveLoading=true;state.health.NIFTY={state:'PARTIAL',message:'Loading saved history 1/7 windows'};vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('<p class="mb-replay-status" role="status">PARTIAL HISTORY'));assert(page.innerHTML.includes('Requested history is incomplete'));assert(page.innerHTML.includes('<h4 class="mb-expiry-title">Selected expiry · '+expiry));assert(page.innerHTML.includes('<h4 class="mb-expiry-title">Next recorded expiry · '+next));assert(!page.innerHTML.includes('Retry saved history'));
 state.archiveLoading=false;state.health.NIFTY={state:'PARTIAL',message:'Older interval failed'};vm.runInContext('installed.render()',ctx);assert(page.innerHTML.includes('Older interval failed'));assert(page.innerHTML.includes('Retry saved history'));
});


test('one-minute and same-expiry swing evidence require their exact recorded baseline',()=>{
 const c=bandEvidenceFixture();let b=run(c,{expiryEvidence:true,window:'1m'}).expiryEvidence!.band;assert.equal(b.previous.at,at(2));assert.equal(b.differences.spot,1);
 const prior=structuredClone(c);for(const rows of [prior.market,prior.options,prior.chain])for(const r of rows){r.minute_bucket=r.minute_bucket.replace(tradeDate,'2026-10-07');if('backend_timestamp' in r)r.backend_timestamp=String(r.backend_timestamp).replace(tradeDate,'2026-10-07');if('quote_timestamp' in r)r.quote_timestamp=String(r.quote_timestamp).replace(tradeDate,'2026-10-07');}
 b=run(c,{expiryEvidence:true,window:'1s',history:[prior]}).expiryEvidence!.band;assert.equal(b.comparable,true);assert.equal(b.differences.pcr,0);assert.equal(b.frames.length,2);
 prior.options.forEach(r=>r.expiry='2026-10-19');b=run(c,{expiryEvidence:true,window:'1s',history:[prior]}).expiryEvidence!.band;assert.equal(b.comparable,false);assert.equal(b.differences.pcr,null);
});


test('band OI and traded volume use independent source fields and exact per-contract window differences',()=>{
 const c=bandEvidenceFixture();let b=run(c,{expiryEvidence:true,window:'1m'}).expiryEvidence!.band;assert.equal(b.latest.intervalCeVolume,150);assert.equal(b.latest.intervalPeVolume,300);assert.equal(b.latest.intervalVolumePcr,2);assert.equal(b.latest.ceVolume,15450);
 b=run(c,{expiryEvidence:true,window:'3m'}).expiryEvidence!.band;assert.equal(b.latest.intervalCeVolume,450);assert.equal(b.latest.intervalPeVolume,900);
 const missing=structuredClone(c);missing.options.find(r=>r.minute_bucket===at(3))!.volume=null as any;b=run(missing,{expiryEvidence:true,window:'1m'}).expiryEvidence!.band;assert.equal(b.latest.intervalVolumePcr,null);assert.equal(b.latest.ceVolume,null);assert.equal(b.latest.pcr,13206525/10639425,'missing volume does not alter observed OI');
 const reset=structuredClone(c);reset.options.find(r=>r.minute_bucket===at(3)&&r.option_type==='CE')!.volume=1;b=run(reset,{expiryEvidence:true,window:'1m'}).expiryEvidence!.band;assert.equal(b.latest.intervalCeVolume,null,'one reset cannot be hidden by other contracts increasing');assert.equal(b.latest.intervalVolumePcr,null);
 const flat=structuredClone(c);flat.options.forEach(r=>{r.volume=1000;});b=run(flat,{expiryEvidence:true,window:'1m'}).expiryEvidence!.band;assert.equal(b.latest.intervalCeVolume,0);assert.equal(b.latest.intervalPeVolume,0);assert.equal(b.latest.intervalVolumePcr,null);
 const gap=structuredClone(c);gap.market=gap.market.filter(r=>r.minute_bucket!==at(2));b=run(gap,{expiryEvidence:true,window:'1m'}).expiryEvidence!.band;assert.equal(b.latest.intervalVolumePcr,null);
});

test('replay reuses presentation formatters while reading changed source values and times',()=>{
 const html=renderBusinessDashboardV1Html({} as any),script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],nodes=new Map<string,any>();
 for(const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 let dates=0,numbers=0;const dateOptions:any[]=[];
 const intl={DateTimeFormat:function(...args:any[]){dates++;dateOptions.push(args[1]);return Reflect.construct(Intl.DateTimeFormat,args);},NumberFormat:function(...args:any[]){numbers++;return Reflect.construct(Intl.NumberFormat,args);}};
 const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},Intl:intl,Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(script,ctx);
 const current=fixture(),state={date:tradeDate,recordedDates,current:{NIFTY:current},history:{},baseline:{},health:{}};
 ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>state};vm.runInContext('globalThis.installed=installMarketBook(api)',ctx);
 nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:'9'}})}});
 const page=nodes.get('mb-page'),before=page.innerHTML,formats={dates,numbers};
 assert(dateOptions.some(o=>o?.month==='short'&&o?.day==='2-digit'),'shared chart date formatter');
 assert.equal(dateOptions.filter(o=>o?.hour==='2-digit'&&!o?.day&&!o?.second).length,1,'one shared chart clock formatter');
 assert(before.includes('22,018'));assert(before.includes('09:33 IST'));
 vm.runInContext('installed.render(true)',ctx);
 assert.equal(page.innerHTML,before);assert.deepEqual({dates,numbers},formats,'force redraw creates no per-point formatters');
 current.market.at(-1)!.spot_ltp=22018.25;
 current.market.at(-1)!.minute_bucket=at(19);
 vm.runInContext('installed.render(true)',ctx);
 assert(page.innerHTML.includes('22,018.25'));assert(page.innerHTML.includes('09:34 IST'));assert.notEqual(page.innerHTML,before,'formatted market values and times are never cached');
 assert.deepEqual({dates,numbers},formats);
});
