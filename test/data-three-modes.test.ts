import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveDataAnnex,deriveObservationData,renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
const symbol='NIFTY',expiry='2026-10-13',key='NIFTY|2026-10-13|24000|CE';
const now=Date.parse('2026-10-08T06:00:00Z');
const session=(date:string,value:number)=>deriveObservationData({options:[{symbol,expiry,strike:24000,option_type:'CE',minute_bucket:date+'T09:55:00Z',ltp:value,oi:100+value,iv:12}],market:[{symbol,minute_bucket:date+'T09:55:00Z',spot_ltp:24000+value,future_ltp:24050+value,future_oi:1000+value}],chain:[{symbol,expiry,minute_bucket:date+'T09:55:00Z',full_chain_oi_pcr:value/100,call_wall_strike:24200,put_wall_strike:23900}]});
const dates=['2026-09-29','2026-09-30','2026-10-01','2026-10-05','2026-10-06','2026-10-07'];
const history=dates.map((d,i)=>session(d,100+i*10));
const field=(rs:any[],name:string)=>rs.find(r=>r.field===name);
test('completed 1/3/5-session exact-contract endpoints exclude live partial session',()=>{
 const a=deriveDataAnnex(session('2026-10-08',999),history,[...dates,'2026-10-08'],symbol,expiry,key,'2026-10-08',now);
 assert.deepEqual(a.swing.map(w=>field(w.fields,'ltp').delta),[10,30,50]);
 assert.equal(a.priorDate,'2026-10-07');assert.equal(field(a.bridge,'ltp').delta,849);
 assert.equal(field(a.previousDayChange,'ltp').delta,10);
 for(const w of a.swing)assert.equal(field(w.fields,'future_ltp').delta,null);
 assert(a.persisted.some(r=>r.label==='CE wall strike'));assert(a.endpointLabel.includes('not official EOD close'));
});
test('missing session and changed contract identity never shift or stitch baselines',()=>{
 const h=structuredClone(history);h[4].options[0].expiry='2026-10-20';h[2].options=[];
 const a=deriveDataAnnex(session('2026-10-08',200),h,dates,symbol,expiry,key,'2026-10-08',now);
 assert.equal(field(a.swing[0].fields,'ltp').delta,null);assert.equal(field(a.swing[1].fields,'ltp').delta,null);
 assert.equal(field(a.swing[2].fields,'ltp').delta,50);
 const missing=deriveDataAnnex({},[],dates,symbol,expiry,key,'2026-10-08',now);assert.equal(missing.missingDates.length,6);assert.equal(field(missing.bridge,'oi').delta,null);
});
test('3m/15m and From Open require exact sampled endpoints, preserve nulls',()=>{
 const make=(at:string,ltp:any)=>({symbol,expiry,strike:24000,option_type:'CE',minute_bucket:'2026-10-08T'+at+'Z',ltp,oi:null,iv:0});
 const cur=deriveObservationData({options:[make('03:45:00',100),make('04:00:00',110),make('04:12:00',115),make('04:15:00',120)]});
 const a=deriveDataAnnex(cur,[],[],symbol,expiry,key,'2026-10-08',now),r=field(a.currentDay,'ltp');assert.deepEqual(r.windows.map((w:any)=>w.delta),[5,10,20]);assert.equal(field(a.currentDay,'oi').current.value,null);assert.equal(field(a.currentDay,'iv').current.value,0);
 cur.options.splice(2,1);assert.equal(field(deriveDataAnnex(cur,[],[],symbol,expiry,key,'2026-10-08',now).currentDay,'ltp').windows[0].delta,null);
});
test('no cross-date or cross-expiry notable events; completed day does not fabricate a close',()=>{
 const cur=session('2026-10-08',200);cur.wallEvents=[{symbol,expiry,minute_bucket:'2026-10-07T09:55:00Z',side:'CALL',from:24000,to:24100,pcrDelta:0.1},{symbol,expiry:'2026-10-20',minute_bucket:'2026-10-08T04:15:00Z',side:'CALL',from:24000,to:24100,pcrDelta:0.1}];
 assert.equal(deriveDataAnnex(cur,history,dates,symbol,expiry,key,'2026-10-08',now).events.length,0);
 const ended=deriveDataAnnex(cur,history,[...dates,'2026-10-08'],symbol,expiry,key,'2026-10-08',Date.parse('2026-10-08T10:01:00Z'));assert.equal(ended.endpoints.at(-1)?.date,'2026-10-08');assert.equal(field(ended.endpoints.at(-1)!.fields,'ltp').at,'2026-10-08T09:55:00Z');
});
test('exactly three primary modes, collapsible evidence, reuse-only GET sources',()=>{
 const html=renderBusinessDashboardV1Html({} as any),primary=html.match(/<div class="terminal-tabs"[\s\S]*?<\/div>/)![0];
 assert.deepEqual([...primary.matchAll(/>(INTRADAY|SWING|MEMORY)<\/button>/g)].map(m=>m[1]),['INTRADAY','SWING','MEMORY']);assert.equal((primary.match(/role="tab"/g)||[]).length,3);
 assert(html.includes('id="annex-raw"'));assert(html.includes('Yesterday → Today Bridge'));assert(html.includes('EOD Notable Changes'));assert(html.includes('/api/research/h1-eod-business-backtest-summary?'));assert(html.includes('await ensureAnnexMemory()'));assert(!html.includes('method:'));assert(!html.includes('localStorage.setItem(\'memory'));
});
