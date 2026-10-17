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
