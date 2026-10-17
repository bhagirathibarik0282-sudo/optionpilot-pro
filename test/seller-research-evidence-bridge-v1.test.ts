import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSellerResearchCard} from '../seller-research-evidence-bridge-v1.js';
const quote = {symbol:'NIFTY' as const, expiry:'2026-10-20',side:'CE' as const,shortStrike:25000,longStrike:25100,shortBid:90,longAsk:50,lotSize:65,lots:1,shortObservedAtMs:1000,longObservedAtMs:1000,asOfMs:1100,maxQuoteAgeMs:500,estimatedRoundTripCosts:50,availableCapital:100000,brokerMarginRequired:20000};
const evidence = {source:'RECORDED' as const,snapshotId:'snapshot-1',shortContractId:'short-1',longContractId:'long-1',shortExpiry:quote.expiry,longExpiry:quote.expiry,shortQuoteSnapshotId:'snapshot-1',longQuoteSnapshotId:'snapshot-1',shortQuoteContractId:'short-1',longQuoteContractId:'long-1',quoteSource:'BROKER_BID_ASK' as const,marginSnapshotId:'snapshot-1',marginSource:'BROKER_MARGIN' as const,maxLegSkewMs:500,quote};
test('valid evidence stays read-only, seller-only, with no execution authority',()=>{const r=buildSellerResearchCard(evidence);assert.equal(r.status,'RESEARCH_ONLY');assert.equal(r.role,'OPTION_SELLER');assert.equal(r.createsOrders,false);assert.equal(r.affectsExecution,false);assert.equal(r.researchOnly,true);});
test('missing provenance blocks',()=>assert.equal(buildSellerResearchCard({...evidence,snapshotId:''}).status,'BLOCKED'));
test('mismatched expiry blocks',()=>assert.equal(buildSellerResearchCard({...evidence,longExpiry:'2026-10-27'}).status,'BLOCKED'));
test('same leg contract blocks',()=>assert.equal(buildSellerResearchCard({...evidence,longContractId:'short-1'}).status,'BLOCKED'));
test('stale quote blocks',()=>assert.equal(buildSellerResearchCard({...evidence,quote:{...quote,asOfMs:2000}}).status,'BLOCKED'));

test('reject mismatched long quote snapshot',()=>assert.equal(buildSellerResearchCard({...evidence,longQuoteSnapshotId:'other'}).status,'BLOCKED'));
test('reject mismatched leg quote contract',()=>assert.equal(buildSellerResearchCard({...evidence,longQuoteContractId:'other'}).status,'BLOCKED'));
test('reject unverified margin snapshot',()=>assert.equal(buildSellerResearchCard({...evidence,marginSnapshotId:'other'}).status,'BLOCKED'));
test('reject leg timestamp skew',()=>assert.equal(buildSellerResearchCard({...evidence,maxLegSkewMs:5,quote:{...quote,longObservedAtMs:1010}}).status,'BLOCKED'));
