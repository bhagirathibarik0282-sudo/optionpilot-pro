import test from 'node:test';
import assert from 'node:assert/strict';
import {alignRagDteEvidence,type DteEvidencePoint} from '../rag-dte-alignment.js';
const selection={symbol:'NIFTY',date:'2026-10-13',strike:22300,side:'PE' as const,timeIst:'09:36'};
const point=(expiry:string,price:number):DteEvidencePoint=>({...selection,expiry,price,previousPrice:10,quoteAt:'2026-10-13T04:06:20.000Z',receiptAt:'2026-10-13T04:06:24.000Z',snapshotId:'verified',previousQuoteAt:'2026-10-13T04:03:20.000Z',previousReceiptAt:'2026-10-13T04:03:24.000Z',previousSnapshotId:'verified-before'});
test('different expiries remain separate and alignment requires two verified contracts',()=>{
 const result=alignRagDteEvidence([point('2026-10-13',12),point('2026-10-20',11)],selection);
 assert.equal(result.coverage.verifiedExpiries,2);
 assert.deepEqual(result.accepted.map(x=>x.dte),[0,7]);
 assert.equal(result.direction.agreement,'ALL_VERIFIED_SAME_DIRECTION');
});
test('missing, duplicate and future observations cannot create alignment',()=>{
 const future={...point('2026-10-20',12),receiptAt:'2026-10-13T04:09:24.000Z'};
 const r=alignRagDteEvidence([point('2026-10-13',12),point('2026-10-13',12),future,point('2026-10-27',0)],selection,Date.parse('2026-10-13T04:07:00Z'));
 assert.equal(r.coverage.verifiedExpiries,0);
 assert.equal(r.blocked.length,3);
 assert.equal(r.direction.agreement,'NOT_ESTABLISHED');
});
test('other index, strike, side and time are never substituted',()=>{
 const r=alignRagDteEvidence([{...point('2026-10-13',12),symbol:'SENSEX'},{...point('2026-10-20',12),side:'CE'}],selection);
 assert.equal(r.coverage.observedExpiries,0);
 assert.equal(r.status,'UNAVAILABLE');
});

test('previous baseline must be independently timestamped and verified',()=>{
 const base=point('2026-10-13',12);
 for(const invalid of [
  {...base,previousQuoteAt:null},
  {...base,previousReceiptAt:null},
  {...base,previousSnapshotId:null},
  {...base,previousSnapshotId:base.snapshotId},
  {...base,previousQuoteAt:'2026-10-13T04:06:20.000Z'},
  {...base,previousReceiptAt:'2026-10-13T04:09:24.000Z'}
 ]) {
  const r=alignRagDteEvidence([invalid],selection);
  assert.equal(r.coverage.verifiedExpiries,0);
 }
});
