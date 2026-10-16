import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import { renderMarketBookReadingGuide as guide,renderMarketBookLiveContext as live } from '../market-book-reading-guide.js';
import { renderBusinessDashboardV1Html } from '../business-dashboard-v1-view.js';
const from='2026-10-16T04:00:00Z',at='2026-10-16T04:03:00Z';
const metric={from:100,value:105,delta:5,percent:5,fromAt:from,at};
const a:any={symbol:'NIFTY',tradeDate:'2026-10-16',expiry:'2026-10-19',spot:metric,pcr:{...metric,from:1,value:1.1,delta:.1,source:'Normalized full-chain source'},ce:{...metric,expiry:'2026-10-19',strike:23000,oi:{...metric,value:2000}},pe:{...metric,expiry:'2026-10-26',strike:23100,oi:{...metric,value:3000}},vix:metric,future:{...metric,oi:metric,basis:10},callWall:{from:23100,strike:23200,fromAt:from,at},putWall:{from:22900,strike:23000,fromAt:from,at}};
const state:any={stocks:{NIFTY:{timestamp:at,stocks:[{change:1},{change:-1},{change:null}]}},sectors:{timestamp:at,sectors:[{pct:1},{pct:-1},{pct:0},{pct:false},{pct:'2'}]},cash:{latestStoredSessionDate:'2026-10-15',windows:[{window:'1 session',fiiNetCrore:20,diiNetCrore:-10}]}};
const kinds=(html:string)=>[...html.matchAll(/data-reading-kind="([^"]+)"/g)].map(m=>m[1]);
test('each chapter has its own four-parameter reading order and exact source labels',()=>{
 for(let page=0;page<13;page++){const html=guide(a,state,page,'3m');assert.equal(kinds(html).length,4);assert(html.includes('selected recorded session 2026-10-16'));assert(html.includes('latest endpoint context'));assert(!html.includes('undefined'));assert(!html.includes('NaN'));}
 assert.deepEqual(kinds(guide(a,state,5,'3m')),['oi','pcr','walls','premium']);assert.deepEqual(kinds(guide(a,state,11,'3m')),['vix','spot','premium','pcr']);assert.deepEqual(kinds(guide(a,state,8,'3m')),['stocks','sectors','spot','vix']);
});
test('missing or unsupported PCR cannot become zero; CE/PE identities and cash dates remain independent',()=>{
 const missing=guide({symbol:'NIFTY'}, {},9,'3m');assert(missing.includes('Full-chain source ଯାଞ୍ଚ ହୋଇନି'));assert(!missing.includes('>0<'));
 const html=guide(a,state,2,'3m');assert(html.includes('2026-10-19 / 23000'));assert(html.includes('2026-10-26 / 23100'));assert(html.includes('100 → 105'));assert(html.includes('09:30'));assert(html.includes('09:33'));
 const quote=guide(a,state,8,'15m');assert(quote.includes('1 ↑ / 1 ↓ / 1 ↔'));assert(quote.includes('vs previous close'));assert(quote.includes('SEPARATE QUOTE SNAPSHOT'));assert(guide(a,state,10,'3m').includes('Cash session 2026-10-15'));
 const escaped=guide({...a,symbol:'<unsafe>'},state,0,'3m');assert(!escaped.includes('<unsafe>'));assert(escaped.includes('&lt;unsafe&gt;'));
});
test('live strip cannot display unqualified PCR, stale OI or stale VIX; disconnect clears live values',()=>{
 const payload:any={connected:true,serverTime:at,snapshot:{indices:[{symbol:'NIFTY',expiry:'2026-10-19',strike:23000,fullPcr:99,coverage:{freshOi:1,expected:10,complete:false},ce:{oi:123456,state:'STALE',observedAt:at},pe:{oi:123,state:'LIVE',observedAt:at}}],vix:{price:99,state:'STALE',observedAt:at},participation:[{identity:{role:'SECTOR'},state:'LIVE',changePct:1}]}};
 const html=live(payload,'NIFTY');assert(!html.includes('123,456'));assert(!html.includes('<strong>99</strong>'));assert(html.includes('1/10 fresh OI'));assert(html.includes('expiry/strike may differ'));assert(live({...payload,connected:false},'NIFTY').includes('disconnected / unavailable'));
});
test('serialized chapters keep reading guides and share the existing live stream without new requests',()=>{
 const html=renderBusinessDashboardV1Html({} as any),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 const nodes=new Map<string,any>();for(const match of html.matchAll(/\bid="([^"]+)"/g))nodes.set(match[1],{value:'',innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},offsetWidth:0});
 const handlers:any={};const ctx:any={document:{getElementById:(id:string)=>nodes.get(id)},window:{addEventListener:(name:string,fn:any)=>handlers[name]=fn},Date,Map,Set,Number,String,Array,Object,Math};vm.createContext(ctx);vm.runInContext(scripts[0],ctx);
 const rows=[0,3,6,9,12,15,18].map(min=>({symbol:'NIFTY',truth_verdict:'TRUE',minute_bucket:new Date(Date.parse('2026-10-16T03:45:00Z')+min*60000).toISOString(),spot_ltp:23000+min,india_vix:14}));
 const current={market:rows,chain:rows.map(r=>({...r,expiry:'2026-10-19',full_chain_oi_pcr:1.1,full_pcr_source:'Normalized full-chain source'})),options:rows.flatMap(r=>['CE','PE'].map(side=>({...r,expiry:'2026-10-19',strike:23000,option_type:side,ltp:100,oi:1000,dte:3})))};
 let requests=0;ctx.api={derive:vm.runInContext('deriveMarketBook',ctx),getState:()=>({date:'2026-10-16',recordedDates:['2026-10-16'],current:{NIFTY:current},history:{},baseline:{},health:{}}),refresh(){requests++;},memory:async()=>{}};vm.runInContext('globalThis.book=installMarketBook(api)',ctx);
 for(const chapter of [0,1,2,4,5,6,7,8,9,10,11,12]){nodes.get('mb-nav').onclick({target:{closest:()=>({dataset:{page:String(chapter)}})}});assert(nodes.get('mb-page').innerHTML.includes('aria-label="Chapter reading guide"'));}
 const recorded=nodes.get('mb-page').innerHTML;handlers['optionpilot:live-context']({detail:{connected:false}});assert(nodes.get('mb-live-context').innerHTML.includes('unavailable'));assert.equal(nodes.get('mb-page').innerHTML,recorded);assert.equal(requests,0);
});
