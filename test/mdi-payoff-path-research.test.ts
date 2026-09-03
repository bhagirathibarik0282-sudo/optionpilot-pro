import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiPayoffPathResearch } from "../mdi-payoff-path-research.js";

const q="VERIFIED" as const;
const ce={expiry:"2026-09-03",strike:23900,optionType:"CE" as const,ltp:100,quality:q};
const pe={expiry:"2026-09-03",strike:23900,optionType:"PE" as const,ltp:100,quality:q};
const p=(ts:string,spot:number,ceLtp:number,peLtp:number)=>({ts,spotLtp:spot,spotQuality:q,premiums:[{...ce,ltp:ceLtp},{...pe,ltp:peLtp}]});
const base={signalTs:"2026-09-02T04:03:00.000Z",mdiBias:"MILD_BULLISH" as const,signalSpot:23900,signalSpotQuality:q,signalCe:ce,signalPe:pe};

test("bullish path computes spot and chosen-premium MFE/MAE",()=>{
 const out=deriveMdiPayoffPathResearch({...base,path:[p("2026-09-02T04:06:00.000Z",23920,112,94),p("2026-09-02T04:09:00.000Z",23890,96,106),p("2026-09-02T04:18:00.000Z",23960,128,86)]});
 assert.equal(out.state,"USABLE"); assert.equal(out.sampleCount,3); assert.ok((out.spotMfePct??0)>0); assert.ok((out.spotMaePct??0)<0); assert.equal(out.chosenPremiumMfePct,28); assert.equal(out.chosenPremiumMaePct,-4); assert.equal(out.chosenPremiumEndPct,28); assert.equal(out.oppositePremiumEndPct,-14);
});

test("cross-session path fails closed",()=>{const out=deriveMdiPayoffPathResearch({...base,path:[p("2026-09-03T04:06:00.000Z",23920,112,94)]});assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("CROSS_SESSION_PATH_POINT"));});

test("duplicate timestamp fails closed",()=>{const a=p("2026-09-02T04:06:00.000Z",23920,112,94);const out=deriveMdiPayoffPathResearch({...base,path:[a,{...a}]});assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("DUPLICATE_PATH_TIMESTAMP"));});

test("unverified contract path fails closed",()=>{const a=p("2026-09-02T04:06:00.000Z",23920,112,94);a.premiums[0].quality="STALE" as any;const out=deriveMdiPayoffPathResearch({...base,path:[a]});assert.equal(out.state,"UNAVAILABLE");});

test("neutral MDI has no payoff direction",()=>{const out=deriveMdiPayoffPathResearch({...base,mdiBias:"NEUTRAL",path:[p("2026-09-02T04:06:00.000Z",23920,112,94)]});assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("MDI_NOT_DIRECTIONAL"));});

test("research layer has zero live authority and no cost-adjusted claim",()=>{const out=deriveMdiPayoffPathResearch({...base,path:[]});assert.equal(out.affectsVerdict,false);assert.equal(out.affectsTelegram,false);assert.equal(out.affectsExecution,false);assert.equal(out.createsOrders,false);assert.equal(out.aiMayOverride,false);assert.equal(out.profitPolicy,"GROSS_PATH_METRICS_ONLY_NO_COST_ADJUSTED_EDGE_CLAIM");});
