import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMarketAgreement as derive,renderMarketAgreement as render } from '../market-agreement.js';
import { readBackgroundQuoteHistory } from '../dashboard-background-quotes-history.js';
import { buildBackgroundQuotes } from '../dashboard-background-quotes.js';
const date='2026-10-16',fromAt=date+'T04:00:00Z',at=date+'T04:03:00Z';
const metric=(percent=1,patch:any={})=>({value:101,from:100,percent,at,fromAt,...patch});
function input(patch:any={}){const m={spot:metric(),future:metric(),ce:metric(2),pe:metric(-2),vix:metric(3),pcr:metric(4)};return {category:'SUMMARY',date,symbol:'NIFTY',window:'3m',asOf:at,models:{NIFTY:m,SENSEX:{spot:metric()},BANKNIFTY:{spot:metric(-1)}},...patch};}
test('same, opposite and real flat changes are descriptive and leave input untouched',()=>{
 const i=input(),copy=structuredClone(i),v=derive(i);assert.deepEqual(v.rows.map(r=>r.status),['SAME','OPPOSITE','SAME','OPPOSITE']);assert.equal(v.usable,4);assert.deepEqual(i,copy);
 i.models.SENSEX.spot.percent=0;assert.equal(derive(i).rows[0].status,'FLAT');
});
test('exact baselines, requested interval, trading date and as-of cutoff are mandatory',()=>{
 for(const patch of [{at:date+'T04:06:00Z'},{fromAt:date+'T03:57:00Z'},{fromAt:null},{at:'2026-10-15T04:03:00Z',fromAt:'2026-10-15T04:00:00Z'}]){const i=input();Object.assign(i.models.SENSEX.spot,patch);assert.equal(derive(i).rows[0].status,'UNSYNCED');}
 const i=input({asOf:fromAt});assert.equal(derive(i).usable,0);
});
test('null, numeric strings and nonfinite numbers never become zero',()=>{
 for(const percent of [null,undefined,'0',NaN,Infinity]){const i=input();i.models.SENSEX.spot.percent=percent;assert.equal(derive(i).rows[0].status,'MISSING');}
});
test('PCR, VIX and OI are context with no trade score; futures continuity cannot pass',()=>{
 for(const category of ['POSITIONING','VOLATILITY']){const v=derive(input({category}));assert(v.rows.every(r=>r.context));assert(!('score' in v));assert(!/bullish|bearish|BUY|SELL/.test(render(v)));}
 const v=derive(input({category:'INDICES'}));assert.equal(v.rows.at(-1)?.status,'MISSING');assert.match(v.rows.at(-1)?.reason,/continuity/);
});
test('DTE comparisons require identical strike and side on distinct exact expiries',()=>{
 const a={...metric(),symbol:'NIFTY',type:'CE',strike:24000,expiry:'2026-10-20',identity:'NIFTY|2026-10-20|24000|CE',dte:4};
 const b={...a,expiry:'2026-10-27',identity:'NIFTY|2026-10-27|24000|CE',dte:11};
 const i=input({category:'PREMIUM',side:'CE'});(i.models.NIFTY as any).allExpiryPairs=[{expiry:a.expiry,ce:a},{expiry:b.expiry,ce:b}];
 assert.equal(derive(i).rows[0].status,'SAME');assert.match(derive(i).rows[0].label,/DTE 4.*DTE 11/);
 b.strike=24100;assert.equal(derive(i).rows[0].status,'MISSING');b.strike=24000;b.dte=null as any;assert.equal(derive(i).rows[0].status,'MISSING');
});
function snapshot(timestamp:string,stock=100,sector=200){return {source:'SERVER_BACKGROUND_KITE_QUOTES',tradingDate:date,timestamp,stocks:{NIFTY:[{name:'HDFC Bank',price:stock,change:0,exchangeTimestamp:timestamp}]},sectors:[{name:'Nifty IT',price:sector,pct:1,exchangeTimestamp:timestamp}]};}
function participation(patch:any={}){return input({category:'PARTICIPATION',participationWindow:'3',snapshots:[snapshot(fromAt),snapshot(at,101,198)],...patch});}
test('stored quote prices support sampled response windows, with actual source endpoints',()=>{
 const v=derive(participation());assert.equal(v.rows[0].status,'OPPOSITE');assert.equal(v.rows[0].left,1.0000000000000009);assert.equal(v.rows[0].fromAt,fromAt);assert.equal(v.selection.stock,'HDFC Bank');assert.match(v.rows[0].reason,/30s tolerance/);
});
test('legacy sectors without prices remain missing intraday but real zero day change survives',()=>{
 const i=participation();delete (i.snapshots[0].sectors[0] as any).price;assert.equal(derive(i).rows[0].status,'MISSING');i.participationWindow='DAY';assert.equal(derive(i).rows[0].status,'FLAT');
});
test('unsynced, old, future and duplicate quotes cannot claim agreement',()=>{
 const stale=participation();stale.snapshots[1].sectors[0].exchangeTimestamp=date+'T04:02:00Z';assert.equal(derive(stale).rows[0].status,'UNSYNCED');
 const future=participation();future.snapshots[1].sectors[0].exchangeTimestamp=date+'T04:03:01Z';assert.equal(derive(future).rows[0].status,'UNSYNCED');
 const duplicate=participation();duplicate.snapshots[1].stocks.NIFTY.push({...duplicate.snapshots[1].stocks.NIFTY[0]});assert.equal(derive(duplicate).rows[0].status,'MISSING');
 const receipts=participation();receipts.snapshots.push(structuredClone(receipts.snapshots[1]));assert.equal(derive(receipts).rows[0].status,'MISSING');
 const old=participation({date:'2026-10-15'});assert.equal(derive(old).rows[0].status,'MISSING');
 const cap=participation({asOf:fromAt});assert.equal(derive(cap).rows[0].status,'MISSING');
});
test('Kite naive source timestamps are explicitly IST; missing source time stays unsynced',()=>{
 const i=participation();i.snapshots[0].stocks.NIFTY[0].exchangeTimestamp=date+' 09:30:00';i.snapshots[1].stocks.NIFTY[0].exchangeTimestamp=date+' 09:33:00';assert.equal(derive(i).rows[0].status,'OPPOSITE');i.snapshots[1].stocks.NIFTY[0].exchangeTimestamp=null as any;assert.equal(derive(i).rows[0].status,'UNSYNCED');
});
test('category filters isolate controls and rows; rendering escapes identities',()=>{
 for(const category of ['SUMMARY','PARTICIPATION','INDICES','PREMIUM','POSITIONING','VOLATILITY']){const v=derive(participation({category})),html=render(v,{date,window:'3m'});assert.equal((html.match(/data-agreement-category=/g)||[]).length,6);assert.equal(html.includes('data-agreement-control="stock"'),category==='PARTICIPATION');assert.equal(html.includes('data-agreement-control="expiry"'),category==='PREMIUM');assert(!html.includes('undefined'));}
 const v=derive(input({result:'OPPOSITE'}));assert(v.rows.every(r=>r.status==='OPPOSITE'));v.rows[0].label='<script>bad</script>';assert(!render(v).includes('<script>'));
});
test('existing collector retains additive prices and previous closes without extra requests',()=>{
 const s=buildBackgroundQuotes({'NSE:HDFCBANK':{last_price:100,ohlc:{close:100}},'NSE:NIFTY IT':{last_price:200,ohlc:{close:190}}},new Date(at));assert.equal(s.stocks.NIFTY[0].previousClose,100);assert.equal(s.stocks.NIFTY[0].symbol,'NSE:HDFCBANK');assert.equal(s.sectors.find(r=>r.name==='Nifty IT')?.price,200);
});
test('history uses one bounded SELECT, whitelists public fields and flags truncation',async()=>{
 let calls=0;const raw={...snapshot(at),accessToken:'DO_NOT_EXPOSE'};raw.stocks.NIFTY[0]=( {...raw.stocks.NIFTY[0],secret:'DO_NOT_EXPOSE'} as any);
 const v=await readBackgroundQuoteHistory(date,async(sql,params)=>{calls++;assert.match(sql,/^SELECT .* LIMIT 257$/);assert(!/INSERT|UPDATE|DELETE/.test(sql));assert.equal(params[1],date.replace('16','15')+'T18:30:00.000Z');return {rows:Array.from({length:257},()=>({payload:raw}))};},new Date(date+'T05:00:00Z'));
 assert.equal(calls,1);assert.equal(v.snapshots.length,256);assert.equal(v.truncated,true);assert(!JSON.stringify(v).includes('DO_NOT_EXPOSE'));
});
test('history rejects invalid and future dates before database access, and fails on storage errors',async()=>{
 for(const d of ['2026-02-30','2026-13-01','2026-10-17',"2026-10-16' OR 1=1",''])await assert.rejects(readBackgroundQuoteHistory(d,async()=>{assert.fail('must not query')},new Date(at)),/INVALID_DATE/);
 await assert.rejects(readBackgroundQuoteHistory(date,async()=>null,new Date(at)),/STORAGE_UNAVAILABLE/);
 const v=await readBackgroundQuoteHistory(date,async()=>({rows:[{payload:snapshot('2026-10-15T04:03:00Z')},{payload:snapshot('2026-10-16T05:03:00Z')},{payload:{...snapshot(at),source:'other'}}]}),new Date(at));assert.equal(v.snapshots.length,0);
});

test('15m and 30m participation keep older baselines while rejecting old endpoints',()=>{
 for(const minutes of [15,30]){
  const endpoint=new Date(Date.parse(fromAt)+minutes*60000).toISOString();
  const i=participation({asOf:endpoint,participationWindow:String(minutes),snapshots:[snapshot(fromAt),snapshot(endpoint,101,198)]});
  assert.equal(derive(i).rows[0].status,'OPPOSITE');
  i.asOf=new Date(Date.parse(endpoint)+7*60000).toISOString();
  assert.equal(derive(i).rows[0].status,'MISSING');
 }
});
test('history HTTP route validates dates and never caches failed reads',async()=>{
 const {researchRouter}=await import('../research-router.js');
 const response=await researchRouter.request('/background-quotes/history?date=2026-02-30');
 assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{error:'INVALID_DATE'});
});

test('old saved snapshots remain readable at their own time without becoming synchronized agreement',()=>{
 const i=participation({asOf:date+'T04:15:00Z'}),v=derive(i);
 assert.equal(v.usable,0);assert.equal(v.rows[0].status,'MISSING');
 assert.equal(v.selection.lastVerified.receipt,at);
 assert.equal(v.selection.lastVerified.stocks.length,1);
 assert.equal(v.selection.lastVerified.sectors.length,1);
 const html=render(v,{date,window:'3m',asOf:i.asOf});
 assert.match(html,/Last verified/);assert.match(html,/Read last verified prices/);
 assert.match(html,/unavailable for the selected endpoint comparison/);
 const stale=participation({asOf:date+'T04:15:00Z'});
 stale.snapshots[1].stocks.NIFTY[0].exchangeTimestamp=date+'T04:00:00Z';
 assert.equal(derive(stale).selection.lastVerified.stocks.length,0);
 const future=participation({asOf:date+'T03:59:00Z'});
 assert.equal(derive(future).selection.lastVerified,null);
});
