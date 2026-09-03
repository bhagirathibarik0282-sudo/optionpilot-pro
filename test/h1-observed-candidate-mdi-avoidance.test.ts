import test from "node:test";
import assert from "node:assert/strict";
import { analyzeObservedCandidateMdiAvoidance } from "../h1-observed-candidate-mdi-avoidance.js";
import type { MdiInput, MdiSourceQualityMap } from "../mdi-research-shadow.js";
import type { ObservedCandidate30mSample } from "../h1-observed-candidate-30m-gross.js";

const verified:MdiSourceQualityMap={PCR:"VERIFIED",WALL:"VERIFIED",IV:"VERIFIED",VIX:"VERIFIED",FUTURES:"VERIFIED"};
const mdi=(bull=true,ts="2026-09-03T04:03:00.000Z"):MdiInput=>({
 previous:{ts:"2026-09-03T04:00:00.000Z",sourceQuality:verified,fullPcr:.8,band7Pcr:.8,callWallStrike:24000,putWallStrike:23800,callWallStrength:100,putWallStrength:100,ceIv:12,peIv:12,indiaVix:12,futureLtp:23900},
 current:{ts,sourceQuality:verified,fullPcr:bull?1.1:.5,band7Pcr:bull?1.1:.5,callWallStrike:bull?24050:23950,putWallStrike:bull?23850:23750,callWallStrength:bull?80:125,putWallStrength:bull?125:80,ceIv:bull?16:10,peIv:bull?10:16,indiaVix:bull?11:13,futureLtp:bull?24100:23700},
 strikeStep:50,
});
const payoff=(side:"CE"|"PE",ret:number,ts="2026-09-03T04:03:00.000Z"):ObservedCandidate30mSample=>({signalTs:ts,exitTs:"2026-09-03T04:33:00.000Z",symbol:"NIFTY",expiry:"2026-09-03",dte:1,strike:23900,side,entryAsk:100,exitBid:100*(1+ret/100),grossReturnPct:ret});

test("counts retained winners, avoided losers and missed winners",()=>{
 const out=analyzeObservedCandidateMdiAvoidance([
  {sampleId:"1",payoff:payoff("CE",10),mdiInput:mdi(true)},
  {sampleId:"2",payoff:payoff("CE",-8),mdiInput:mdi(false)},
  {sampleId:"3",payoff:payoff("CE",6),mdiInput:mdi(false)},
 ]);
 assert.equal(out.state,"USABLE");
 assert.equal(out.baselineCount,3);
 assert.equal(out.mdiAlignedCount,1);
 assert.equal(out.retainedWinners,1);
 assert.equal(out.avoidedLosers,1);
 assert.equal(out.missedWinners,1);
 assert.equal(out.avoidedLoserRatePct,100);
 assert.equal(out.missedWinnerRatePct,50);
});

test("PE aligns with bearish MDI",()=>{
 const out=analyzeObservedCandidateMdiAvoidance([{sampleId:"1",payoff:payoff("PE",7),mdiInput:mdi(false)}]);
 assert.equal(out.state,"USABLE");
 assert.equal(out.mdiAlignedCount,1);
});

test("MDI current timestamp must equal signal timestamp",()=>{
 const out=analyzeObservedCandidateMdiAvoidance([{sampleId:"1",payoff:payoff("CE",5),mdiInput:mdi(true,"2026-09-03T04:04:00.000Z")}]);
 assert.equal(out.state,"UNAVAILABLE");
 assert.ok(out.blockers.includes("MDI_TIMESTAMP_NOT_BOUND_TO_SIGNAL_TIMESTAMP"));
});

test("zero retained samples fail closed",()=>{
 const out=analyzeObservedCandidateMdiAvoidance([{sampleId:"1",payoff:payoff("CE",5),mdiInput:mdi(false)}]);
 assert.equal(out.state,"UNAVAILABLE");
 assert.ok(out.blockers.includes("NO_MDI_ALIGNED_OBSERVED_CANDIDATES"));
});

test("duplicate sample id fails closed",()=>{
 const x={sampleId:"dup",payoff:payoff("CE",5),mdiInput:mdi(true)};
 const out=analyzeObservedCandidateMdiAvoidance([x,x]);
 assert.equal(out.state,"UNAVAILABLE");
 assert.ok(out.blockers.includes("DUPLICATE_SAMPLE_ID"));
});

test("research only with zero live authority",()=>{
 const out=analyzeObservedCandidateMdiAvoidance([]);
 assert.equal(out.affectsVerdict,false);
 assert.equal(out.affectsTelegram,false);
 assert.equal(out.affectsExecution,false);
 assert.equal(out.createsOrders,false);
 assert.equal(out.aiMayOverride,false);
});
