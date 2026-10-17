import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSellerBasketMarginProof, type SellerBasketMarginProof} from '../seller-kite-margin-proof-shadow.js';
const base:SellerBasketMarginProof={
  source:'KITE_BASKET_MARGIN_RESPONSE',requestId:'req-1',responseId:'resp-1',snapshotId:'snap-1',
  requestedAtMs:1000,receivedAtMs:1100,asOfMs:1200,maxAgeMs:500,marginRequired:20000,
  shortLeg:{instrumentToken:11,exchange:'NFO',tradingSymbol:'NIFTY26OCT25000CE',expiry:'2026-10-20',strike:25000,optionType:'CE',transactionType:'SELL',quantity:65},
  longLeg:{instrumentToken:12,exchange:'NFO',tradingSymbol:'NIFTY26OCT25100CE',expiry:'2026-10-20',strike:25100,optionType:'CE',transactionType:'BUY',quantity:65}
};
test('complete declared evidence is observational only',()=>{const r=validateSellerBasketMarginProof(base);assert.equal(r.verified,true);assert.equal(r.createsOrders,false);assert.equal(r.affectsExecution,false);});
for (const [name,change] of [
 ['no response ID',{responseId:''}],
 ['wrong source',{source:'FAKE'}],
 ['stale response',{asOfMs:5000}],
 ['future response',{receivedAtMs:1300}],
 ['zero margin',{marginRequired:0}],
 ['mismatched quantity',{longLeg:{...base.longLeg,quantity:130}}],
 ['same token',{longLeg:{...base.longLeg,instrumentToken:11}}],
 ['wrong hedge direction',{longLeg:{...base.longLeg,strike:24900}}],
 ['wrong expiry',{longLeg:{...base.longLeg,expiry:'2026-10-27'}}],
 ['wrong side',{shortLeg:{...base.shortLeg,transactionType:'BUY'}}],
] as const) {
 test(`fail closed: ${name}`,()=>{const r=validateSellerBasketMarginProof({...base,...change} as SellerBasketMarginProof);assert.equal(r.verified,false);assert.equal(r.createsOrders,false);});
}

for (const [name, input] of [
  ['null', null],
  ['undefined', undefined],
  ['array', []],
  ['numeric request ID', {...base, requestId: 42}],
  ['object response ID', {...base, responseId: {}}],
  ['numeric snapshot ID', {...base, snapshotId: 42}],
  ['numeric exchange', {...base, shortLeg: {...base.shortLeg, exchange: 42}}],
  ['numeric symbol', {...base, longLeg: {...base.longLeg, tradingSymbol: 42}}],
  ['impossible expiry', {...base, shortLeg: {...base.shortLeg, expiry:'2026-02-30'}, longLeg: {...base.longLeg, expiry:'2026-02-30'}}],
  ['same trading symbol', {...base, longLeg: {...base.longLeg, tradingSymbol:base.shortLeg.tradingSymbol}}],
] as const) {
  test(`malformed evidence fails closed without throwing: ${name}`, () => {
    const result = validateSellerBasketMarginProof(input as unknown as SellerBasketMarginProof);
    assert.equal(result.verified, false);
    assert.equal(result.createsOrders, false);
    assert.equal(result.affectsExecution, false);
  });
}

test('valid declaration does not authenticate broker provenance', () => {
  const result = validateSellerBasketMarginProof(base);
  assert.equal(result.verified, true);
  assert.equal(result.brokerProvenanceVerified, false);
  assert.equal(result.structureOnly, true);
});

test('valid PE credit spread remains structurally accepted', () => {
  const result = validateSellerBasketMarginProof({...base,
    shortLeg:{...base.shortLeg,optionType:'PE',tradingSymbol:'NIFTY26OCT25000PE'},
    longLeg:{...base.longLeg,optionType:'PE',strike:24900,tradingSymbol:'NIFTY26OCT24900PE'},
  });
  assert.equal(result.verified, true);
});
