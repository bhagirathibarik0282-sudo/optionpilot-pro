import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveRecordedPremiumResponse,type PremiumResponseSelection} from '../premium-response-evidence.js';
import type {H1ReplayHttpResult} from '../h1-replay-http.js';
const date='2026-10-13',bucket=(t:string)=>new Date(date+'T'+t+':00+05:30').toISOString();
const selection=(extra:Partial<PremiumResponseSelection>={}):PremiumResponseSelection=>({symbol:'NIFTY',date,expiry:date,strike:22300,side:'CE',time:'09:36',lookback:3,asOf:Infinity,...extra});
function fixture():H1ReplayHttpResult{
 const market:any[]=[],options:any[]=[];
 for(const [i,t] of ['09:33','09:36'].entries()){
  const at=bucket(t),receipt=new Date(Date.parse(at)+24000).toISOString(),snapshot_id='snapshot-'+t;
  market.push({symbol:'NIFTY',minute_bucket:at,truth_verdict:'TRUE',snapshot_id,backend_timestamp:receipt,exchange_timestamp:null,spot_ltp:22290+i*20});
  for(const side of ['CE','PE'])options.push({symbol:'NIFTY',minute_bucket:at,expiry:date,strike:22300,option_type:side,truth_verdict:'TRUE',snapshot_id,quote_timestamp:receipt,dte:0,ltp:side==='CE'?20+i*12:30-i*7,oi:i?0:100,bid:19+i*12,ask:21+i*12});
 }
 return {ok:true,mode:'READ_ONLY_H1_3M_REPLAY',productionImpact:'NONE',request:{symbol:'NIFTY',tradeDate:date,fromTime:'09:15',toTime:'15:30',scope:'CORE'},market,options};
}
const quote=(r:H1ReplayHttpResult,side='CE',last=true)=>r.options!.find(q=>q.option_type===side&&q.minute_bucket===bucket(last?'09:36':'09:33'))!;
test('exact CE pair measures crossing the strike without inventing Greeks or expiry minutes',()=>{
 const r=deriveRecordedPremiumResponse(fixture(),selection());assert.equal(r.status,'MEASURED');assert.equal(r.before!.spotIntrinsicProxy,0);assert.equal(r.current!.spotIntrinsicProxy,10);assert.equal(r.change!.price,12);assert.equal(r.change!.spot,20);assert.equal(r.change!.spotRemainder,2);assert.equal(r.change!.observedPremiumPerSpotPoint,.6);assert.equal(r.clock.calendarDte,0);assert.equal(r.clock.minutesToExpiry,null);assert.equal(r.modelAttribution.status,'UNAVAILABLE');assert.equal(r.current!.oi,0);assert.equal(r.change!.oi,-100);assert.equal(r.current!.liquidity.spread,2);assert.equal(r.evidenceSha256!.length,64);assert.equal(r.safety.affectsSelector,false);
});
test('PE intrinsic falls across strike; remainder change remains arithmetic, not time decay',()=>{
 const r=deriveRecordedPremiumResponse(fixture(),selection({side:'PE'}));assert.equal(r.before!.spotIntrinsicProxy,10);assert.equal(r.current!.spotIntrinsicProxy,0);assert.equal(r.change!.spotIntrinsicProxy,-10);assert.equal(r.change!.price,-7);assert.equal(r.change!.spotRemainder,3);assert.equal(r.change!.observedPremiumPerSpotPoint,-.35);
});
test('all exact identity fields, TRUE status and snapshot receipt are enforced',()=>{
 for(const mutation of [{symbol:'SENSEX'},{expiry:'2026-10-19'},{strike:22350},{option_type:'PE'},{truth_verdict:'STALE'},{snapshot_id:'wrong'}]){
  const f=fixture();Object.assign(quote(f),mutation);const r=deriveRecordedPremiumResponse(f,selection());assert.equal(r.current,null);assert.equal(r.change,null);
 }
 const wrong=fixture();wrong.request!.symbol='SENSEX';assert.equal(deriveRecordedPremiumResponse(wrong,selection()).status,'UNAVAILABLE');
});
test('receipt and quote cutoffs apply independently; bounded clock skew is disclosed',()=>{
 const r=deriveRecordedPremiumResponse(fixture(),selection({asOf:Date.parse(bucket('09:36'))}));assert.equal(r.current,null);
 const f=fixture(),q=quote(f);q.quote_timestamp=new Date(Date.parse(q.quote_timestamp as string)+4000).toISOString();
 assert.equal(deriveRecordedPremiumResponse(f,selection({asOf:Date.parse(bucket('09:36'))+25000})).current,null);
 assert.equal(deriveRecordedPremiumResponse(f,selection({asOf:Date.parse(bucket('09:36'))+29000})).current!.quoteAgeSeconds,-4);
});
test('stale, wrong-day, nonfinite and future quote times do not become measured values',()=>{
 for(const stamp of [new Date(Date.parse(bucket('09:36'))-7000).toISOString(),'2026-10-12T04:06:24Z','invalid',new Date(Date.parse(bucket('09:36'))+30000).toISOString()]){
  const f=fixture();quote(f).quote_timestamp=stamp;assert.equal(deriveRecordedPremiumResponse(f,selection()).current,null);
 }
 const f=fixture();f.market![1].backend_timestamp=new Date(Date.parse(bucket('09:36'))+61000).toISOString();assert.equal(deriveRecordedPremiumResponse(f,selection()).current,null);
});
test('missing exact baseline does not interpolate even when other prices exist',()=>{
 for(const lookback of [1,5]){const r=deriveRecordedPremiumResponse(fixture(),selection({lookback}));assert.equal(r.status,'PARTIAL');assert.equal(r.before,null);assert.equal(r.change,null);assert.equal(r.current!.price,32);}
});
test('duplicate aliases accept identical relevant fields and quarantine conflicting prices or books',()=>{
 const f=fixture();f.options!.push({...quote(f),expiry_bucket:'ALIAS'});assert.equal(deriveRecordedPremiumResponse(f,selection()).status,'MEASURED');
 f.options!.push({...quote(f),ask:99});assert.equal(deriveRecordedPremiumResponse(f,selection()).current,null);
 const m=fixture();m.market!.push({...m.market![1],spot_ltp:999});assert.equal(deriveRecordedPremiumResponse(m,selection()).current,null);
});
test('recomputed DTE ignores absent metadata but rejects inconsistent metadata',()=>{
 const f=fixture();delete quote(f).dte;assert.equal(deriveRecordedPremiumResponse(f,selection()).clock.calendarDte,0);
 quote(f).dte=1;assert.equal(deriveRecordedPremiumResponse(f,selection()).reason,'STORED_DTE_MISMATCH');
 for(const s of [{expiry:'2026-02-30'},{expiry:'2026-10-12'},{date:'2026-02-30'},{time:'09:37'},{asOf:NaN},{asOf:Number.MAX_SAFE_INTEGER},{lookback:2}])assert.equal(deriveRecordedPremiumResponse(fixture(),selection(s as any)).status,'UNAVAILABLE');
});
test('missing/stale/future spot timestamps withhold spot calculations but retain accepted option prices',()=>{
 for(const value of [null,0]){const f=fixture();f.market![1].spot_ltp=value;const r=deriveRecordedPremiumResponse(f,selection());assert.equal(r.current!.price,32);assert.equal(r.current!.spotIntrinsicProxy,null);assert.equal(r.change!.spot,null);assert.equal(r.status,'PARTIAL');}
 const f=fixture();f.market![1].exchange_timestamp=new Date(Date.parse(bucket('09:36'))+28000).toISOString();const r=deriveRecordedPremiumResponse(f,selection({asOf:Date.parse(bucket('09:36'))+25000}));assert.equal(r.current!.spot,null);assert.equal(r.current!.price,32);
});
test('negative spot remainder and crossed books are visible without clamping or profit claims',()=>{
 const f=fixture();f.market![1].spot_ltp=22350;quote(f).bid=40;quote(f).ask=30;const r=deriveRecordedPremiumResponse(f,selection());assert.equal(r.current!.spotRemainder,-18);assert.equal(r.current!.remainderStatus,'NEGATIVE_SPOT_REMAINDER');assert.equal(r.current!.liquidity.spread,null);assert.equal(r.current!.liquidity.executionPriceVerified,false);
});
test('flat spot preserves zero change and withholds observed ratio; overflow never emits Infinity',()=>{
 const f=fixture();f.market![1].spot_ltp=22290;const r=deriveRecordedPremiumResponse(f,selection());assert.equal(r.change!.spot,0);assert.equal(r.change!.observedPremiumPerSpotPoint,null);
 quote(f,'CE',false).ltp=1e-300;quote(f).ltp=1e300;assert.equal(deriveRecordedPremiumResponse(f,selection()).change!.pricePercent,null);
});
test('reused snapshot IDs cannot form a forward response; irrelevant future rows do not change the digest',()=>{
 const f=fixture();const before=deriveRecordedPremiumResponse(f,selection());f.options!.push({...quote(f),minute_bucket:bucket('09:39'),ltp:999});assert.equal(deriveRecordedPremiumResponse(f,selection()).evidenceSha256,before.evidenceSha256);
 f.market![1].snapshot_id=f.market![0].snapshot_id;quote(f).snapshot_id=f.market![0].snapshot_id;assert.equal(deriveRecordedPremiumResponse(f,selection()).change,null);
});
test('actual archived NIFTY source proves exact measured pair, DTE and arithmetic',{skip:!process.env.RAG_RAW_FIXTURES},()=>{
 const raw=JSON.parse(readFileSync(process.env.RAG_RAW_FIXTURES+'/2026-10-13_NIFTY.json','utf8'));const r=deriveRecordedPremiumResponse(raw,selection({side:'PE'}));assert.equal(r.status,'MEASURED');assert.equal(r.before!.price,12.25);assert.equal(r.current!.price,11.2);assert(Math.abs(r.change!.price+1.05)<1e-10);assert.equal(r.clock.calendarDte,0);assert.equal(r.before!.snapshotId,raw.market.find((m:any)=>m.minute_bucket===bucket('09:33')).snapshot_id);assert.equal(r.change!.price,r.change!.spotIntrinsicProxy!+r.change!.spotRemainder!);
});
