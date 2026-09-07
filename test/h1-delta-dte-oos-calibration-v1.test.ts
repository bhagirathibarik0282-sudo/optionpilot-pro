import test from "node:test";
import assert from "node:assert/strict";
import { runH1DeltaDteOosCalibration } from "../h1-delta-dte-oos-calibration-v1.js";

const mk=(tradeDate:string,expiry:string,base:number)=>({tradeDate,rows:[0,1,2,3].flatMap(i=>{const t=new Date(`${tradeDate}T03:45:00.000Z`).getTime()+i*360000;const common={symbol:"NIFTY",expiry,strike:24000,optionType:"CE" as const,ltp:100,gamma:.002};return [{...common,minuteBucket:new Date(t).toISOString(),delta:.4+i*base},{...common,minuteBucket:new Date(t+180000).toISOString(),delta:.4+(i+1)*base}];})});

test("DTE OOS calibration stays research-only and segments buckets",()=>{
  const days=[mk("2026-09-01","2026-09-02",.01),mk("2026-09-02","2026-09-08",.02),mk("2026-09-03","2026-09-15",.03),mk("2026-09-04","2026-09-30",.04)];
  const r=runH1DeltaDteOosCalibration(days);
  assert.equal(r.productionImpact,"NONE");assert.equal(r.affectsSelector,false);assert.equal(r.affectsExecution,false);assert.equal(r.failClosed,true);
  assert.equal(r.buckets.length,4);assert.ok(r.buckets.some(x=>x.calibration.sampleCount>0));
});
