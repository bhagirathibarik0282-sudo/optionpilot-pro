import test from "node:test";
import assert from "node:assert/strict";
import { deriveOptionBuyerNetPayoffResearch } from "../option-buyer-net-payoff-research.js";

const q="VERIFIED" as const;
const base={exchange:"NSE" as const,quantity:130,entry:{bid:99,ask:100,quality:q},exit:{bid:110,ask:111,quality:q}};

test("uses executable ask to bid and produces net payoff below gross",()=>{
  const out=deriveOptionBuyerNetPayoffResearch(base);
  assert.equal(out.state,"USABLE");
  assert.equal(out.entryAsk,100);
  assert.equal(out.exitBid,110);
  assert.equal(out.grossPnl,1300);
  assert.ok((out.totalCharges??0)>0);
  assert.ok((out.netPnl??0)<1300);
  assert.ok((out.netReturnPctOnPremium??0)>0);
});

test("verified quote required",()=>{
  const out=deriveOptionBuyerNetPayoffResearch({...base,entry:{...base.entry,quality:"STALE" as const}});
  assert.equal(out.state,"UNAVAILABLE");
  assert.ok(out.blockers.includes("QUOTE_NOT_VERIFIED"));
});

test("crossed market fails closed",()=>{
  const out=deriveOptionBuyerNetPayoffResearch({...base,entry:{bid:101,ask:100,quality:q}});
  assert.equal(out.state,"UNAVAILABLE");
  assert.ok(out.blockers.includes("ENTRY_CROSSED_MARKET"));
});

test("small gross win can become net loss after friction",()=>{
  const out=deriveOptionBuyerNetPayoffResearch({...base,exit:{bid:100.2,ask:100.4,quality:q}});
  assert.equal(out.state,"USABLE");
  assert.ok((out.grossPnl??0)>0);
  assert.ok((out.netPnl??0)<0);
});

test("market impact is not fabricated and layer has zero live authority",()=>{
  const out=deriveOptionBuyerNetPayoffResearch(base);
  assert.equal(out.marketImpactPolicy,"UNMODELED_NO_SYNTHETIC_SLIPPAGE");
  assert.equal(out.affectsVerdict,false);
  assert.equal(out.affectsTelegram,false);
  assert.equal(out.affectsExecution,false);
  assert.equal(out.createsOrders,false);
  assert.equal(out.aiMayOverride,false);
});
