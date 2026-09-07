import test from "node:test";
import assert from "node:assert/strict";
import { runH1DeltaDteOosCalibration } from "../h1-delta-dte-oos-calibration-v1.js";

const mk=(tradeDate:string,expiry:string,base:number,dte?:number)=>({tradeDate,rows:[0,1,2,3].flatMap(i=>{const t=new Date(`${tradeDate}T03:45:00.000Z`).getTime()+i*360000;const common={symbol:"NIFTY",expiry,strike:24000,optionType:"CE" as const,ltp:100,gamma:.002,...(dte===undefined?{}:{dte})};return [{...common,minuteBucket:new Date(t).toISOString(),delta:.4+i*base},{...common,minuteBucket:new Date(t+180000).toISOString(),delta:.4+(i+1)*base}];})});

test("DTE OOS calibration stays research-only and segments buckets",()=>{
  const days=[mk("2026-09-01","2026-09-02",.01),mk("2026-09-02","2026-09-08",.02),mk("2026-09-03","2026-09-15",.03),mk("2026-09-04","2026-09-30",.04)];
  const r=runH1DeltaDteOosCalibration(days);
  assert.equal(r.productionImpact,"NONE");assert.equal(r.affectsSelector,false);assert.equal(r.affectsExecution,false);assert.equal(r.failClosed,true);
  assert.equal(r.buckets.length,4);assert.ok(r.buckets.some(x=>x.calibration.sampleCount>0));
});

test("canonical replay dte is preferred when expiry is unusable",()=>{
  const days=[mk("2026-09-01","undefined",.01,1),mk("2026-09-02","undefined",.02,3),mk("2026-09-03","undefined",.03,7),mk("2026-09-04","undefined",.04,14)];
  const r=runH1DeltaDteOosCalibration(days);
  const populated=r.buckets.filter(x=>x.calibration.sampleCount>0||x.validation.sampleCount>0);
  assert.equal(populated.length,4);
  assert.equal(r.affectsSelector,false);assert.equal(r.affectsTelegram,false);assert.equal(r.affectsExecution,false);assert.equal(r.failClosed,true);
});
