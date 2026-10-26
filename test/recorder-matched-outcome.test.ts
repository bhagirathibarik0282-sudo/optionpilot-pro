import test from 'node:test';
import assert from 'node:assert/strict';
import {computeRecorderMatchedOutcome as compute,type RecorderMatchRule} from '../recorder-matched-outcome.js';

// Synthetic guard fixtures only. These are not recorded market results.
function snapshot(date:string,outcome=132,strike=23150){
 const at=(t:string,s=25)=>new Date(date+'T'+t+':'+String(s).padStart(2,'0')+'+05:30').toISOString();
 const point=(t:string,offset:number,price:number)=>({timeIst:t,offset,bucketAt:at(t,0),receiptAt:at(t),
  pair:{pe:{price,oi:1000,quoteAt:at(t,21),receiptAt:at(t),snapshotId:date+'-'+t}},
  context:{spot:23000,pdc:23100}});
 return {ok:true,mode:'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1',source:'EXISTING_POSTGRES_H1_REPLAY',safety:{readOnly:true,writesPerformed:false},
  identity:{symbol:'NIFTY',date,expiry:date,strike,side:'PE'},event:{timeIst:'10:45',availableAt:at('10:45')},
  provenance:{selectedEvidenceSha256:'a'.repeat(64)},beforeAndAt:[point('10:42',-3,100),point('10:45',0,110)],
  outcomes:[point('10:48',3,outcome)]};
}
const rule:RecorderMatchRule={version:'FIXTURE_RULE_V1',declaredAt:'2026-10-01T00:00:00Z',
 features:['PREMIUM_3M_DIRECTION','SPOT_VS_PDC'],horizonMinutes:3,movement:'INCREASE',minimumMovePct:10,minIndependentSessions:2};
const dates=['2026-10-19','2026-10-20','2026-10-21'];
const scope={source:'EXISTING_POSTGRES_H1_REPLAY' as const,sessionDates:dates,complete:true,truncated:false,failedSessionDates:[]};
const target=()=>snapshot('2026-10-26');
const history=()=>dates.map((d,i)=>snapshot(d,i===2?99:132));

test('counts actual matched outcomes, exposes support and uncertainty, and never consumes LLM confidence',()=>{
 const t:any=target(),h:any[]=history();t.probability=99;t.similarity=99;
 for(const raw of h){raw.probability=99;raw.comparison={selectedChangePercent:-100};}
 const before=JSON.stringify([t,h,rule,scope]),r=compute(t,h,rule,scope);
 assert.equal(r.status,'AVAILABLE');assert.equal(r.counts.resolved,3);assert.equal(r.counts.qualifying,2);
 assert.equal(r.ratePct,2/3*100);assert.equal(r.episodes.length,3);
 assert(r.confidence95Pct&&r.confidence95Pct.low<r.ratePct!&&r.confidence95Pct.high>r.ratePct!);
 assert(r.episodes.every(x=>x.recorderEventId&&x.sourceDate&&x.evidenceSha256&&x.outcomeAvailableAt));
 assert.equal(JSON.stringify([t,h,rule,scope]),before);
});
test('same/current or future session, wrong index, time, side, calendar DTE or moneyness cannot add support',()=>{
 const h:any[]=history();h.push(target(),snapshot('2026-10-27'));
 const otherIndex:any=snapshot('2026-10-19');otherIndex.identity.symbol='SENSEX';h.push(otherIndex);
 const otherSide:any=snapshot('2026-10-20');otherSide.identity.side='CE';otherSide.beforeAndAt.forEach((p:any)=>{p.pair.ce=p.pair.pe;});h.push(otherSide);
 const otherDte:any=snapshot('2026-10-21');otherDte.identity.expiry='2026-10-22';h.push(otherDte);
 h.push(snapshot('2026-10-21',132,22900));
 const r=compute(target(),h,rule,scope);
 assert.equal(r.counts.outsideScope,2);assert.equal(r.counts.unmatched,4);
 assert.equal(r.ratePct,2/3*100);assert.equal(r.counts.resolved,3);
 const shifted:any=snapshot('2026-10-19');
 for(const p of [...shifted.beforeAndAt,...shifted.outcomes]){
  for(const key of ['bucketAt','receiptAt'])p[key]=new Date(Date.parse(p[key])+180000).toISOString();
  p.timeIst=new Date(Date.parse(p.bucketAt)+19800000).toISOString().slice(11,16);
  for(const key of ['quoteAt','receiptAt'])p.pair.pe[key]=new Date(Date.parse(p.pair.pe[key])+180000).toISOString();
 }
 shifted.event.timeIst='10:48';shifted.event.availableAt=shifted.beforeAndAt[1].receiptAt;
 assert.equal(compute(target(),[...history(),shifted],rule,scope).counts.unmatched,1);
});
test('unknown/missing match features and late event quotes cannot yield a number',()=>{
 const t:any=target();t.beforeAndAt[1].pair.pe.quoteAt=new Date(Date.parse(t.event.availableAt)+4000).toISOString();
 assert.equal(compute(t,history(),rule,scope).ratePct,null);
 for(const mutate of [(x:any)=>x.beforeAndAt.shift(),(x:any)=>{x.beforeAndAt[1].context.pdc=null;}]){
  const h=history();mutate(h[0]);const r=compute(target(),h,rule,scope);
  assert.equal(r.ratePct,null);assert.equal(r.reason,'INCOMPLETE_OR_CONFLICTING_RECORDER_EVIDENCE');
 }
 assert.equal(compute(target(),history(),{...rule,features:['O_EQUALS_H'] as any},scope).reason,'MATCH_RULE_NOT_CONFIGURED');
});
test('duplicates do not inflate sample size and conflicting copies with the same claimed hash block a result',()=>{
 const h=history(),r=compute(target(),[...h,h[0],structuredClone(h[0])],rule,scope);
 assert.equal(r.ratePct,2/3*100);assert.equal(r.counts.duplicates,2);assert.equal(r.counts.resolved,3);
 const changed=structuredClone(h[0]);changed.outcomes[0].pair.pe.price=70;
 const denied=compute(target(),[...h,changed],rule,scope);
 assert.equal(denied.ratePct,null);assert.equal(denied.counts.conflicts,1);
});
test('choose one episode per session before outcomes; a missing outcome cannot be replaced by a later winner',()=>{
 const h=history(),missing=structuredClone(h[0]);missing.outcomes=[];
 const later:any=snapshot(dates[0],150,23200);later.event.availableAt=later.beforeAndAt[1].receiptAt.replace('25.000','26.000');
 later.beforeAndAt[1].receiptAt=later.event.availableAt;
 later.beforeAndAt[1].pair.pe.receiptAt=later.event.availableAt;
 const r=compute(target(),[later,missing,...h.slice(1)],rule,scope);
 assert.equal(r.counts.selectedSessions,3);assert.equal(r.counts.matchedEpisodes,4);
 assert.equal(r.counts.missingOutcomes,1);assert.equal(r.ratePct,null);
 const all=compute(target(),[h[0],snapshot(dates[0],150,23200),...h.slice(1)],rule,scope);
 assert.equal(all.counts.resolved,3);assert.equal(all.ratePct,2/3*100);
});
test('requires explicit support, a predeclared rule and complete successful history scope',()=>{
 assert.equal(compute(target(),history(),{...rule,minIndependentSessions:4},scope).ratePct,null);
 assert.equal(compute(target(),history(),{...rule,declaredAt:'2026-10-27T00:00:00Z'},scope).reason,'RULE_DECLARED_AFTER_TARGET_CUTOFF');
 for(const change of [{complete:false},{truncated:true},{failedSessionDates:[dates[0]]},{sessionDates:[]},{sessionDates:[...dates,'2026-10-26']}])
  assert.equal(compute(target(),history(),rule,{...scope,...change}).reason,'COMPLETE_HISTORY_SCOPE_UNAVAILABLE');
 const broken:any=history();broken[0].mode='LLM_PREDICTION';assert.equal(compute(target(),broken,rule,scope).ratePct,null);
});
test('outcome horizon and direction are explicit, with bounded Wilson intervals at zero/all successes',()=>{
 const zeros=compute(target(),dates.map(d=>snapshot(d,99)),rule,scope);
 assert.equal(zeros.ratePct,0);assert.equal(zeros.confidence95Pct?.low,0);assert(zeros.confidence95Pct!.high>0);
 const all=compute(target(),dates.map(d=>snapshot(d,132)),rule,scope);
 assert.equal(all.ratePct,100);assert(all.confidence95Pct!.low<100);assert.equal(all.confidence95Pct?.high,100);
 const down=compute(target(),dates.map(d=>snapshot(d,88)),{...rule,movement:'DECREASE'},scope);assert.equal(down.ratePct,100);
 const absent=compute(target(),history(),{...rule,horizonMinutes:15},scope);assert.equal(absent.counts.missingOutcomes,3);assert.equal(absent.ratePct,null);
});

test('an exact 10 percent decrease qualifies at the configured boundary',()=>{
 const r=compute(target(),dates.map(d=>snapshot(d,99)),{...rule,movement:'DECREASE'},scope);
 assert.equal(r.ratePct,100);
});
test('rounded display deltas cannot turn a tiny recorded increase into a flat matching signature',()=>{
 const t=target();t.beforeAndAt[1].pair.pe.price=100.00001;
 const h=history();for(const raw of h)raw.beforeAndAt[1].pair.pe.price=100;
 const r=compute(t,h,rule,scope);
 assert.equal(r.counts.unmatched,3);assert.equal(r.ratePct,null);
});
test('decimal and exponent thresholds are inclusive without admitting a value below the threshold',()=>{
 const withPrices=(date:string,start:number,end:number)=>{
  const raw=snapshot(date,end);raw.beforeAndAt[0].pair.pe.price=start/2;raw.beforeAndAt[1].pair.pe.price=start;return raw;
 };
 for(const [start,end,threshold] of [[0.2,0.3,50],[0.1,0.09,10],[1e-7,2e-7,100]]){
  const r=compute(withPrices('2026-10-26',start,end),dates.map(d=>withPrices(d,start,end)),
   {...rule,movement:end>start?'INCREASE':'DECREASE',minimumMovePct:threshold},scope);
  assert.equal(r.ratePct,100);
 }
 const below=compute(target(),dates.map(d=>snapshot(d,121-1e-10)),rule,scope);
 assert.equal(below.ratePct,0);
});
test('missing read-only attestation and overflowed outcome arithmetic cannot yield a number',()=>{
 const h:any[]=history();delete h[0].safety.writesPerformed;
 assert.equal(compute(target(),h,rule,scope).ratePct,null);
 const extreme=(date:string)=>{const raw=snapshot(date,1e308);raw.beforeAndAt[0].pair.pe.price=.05;raw.beforeAndAt[1].pair.pe.price=.1;return raw;};
 const r=compute(extreme('2026-10-26'),dates.map(extreme),rule,scope);
 assert.equal(r.ratePct,null);assert.equal(r.counts.missingOutcomes,3);
});
