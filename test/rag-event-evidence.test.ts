import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Hono} from 'hono';
import {parseRagEventRequest,buildRagEventEvidence,buildRagPremiumSnapshot,readRagEventEvidence,mountRagEventEvidenceRoute} from '../rag-event-evidence.js';
import type {H1ReplayHttpResult} from '../h1-replay-http.js';
const query={symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:'22300',side:'PE',time:'09:36'};
const request=(extra:Record<string,string>={})=>{const p=parseRagEventRequest({...query,...extra});assert.ok(p.ok);return p.value;};
function fixture(date:string):H1ReplayHttpResult {
 const points=date==='2026-10-12'?['09:15','15:30']:['09:33','09:36','09:39','09:42','09:51','10:06'];
 const market:any[]=[],options:any[]=[],chain:any[]=[];
 for(const [i,t] of points.entries()) {
  const ms=Date.parse(date+'T'+t+':00+05:30'),bucket=new Date(ms).toISOString(),receipt=new Date(ms+24000).toISOString(),snapshot_id=date+t;
  market.push({symbol:'NIFTY',minute_bucket:bucket,backend_timestamp:receipt,truth_verdict:'TRUE',snapshot_id,spot_ltp:22484+i,india_vix:14.75-i*.04,calculation_version:'STORAGE_V3_PHASE1'});
  chain.push({symbol:'NIFTY',minute_bucket:bucket,expiry:'2026-10-13',truth_verdict:'TRUE',calculation_version:'STORAGE_V3_PHASE1',full_chain_oi_pcr:1+i*.05});
  for(const side of ['CE','PE'])options.push({symbol:'NIFTY',minute_bucket:bucket,expiry:'2026-10-13',strike:22300,option_type:side,snapshot_id,truth_verdict:'TRUE',
    ltp:side==='CE'?200+i*10:date==='2026-10-12'?20:[12.25,11.2,9.5,7.7,6.65,6.2][i],oi:1000+i*100,quote_timestamp:receipt,quote_age_seconds:0,day_high:73.85,day_low:11.6});
 }
 return {ok:true,mode:'READ_ONLY_H1_3M_REPLAY',productionImpact:'NONE',request:{symbol:'NIFTY',tradeDate:date,fromTime:'09:15',toTime:'15:30',scope:'CORE'},market,options,chain};
}
const result=(extra:Record<string,string>={})=>buildRagEventEvidence(request(extra),fixture('2026-10-13'),fixture('2026-10-12'));
test('mixed-version loaded OI maxima require exact canonical corroboration, including alias conflicts',()=>{
 const c=fixture('2026-10-13');
 for(const m of c.market!)m.calculation_version='H1_RUNTIME_BRIDGE_V1';
 c.canonical=c.market!.map(m=>({symbol:m.symbol,minute_bucket:m.minute_bucket,snapshot_id:m.snapshot_id,truth_verdict:'TRUE',source_timestamp:m.backend_timestamp,calculation_version:m.calculation_version,
  market:{symbol:m.symbol,expiries:[{expiry:'Current Expiry',expiryDate:'2026-10-13',...Object.fromEntries(['CE','PE'].map(side=>[side==='CE'?'ceStrikes':'peStrikes',[22300,22400].map((strike,i)=>({strike,oi:1000+i*100,optionType:side,expiryDate:'2026-10-13',quoteTimestamp:m.backend_timestamp}))]))}],gapScore:{fullChainPcr:1.23}}}));
 for(const row of c.chain!)Object.assign(row,{call_wall_strike:22400,call_wall_oi:1100,put_wall_strike:22400,put_wall_oi:1100});
 const run=()=>{const out=buildRagPremiumSnapshot(request({kind:'SNAPSHOT'}),c,fixture('2026-10-12'));assert.ok(out.ok);return out.beforeAndAt.at(-1)!.context;};
 assert.equal(run().ceWall,22400);assert.equal(run().peWallOi,1100);assert.equal(run().wallEvidence.CE!.count,2);
 assert.match(run().wallEvidence.CE!.source,/full-chain coverage and freshness unverified/);
 const target=c.canonical.find(row=>row.minute_bucket==='2026-10-13T04:06:00.000Z')!,original=structuredClone(target);
 for(const mutate of [
  (v:any)=>v.market.expiries[0].ceStrikes[1].oi=1200,
  (v:any)=>v.market.expiries[0].ceStrikes[0].oi=null,
  (v:any)=>v.market.expiries[0].ceStrikes[0].oi=1100,
  (v:any)=>v.market.expiries[0].ceStrikes[0].optionType='PE',
  (v:any)=>v.market.expiries[0].ceStrikes[0].expiryDate='2026-10-19',
  (v:any)=>v.market.expiries[0].ceStrikes[0].quoteTimestamp='2026-10-12T04:06:24Z',
  (v:any)=>v.market.expiries[0].ceStrikes[0].quoteTimestamp='2026-10-13T04:07:24Z',
  (v:any)=>v.market.expiries[0].ceStrikes.push({...v.market.expiries[0].ceStrikes[0]}),
  (v:any)=>v.market.expiries.push({...structuredClone(v.market.expiries[0]),ceStrikes:[]}),
 ]){Object.assign(target,structuredClone(original));mutate(target);assert.equal(run().ceWall,null);assert.equal(run().peWall,22400);}
 Object.assign(target,structuredClone(original));target.market.expiries.push({...structuredClone(target.market.expiries[0]),expiry:'Monthly'});
 assert.equal(run().ceWall,22400);
 const row=c.chain!.find(row=>row.minute_bucket==='2026-10-13T04:06:00.000Z')!;
 c.chain!.push({...row,call_wall_oi:9999});assert.equal(run().ceWall,null);assert.equal(run().peWall,null);
 c.chain!.pop();Object.assign(target,structuredClone(original));target.market.expiries[0].ceStrikes[1].quoteTimestamp='2026-10-13T04:06:26Z';
 const cut=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',asOf:'2026-10-13T09:36:25'}),c,fixture('2026-10-12'));
 assert.ok(cut.ok);assert.equal(cut.beforeAndAt.at(-1)!.context.ceWall,null);assert.equal(cut.beforeAndAt.at(-1)!.context.peWall,22400);
});
test('mixed-version chain recovers only snapshot-matched canonical current-expiry PCR',()=>{
 const c=fixture('2026-10-13');
 for(const m of c.market!)m.calculation_version='H1_RUNTIME_BRIDGE_V1';
 c.canonical=c.market!.map(m=>({symbol:m.symbol,minute_bucket:m.minute_bucket,snapshot_id:m.snapshot_id,truth_verdict:'TRUE',
  source_timestamp:m.backend_timestamp,calculation_version:m.calculation_version,
  market:{symbol:m.symbol,expiries:[{expiry:'Current Expiry',expiryDate:'2026-10-13'}],gapScore:{fullChainPcr:1.23}}}));
 for(const row of c.chain!)Object.assign(row,{call_wall_strike:22500,put_wall_strike:22300});
 const run=()=>{const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT'}),c,fixture('2026-10-12'));assert.ok(r.ok);return r.beforeAndAt.at(-1)!.context;};
 assert.equal(run().fullPcr,1.23);assert.equal(run().fullPcrSource,'Exact canonical full-chain source');
 assert.equal(run().fullPcrCanonicalSourceAt,new Date(Date.parse('2026-10-13T09:36:00+05:30')+24000).toISOString());
 assert.equal(run().ceWall,null);assert.equal(run().peWall,null);
 const target=c.canonical.find(row=>row.minute_bucket==='2026-10-13T04:06:00.000Z')!;
 const original=structuredClone(target);
 for(const mutate of [
  (v:any)=>v.snapshot_id='wrong',
  (v:any)=>v.truth_verdict='STALE',
  (v:any)=>v.calculation_version='UNVERIFIED',
  (v:any)=>v.market.symbol='SENSEX',
  (v:any)=>v.market.expiries[0].expiryDate='2026-10-19',
  (v:any)=>v.market.expiries.push({...v.market.expiries[0]}),
  (v:any)=>v.market.gapScore.fullChainPcr='1.23',
  (v:any)=>v.market.gapScore.fullChainPcr=-1,
  (v:any)=>v.source_timestamp='2026-10-13T04:07:01Z',
  (v:any)=>v.source_timestamp='2026-10-13T04:05:59Z',
 ]){Object.assign(target,structuredClone(original));mutate(target);assert.equal(run().fullPcr,null);assert.equal(run().fullPcrCanonicalSourceAt,null);}
 Object.assign(target,structuredClone(original));
 const cutoff=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',asOf:'2026-10-13T09:36:25'}),c,fixture('2026-10-12'));
 assert.ok(cutoff.ok);target.source_timestamp='2026-10-13T04:06:26Z';
 const late=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',asOf:'2026-10-13T09:36:25'}),c,fixture('2026-10-12'));
 assert.ok(late.ok);assert.equal(late.beforeAndAt.at(-1)!.context.fullPcr,null);
 Object.assign(target,structuredClone(original));c.canonical.push({...structuredClone(target),snapshot_id:'conflict'});assert.equal(run().fullPcr,null);
});
test('exact own-reference crossing and no outcomes by default',()=>{
 const r=result();assert.ok(r.ok);assert.deepEqual(r.event.flags,['PDL_LOSS']);assert.equal(r.reference.pdl,11.6);assert.equal(r.event.after,11.2);assert.deepEqual(r.outcomes,[]);
 assert.equal(r.safety.writesPerformed,false);assert.equal(r.safety.affectsSelector,false);assert.match(r.answer,/PDL_LOSS/);
});
test('receipt cutoff excludes a nominal bucket not yet available; future horizons isolated',()=>{
 assert.equal(result({asOf:'2026-10-13T09:36:00'}).ok,false);
 const r=result({asOf:'2026-10-13T09:39:59',includeOutcomes:'true'});assert.ok(r.ok);
 assert.equal(r.outcomes.filter(Boolean).length,1);assert.equal(r.outcomes[0]!.pair.pe!.price,9.5);
 assert.equal(r.outcomes[1],null);assert.equal(r.outcomes[2],null);
});
test('rejects stale, cross-date, wrong snapshot and changed expiry',()=>{
 for(const mutation of [{snapshot_id:'wrong'},{quote_timestamp:'2026-10-12T04:06:24Z'},{quote_timestamp:'2026-10-13T03:00:00Z'},{expiry:'2026-10-19'}]) {
  const c=fixture('2026-10-13');Object.assign(c.options!.find(r=>r.option_type==='PE'&&r.minute_bucket==='2026-10-13T04:06:00.000Z')!,mutation);
  assert.equal(buildRagEventEvidence(request(),c,fixture('2026-10-12')).ok,false);
 }
});
test('missing prior terminal or inconsistent prior aggregate fails closed',()=>{
 const p=fixture('2026-10-12');p.options=p.options!.filter(r=>r.minute_bucket!=='2026-10-12T10:00:00.000Z');
 assert.equal(buildRagEventEvidence(request(),fixture('2026-10-13'),p).ok,false);
 const p2=fixture('2026-10-12');p2.options![1].day_high=100;assert.equal(buildRagEventEvidence(request(),fixture('2026-10-13'),p2).ok,false);
});
test('invalid inputs rejected and supported expiry remains exact',()=>{
 for(const extra of [{date:'2026-02-30'},{date:'2026-10-20'},{time:'09:37'},{time:'09:15'},{strike:'0'},{side:'XX'},{includeOutcomes:'1'},{asOf:'tomorrow'},{asOf:'2026-02-30T09:39:00'},{asOf:'2026-10-13T24:00:00'}])assert.equal(parseRagEventRequest({...query,...extra}).ok,false);
 assert.equal(request({expiry:'2026-10-19'}).expiry,'2026-10-19');
});
test('ambiguous duplicate cannot silently select a quote',()=>{
 const c=fixture('2026-10-13'),o=c.options!.find(r=>r.option_type==='PE'&&r.minute_bucket==='2026-10-13T04:06:00.000Z')!;
 c.options!.push({...o,ltp:10});assert.equal(buildRagEventEvidence(request(),c,fixture('2026-10-12')).ok,false);
});
test('read wrapper calls only existing replay twice with bounded windows',async()=>{
 const calls:any[]=[];const r=await readRagEventEvidence(request(),async q=>{calls.push(q);return fixture(q.tradeDate);});
 assert.ok(r.ok);
 assert.equal(r.premiumResponse.status,'MEASURED');assert.equal(r.premiumResponse.change!.price,r.premiumResponse.current!.price-r.premiumResponse.before!.price);
 assert.equal(r.premiumResponse.change!.spot,r.premiumResponse.current!.spot-r.premiumResponse.before!.spot);assert.equal(r.premiumResponse.modelAttribution.status,'UNAVAILABLE');assert.equal(calls.length,2);assert.equal(calls[0].fromTime,'09:15');assert.equal(calls[0].toTime,'09:36');assert.equal(calls[1].tradeDate,'2026-10-12');
});
test('GET route validates, catches unavailable sources, never offers POST',async()=>{
 const app=new Hono();mountRagEventEvidenceRoute(app,async r=>result());
 assert.equal((await app.request('/rag-event-evidence?'+new URLSearchParams(query))).status,200);
 assert.equal((await app.request('/rag-event-evidence')).status,400);
 assert.equal((await app.request('/rag-event-evidence',{method:'POST'})).status,404);
 const broken=new Hono();mountRagEventEvidenceRoute(broken,async()=>{throw Error('private connection value');});
 const response=await broken.request('/rag-event-evidence?'+new URLSearchParams(query));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private connection/);
});
test('actual recorder parity: known NIFTY event and PCR provenance',{skip:!process.env.RAG_RAW_FIXTURES},()=>{
 const raw=(date:string)=>JSON.parse(readFileSync(process.env.RAG_RAW_FIXTURES+'/'+date+'_NIFTY.json','utf8'));
 const r=buildRagEventEvidence(request({includeOutcomes:'true'}),raw('2026-10-13'),raw('2026-10-12'));
 assert.ok(r.ok);assert.equal(r.reference.pdl,11.6);assert.equal(r.event.after,11.2);assert.equal(r.outcomes[0]!.pair.pe!.price,9.5);
 assert.ok(Math.abs(r.beforeAndAt.at(-1)!.context.fullPcr!-1.0677544186098389)<1e-10);
});

test('snapshot answers a non-crossing with exact opposite-side endpoints',()=>{
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',time:'09:39'}),fixture('2026-10-13'),fixture('2026-10-12'));
 assert.ok(r.ok);assert.equal(r.event.after,9.5);assert.deepEqual(r.event.flags,[]);
 assert.ok(Math.abs(r.comparison.selectedChangePercent!-((9.5/11.2-1)*100))<1e-9);
 assert.ok(Math.abs(r.comparison.oppositeChangePercent!-((220/210-1)*100))<1e-9);
 assert.match(r.answer,/Opposite CE ₹220.00/);assert.match(r.answer,/09:39 IST/);assert.deepEqual(r.outcomes,[]);
 assert.equal(r.provenance.selectedEvidenceSha256.length,64);
});
test('snapshot works without prior reference, but rejects stale/current identity conflicts',()=>{
 const noPrior={...fixture('2026-10-12'),ok:false};
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT'}),fixture('2026-10-13'),noPrior);
 assert.ok(r.ok);assert.equal(r.reference,null);assert.equal(r.status,'PARTIAL');assert.match(r.answer,/reference ଅନୁପଲବ୍ଧ/);
 const wrong=fixture('2026-10-13');wrong.request!.symbol='SENSEX';assert.equal(buildRagPremiumSnapshot(request({kind:'SNAPSHOT'}),wrong,noPrior).ok,false);
 const stale=fixture('2026-10-13');stale.options!.find(o=>o.minute_bucket==='2026-10-13T04:06:00.000Z'&&o.option_type==='PE')!.truth_verdict='STALE';
 assert.equal(buildRagPremiumSnapshot(request({kind:'SNAPSHOT'}),stale,noPrior).ok,false);
});
test('snapshot respects receipt cutoff and never interpolates absent 1/5m baselines',()=>{
 for(const lookback of ['1','5']){const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',lookback}),fixture('2026-10-13'),fixture('2026-10-12'));assert.ok(r.ok);assert.equal(r.comparison.selectedChangePercent,null);assert.equal(r.comparison.oppositeChangePercent,null);assert.match(r.answer,/exact baseline ଅନୁପଲବ୍ଧ/);}
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',asOf:'2026-10-13T09:36:00'}),fixture('2026-10-13'),fixture('2026-10-12'));assert.equal(r.ok,false);
 assert.equal(parseRagEventRequest({...query,kind:'SNAPSHOT',time:'09:15'}).ok,true);
 for(const q of [{kind:'ANY'},{lookback:'2'},{kind:'SNAPSHOT',time:'09:37'}])assert.equal(parseRagEventRequest({...query,...q}).ok,false);
});
test('all-strike retrieval is bounded to selected date and requested lookback; default event path preserved',async()=>{
 const calls:any[]=[];const r=await readRagEventEvidence(request({kind:'SNAPSHOT',lookback:'75',time:'10:06'}),async q=>{calls.push(q);return fixture(q.tradeDate);});
 assert.ok(r.ok);assert.equal(r.mode,'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1');assert.equal(calls.length,2);assert(calls.every(q=>q.scope==='FULL'));assert.equal(calls[0].fromTime,'09:15');assert.equal(calls[0].toTime,'10:06');
 assert.equal(result({time:'09:39'}).ok,false,'event mode still requires a reconciled crossing');
});

test('snapshot still answers current recording when the prior source throws',async()=>{
 const r=await readRagEventEvidence(request({kind:'SNAPSHOT'}),async q=>{if(q.tradeDate==='2026-10-12')throw Error('unavailable');return fixture(q.tradeDate);});assert.ok(r.ok);assert.equal(r.reference,null);assert.equal(r.referenceUnavailableReason,'REPLAY_SOURCE_UNAVAILABLE');
});

test('RAG snapshot includes independently verified multi-expiry 3m evidence',()=>{
 const current=fixture('2026-10-13');
 const other=current.options!.filter((o:any)=>o.option_type==='PE'&&['09:33','09:36'].some(t=>o.minute_bucket===new Date('2026-10-13T'+t+':00+05:30').toISOString())).map((o:any)=>({...o,expiry:'2026-10-20'}));
 current.options!.push(...other);
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',lookback:'3'}),current,fixture('2026-10-12'));
 assert.ok(r.ok);
 assert.equal(r.multiDte?.coverage.verifiedExpiries,2);
 assert.equal(r.multiDte?.accepted.length,2);
});
test('RAG snapshot does not infer multi-DTE for non-3m windows',()=>{
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',lookback:'5'}),fixture('2026-10-13'),fixture('2026-10-12'));
 assert.ok(r.ok);
 assert.equal(r.multiDte,null);
});

test('six-minute snapshot uses its exact recorded endpoints and keeps multi-DTE scope explicit',()=>{
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',time:'09:42',lookback:'6'}),fixture('2026-10-13'),fixture('2026-10-12'));
 assert.ok(r.ok);assert.equal(r.premiumResponse.lookbackMinutes,6);assert.equal(r.premiumResponse.before!.price,11.2);assert.equal(r.premiumResponse.current!.price,7.7);assert.equal(r.premiumResponse.change!.price,7.7-11.2);assert.equal(r.multiDte,null);
});
test('all-strike retrieval is bounded to selected date and requested lookback; default event path preserved',async()=>{
 const calls:any[]=[];const r=await readRagEventEvidence(request({kind:'SNAPSHOT',lookback:'75',time:'10:06'}),async q=>{calls.push(q);return fixture(q.tradeDate);});
 assert.ok(r.ok);assert.equal(r.mode,'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1');assert.equal(calls.length,2);assert(calls.every(q=>q.scope==='FULL'));assert.equal(calls[0].fromTime,'09:15');assert.equal(calls[0].toTime,'10:06');
 assert.equal(result({time:'09:39'}).ok,false,'event mode still requires a reconciled crossing');
});

test('snapshot still answers current recording when the prior source throws',async()=>{
 const r=await readRagEventEvidence(request({kind:'SNAPSHOT'}),async q=>{if(q.tradeDate==='2026-10-12')throw Error('unavailable');return fixture(q.tradeDate);});assert.ok(r.ok);assert.equal(r.reference,null);assert.equal(r.referenceUnavailableReason,'REPLAY_SOURCE_UNAVAILABLE');
});

test('RAG snapshot includes independently verified multi-expiry 3m evidence',()=>{
 const current=fixture('2026-10-13');
 const other=current.options!.filter((o:any)=>o.option_type==='PE'&&['09:33','09:36'].some(t=>o.minute_bucket===new Date('2026-10-13T'+t+':00+05:30').toISOString())).map((o:any)=>({...o,expiry:'2026-10-20'}));
 current.options!.push(...other);
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',lookback:'3'}),current,fixture('2026-10-12'));
 assert.ok(r.ok);
 assert.equal(r.multiDte?.coverage.verifiedExpiries,2);
 assert.equal(r.multiDte?.accepted.length,2);
});
test('RAG snapshot does not infer multi-DTE for non-3m windows',()=>{
 const r=buildRagPremiumSnapshot(request({kind:'SNAPSHOT',lookback:'5'}),fixture('2026-10-13'),fixture('2026-10-12'));
 assert.ok(r.ok);
 assert.equal(r.multiDte,null);
});
