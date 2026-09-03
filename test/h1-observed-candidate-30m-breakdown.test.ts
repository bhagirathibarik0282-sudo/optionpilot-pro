import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedCandidate30mBreakdown } from "../h1-observed-candidate-30m-breakdown.js";
import type { ObservedCandidate30mSample } from "../h1-observed-candidate-30m-gross.js";

const sample = (symbol:"NIFTY"|"SENSEX"|"BANKNIFTY", side:"CE"|"PE", dte:number, ret:number, i:number):ObservedCandidate30mSample => ({
  signalTs:`2026-09-03T04:${String(i).padStart(2,"0")}:00.000Z`,
  exitTs:`2026-09-03T04:${String(i+30).padStart(2,"0")}:00.000Z`,
  symbol,
  expiry:"2026-09-03",
  dte,
  strike:symbol==="BANKNIFTY"?57000:24000,
  side,
  entryAsk:100,
  exitBid:100*(1+ret/100),
  grossReturnPct:ret,
});

test("splits NIFTY by side and existing DTE bucket",()=>{
  const out=buildObservedCandidate30mBreakdown("NIFTY",[
    sample("NIFTY","CE",1,10,1),
    sample("NIFTY","CE",1,-5,2),
    sample("NIFTY","PE",3,4,3),
  ]);
  assert.equal(out.state,"USABLE");
  assert.equal(out.cells.length,2);
  const ce=out.cells.find(c=>c.side==="CE")!;
  assert.equal(ce.dteBucket,"EXPIRY_0_1");
  assert.equal(ce.sampleCount,2);
  assert.equal(ce.positiveRatePct,50);
  assert.equal(ce.lossRatePct,50);
  assert.equal(ce.averageGrossReturnPct,2.5);
  assert.equal(ce.medianGrossReturnPct,2.5);
  assert.equal(ce.bestGrossReturnPct,10);
  assert.equal(ce.worstGrossReturnPct,-5);
});

test("BANKNIFTY allows only higher DTE 10-35",()=>{
  const out=buildObservedCandidate30mBreakdown("BANKNIFTY",[
    sample("BANKNIFTY","CE",12,8,1),
    sample("BANKNIFTY","CE",5,2,2),
  ]);
  assert.equal(out.state,"USABLE");
  assert.equal(out.includedSamples,1);
  assert.equal(out.excludedUnsupportedDte,1);
  assert.equal(out.cells[0].dteBucket,"BANKNIFTY_HIGHER_10_35");
});

test("unsupported-only data fails closed",()=>{
  const out=buildObservedCandidate30mBreakdown("NIFTY",[sample("NIFTY","CE",8,3,1)]);
  assert.equal(out.state,"UNAVAILABLE");
  assert.ok(out.blockers.includes("NO_SUPPORTED_DTE_OBSERVED_CANDIDATE_30M_SAMPLES"));
});

test("ignores samples for other symbol",()=>{
  const out=buildObservedCandidate30mBreakdown("NIFTY",[sample("SENSEX","CE",1,3,1)]);
  assert.equal(out.state,"UNAVAILABLE");
  assert.equal(out.includedSamples,0);
});

test("research only with zero live authority",()=>{
  const out=buildObservedCandidate30mBreakdown("NIFTY",[]);
  assert.equal(out.affectsVerdict,false);
  assert.equal(out.affectsTelegram,false);
  assert.equal(out.affectsExecution,false);
  assert.equal(out.createsOrders,false);
  assert.equal(out.aiMayOverride,false);
});
