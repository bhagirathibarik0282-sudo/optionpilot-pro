import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSellerResearchCard} from '../seller-research-evidence-bridge-v1.js';

const quote = {
  symbol:'NIFTY' as const, expiry:'2026-10-20',side:'CE' as const,
  shortStrike:25000,longStrike:25100,shortBid:90,longAsk:50,
  lotSize:65,lots:1,shortObservedAtMs:1000,longObservedAtMs:1000,
  asOfMs:1100,maxQuoteAgeMs:500,estimatedRoundTripCosts:50,
  availableCapital:100000,brokerMarginRequired:20000
};
const base = {
  source:'RECORDED' as const,snapshotId:'snapshot-1',
  shortContractId:'short-1',longContractId:'long-1',
  shortExpiry:quote.expiry,longExpiry:quote.expiry,
  shortQuoteSnapshotId:'snapshot-1',longQuoteSnapshotId:'snapshot-1',
  shortQuoteContractId:'short-1',longQuoteContractId:'long-1',
  quoteSource:'BROKER_BID_ASK' as const,marginSnapshotId:'snapshot-1',
  marginSource:'BROKER_MARGIN' as const,maxLegSkewMs:500,quote
};
for (const [name,changes] of [
  ['missing broker margin',{brokerMarginRequired:null}],
  ['zero broker margin',{brokerMarginRequired:0}],
  ['capital below broker margin',{availableCapital:100}],
  ['future short quote',{shortObservedAtMs:1200}],
  ['stale long quote',{longObservedAtMs:1}],
  ['invalid crossed credit',{longAsk:95}],
  ['wrong hedge direction',{longStrike:24900}],
] as const) {
  test(`seller remains BLOCKED for ${name}`,()=>{
    const r=buildSellerResearchCard({...base,quote:{...quote,...changes}});
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.createsOrders,false);
    assert.equal(r.affectsExecution,false);
  });
}
test('same snapshot labels do not confer execution authority',()=>{
  const r=buildSellerResearchCard(base);
  assert.equal(r.status,'RESEARCH_ONLY');
  assert.equal(r.createsOrders,false);
  assert.equal(r.affectsExecution,false);
});
