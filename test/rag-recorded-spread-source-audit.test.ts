import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRecordedSpreadForRag} from '../rag-recorded-spread-source-audit.js';
// Three real values and times transcribed from a user-provided archived 1m export.
// This *small fixture* is not the full archive nor an H1 market snapshot.
const iso=(t:string,seconds:number)=>{
 const d=new Date(Date.parse('2026-10-19T'+t+':00+05:30')+seconds*1000);
 return d.toISOString().replace('Z','.000Z').replace('.000.000Z','.000Z');
};
function row(t:string,ce:number,pe:number,secondsCE=1,secondsPE=1,status='TRUE_ELIGIBLE_BOTH') {
 return {minute:iso(t,0),timeIst:t,status,ceLtp:ce,peLtp:pe,gap:Number((ce-pe).toFixed(2)),
  ceValidation:status==='TRUE_ELIGIBLE_BOTH'?'RESEARCH_ELIGIBLE':'TIMESTAMP_PRESENT',
  peValidation:status==='TRUE_ELIGIBLE_BOTH'?'RESEARCH_ELIGIBLE':'TIMESTAMP_PRESENT',
  ceQuoteTime:iso(t,secondsCE),peQuoteTime:iso(t,secondsPE)};
}
const base=()=>({ok:true,mode:'READ_ONLY_PREMIUM_SPREAD_COMPARISON_V1',source:'EXISTING_H1_FIXED_CONTRACT_JOURNEY',
 cadence:'EXACT_1M_NO_INTERPOLATION',safety:{readOnly:true},
 request:{symbol:'NIFTY',date:'2026-10-19',expiry:'2026-10-19',ce:22900,pe:23150},
 rows:[row('10:42',144.2,153.85),row('10:45',156,137.1,1,0),row('10:48',152.6,142.9,0,1)]});
test('recorded 10:42 -> 10:45 -> 10:48 example reports only exact 3m eligible spread measurements',()=>{
 const r=auditRecordedSpreadForRag(base(),'10:45');
 assert.equal(r.ok,true);if(!r.ok)return;
 assert.equal(r.totalRows,3);
 assert.equal(r.strictThreeMinuteTriplets,1);
 assert.equal(r.selected?.beforeToEvent.ceChange,11.8);
 assert.equal(r.selected?.beforeToEvent.peChange,-16.75);
 assert.equal(r.selected?.beforeToEvent.gapChange,28.55);
 assert.equal(r.selected?.event.gap,18.9);
 assert.equal(r.bridgeReady,false);
 assert.ok(r.blockers.includes('MISSING_EXACT_H1_SNAPSHOT_ID'));
 assert.ok(r.blockers.includes('MISSING_RECORDED_MARKET_RECEIPT_AT'));
});
test('10:45 strict input missing previous eligible endpoint cannot fabricate baseline',()=>{
 const x=base();x.rows[0].status='TRUE_DIAGNOSTIC';
 const result=auditRecordedSpreadForRag(x,'10:45');
 assert.equal(result.ok,true);
 if(result.ok){assert.equal(result.strictThreeMinuteTriplets,0);assert.equal(result.selected,null);
  assert.equal(result.bridgeReady,false);}
});
test('time or data anomalies are excluded, not reclassified as accepted H1 evidence',()=>{
 const x=base();x.rows[1].ceQuoteTime=iso('10:48',1);
 const result=auditRecordedSpreadForRag(x,'10:45');
 assert.equal(result.ok,true);
 if(result.ok)assert.equal(result.strictThreeMinuteTriplets,0);
 const duplicate=base();duplicate.rows.push(duplicate.rows[1]);
 const d=auditRecordedSpreadForRag(duplicate,'10:45');
 assert.equal(d.ok,true);
 if(d.ok){assert.equal(d.duplicates,1);assert.equal(d.strictThreeMinuteTriplets,0);}
});
test('no implicit alternate date/index/contract, no writes or market-data hallucinations',()=>{
 const invalid=base();invalid.mode='READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1';
 assert.equal(auditRecordedSpreadForRag(invalid,'10:45').ok,false);
 const v=auditRecordedSpreadForRag(base(),'10:45');
 assert.equal(v.ok,true);
 if(v.ok){assert.equal(v.sourceScope.ceStrike,22900);assert.equal(v.sourceScope.peStrike,23150);
  assert.equal(v.safety.noDbWrites,true);assert.equal(v.safety.affectsExecution,false);
  assert.equal('spot' in (v.selected??{}),false);}
});
