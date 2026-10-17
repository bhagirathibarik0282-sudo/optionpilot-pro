import test from "node:test";
import assert from "node:assert/strict";
import {evaluateSellerVertical, type SellerVerticalQuote} from "../seller-vertical-economics-shadow.js";
const base: SellerVerticalQuote={symbol:"NIFTY",expiry:"2026-10-20",side:"CE",shortStrike:25000,longStrike:25100,shortBid:80,longAsk:50,lotSize:65,lots:1,shortObservedAtMs:1000,longObservedAtMs:1000,asOfMs:1100,maxQuoteAgeMs:200,estimatedRoundTripCosts:100,availableCapital:20000,brokerMarginRequired:8000};
test("CE vertical credit economics, shadow-only",()=>{const r=evaluateSellerVertical(base);assert.equal(r.ready,true);if(!r.ready)return;assert.equal(r.netCreditPerUnit,30);assert.equal(r.grossCredit,1950);assert.equal(r.estimatedMaxLoss,4650);assert.equal(r.breakeven,25030);assert.equal(r.createsOrders,false)});
test("PE credit spread has correct hedge and breakeven",()=>{const r=evaluateSellerVertical({...base,side:"PE",longStrike:24900});assert.equal(r.ready,true);if(r.ready)assert.equal(r.breakeven,24970)});
test("reject unhedged or reversed leg",()=>assert.equal(evaluateSellerVertical({...base,longStrike:24900}).ready,false));
test("reject stale quote",()=>assert.equal(evaluateSellerVertical({...base,asOfMs:2000}).ready,false));
test("reject negative credit",()=>assert.equal(evaluateSellerVertical({...base,shortBid:20}).ready,false));
test("reject missing broker margin",()=>assert.equal(evaluateSellerVertical({...base,brokerMarginRequired:null}).ready,false));
test("reject insufficient capital",()=>assert.equal(evaluateSellerVertical({...base,availableCapital:2000}).ready,false));
test("reject invalid lot size",()=>assert.equal(evaluateSellerVertical({...base,lotSize:1.5}).ready,false));
test("reject future quote",()=>assert.equal(evaluateSellerVertical({...base,longObservedAtMs:1200}).ready,false));

test('reject prefixed malformed expiry',()=>assert.equal(evaluateSellerVertical({...base,expiry:'x2026-10-20'}).ready,false));
test('reject after-cost negative credit',()=>assert.equal(evaluateSellerVertical({...base,estimatedRoundTripCosts:999999}).ready,false));
