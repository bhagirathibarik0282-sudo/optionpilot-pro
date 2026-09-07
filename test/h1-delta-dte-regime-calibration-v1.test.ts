import test from "node:test";
import assert from "node:assert/strict";
import { calibrateH1DeltaByDte } from "../h1-delta-dte-regime-calibration-v1.js";

const row=(dte:number, minuteBucket:string, delta:number)=>({
  symbol:"NIFTY", minuteBucket, expiry:"2026-09-08", strike:24000,
  optionType:"CE" as const, ltp:100, delta, gamma:0.002, dte,
});

test("calibrates exact 3m delta changes separately by DTE bucket",()=>{
  const r=calibrateH1DeltaByDte([
    row(1,"2026-09-07T03:45:00.000Z",0.40), row(1,"2026-09-07T03:48:00.000Z",0.42),
    row(3,"2026-09-07T03:45:00.000Z",0.30), row(3,"2026-09-07T03:48:00.000Z",0.31),
    row(7,"2026-09-07T03:45:00.000Z",0.50), row(7,"2026-09-07T03:48:00.000Z",0.54),
    row(12,"2026-09-07T03:45:00.000Z",0.60), row(12,"2026-09-07T03:48:00.000Z",0.605),
  ]);
  const by=Object.fromEntries(r.buckets.map(x=>[x.bucket,x]));
  assert.equal(by.EXPIRY_0_1.sampleCount,1);
  assert.equal(by.NEAR_2_4.sampleCount,1);
  assert.equal(by.MID_5_9.sampleCount,1);
  assert.equal(by.FAR_10_PLUS.sampleCount,1);
  assert.equal(r.productionImpact,"NONE");
  assert.equal(r.affectsSelector,false);
  assert.equal(r.affectsExecution,false);
  assert.equal(r.failClosed,true);
});
