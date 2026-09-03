import test from "node:test";
import assert from "node:assert/strict";
import { validateMdiReplayOutcome } from "../mdi-outcome-replay-validator.js";
import type { MdiInput, MdiSourceQualityMap } from "../mdi-research-shadow.js";

const verified: MdiSourceQualityMap = { PCR:"VERIFIED", WALL:"VERIFIED", IV:"VERIFIED", VIX:"VERIFIED", FUTURES:"VERIFIED" };

function mdiInput(): MdiInput {
  return {
    previous: { ts:"2026-09-02T04:00:00.000Z", sourceQuality:verified, fullPcr:.8, band7Pcr:.8, callWallStrike:24000, putWallStrike:23800, callWallStrength:100, putWallStrength:100, ceIv:12, peIv:12, indiaVix:12, futureLtp:23900 },
    current: { ts:"2026-09-02T04:03:00.000Z", sourceQuality:verified, fullPcr:1.0, band7Pcr:1.0, callWallStrike:24050, putWallStrike:23850, callWallStrength:85, putWallStrength:120, ceIv:15, peIv:11, indiaVix:11.5, futureLtp:24020 },
    strikeStep:50,
  };
}

const signal = {
  mdiInput: mdiInput(),
  signalTs:"2026-09-02T04:03:00.000Z",
  spotLtp:23900,
  ce:{ expiry:"2026-09-03", strike:23900, optionType:"CE" as const, ltp:100 },
  pe:{ expiry:"2026-09-03", strike:23900, optionType:"PE" as const, ltp:100 },
};

function future(ts:string, spot:number, ce:number, pe:number, ceStrike=23900){
  return { ts, spotLtp:spot, premiums:[
    { expiry:"2026-09-03", strike:ceStrike, optionType:"CE" as const, ltp:ce },
    { expiry:"2026-09-03", strike:23900, optionType:"PE" as const, ltp:pe },
  ]};
}

test("bullish verified MDI is aligned when spot rises and same-contract CE dominates",()=>{
  const out=validateMdiReplayOutcome(signal,[
    future("2026-09-02T04:06:00.000Z",23920,112,94),
    future("2026-09-02T04:09:00.000Z",23940,120,90),
    future("2026-09-02T04:18:00.000Z",23960,128,86),
    future("2026-09-02T04:33:00.000Z",23980,136,82),
  ]);
  assert.equal(out.mdiCoveragePct,100);
  assert.ok((out.mdi??0)>=25);
  assert.equal(out.windows.every(w=>w.alignment==="ALIGNED"),true);
});

test("exact horizon is required; nearest-minute substitution is forbidden",()=>{
  const out=validateMdiReplayOutcome(signal,[future("2026-09-02T04:07:00.000Z",23920,112,94)]);
  assert.equal(out.windows.find(w=>w.horizonMinutes===3)!.alignment,"UNAVAILABLE");
});

test("same expiry and strike contracts are required for premium outcome",()=>{
  const out=validateMdiReplayOutcome(signal,[future("2026-09-02T04:06:00.000Z",23920,112,94,23950)]);
  const w=out.windows.find(x=>x.horizonMinutes===3)!;
  assert.equal(w.ceReturnPct,null);
  assert.equal(w.alignment,"UNAVAILABLE");
});

test("partial verified MDI fails closed for business proof",()=>{
  const partial=mdiInput();
  partial.current.sourceQuality={...verified,IV:"DEGRADED"};
  const out=validateMdiReplayOutcome({...signal,mdiInput:partial},[future("2026-09-02T04:06:00.000Z",23920,112,94)]);
  assert.ok(out.blockers.includes("MDI_NOT_FULLY_VERIFIED"));
  assert.equal(out.windows.every(w=>w.alignment==="UNAVAILABLE"),true);
});

test("signal timestamp must be bound to MDI current timestamp",()=>{
  const out=validateMdiReplayOutcome({...signal,signalTs:"2026-09-02T04:04:00.000Z"},[]);
  assert.ok(out.blockers.includes("SIGNAL_TIMESTAMP_NOT_BOUND_TO_MDI_CURRENT"));
});

test("validator has zero live authority",()=>{
  const out=validateMdiReplayOutcome(signal,[]);
  assert.equal(out.affectsVerdict,false);
  assert.equal(out.affectsTelegram,false);
  assert.equal(out.affectsExecution,false);
  assert.equal(out.createsOrders,false);
  assert.equal(out.aiMayOverride,false);
});
