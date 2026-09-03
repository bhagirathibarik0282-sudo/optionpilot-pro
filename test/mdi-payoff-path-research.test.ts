import test from "node:test";
import assert from "node:assert/strict";
import { deriveMdiPayoffPathResearch } from "../mdi-payoff-path-research.js";
import type { MdiInput, MdiSourceQualityMap } from "../mdi-research-shadow.js";

const q="VERIFIED" as const;
const verified:MdiSourceQualityMap={PCR:"VERIFIED",WALL:"VERIFIED",IV:"VERIFIED",VIX:"VERIFIED",FUTURES:"VERIFIED"};
const ce={expiry:"2026-09-03",strike:23900,optionType:"CE" as const,ltp:100,quality:q};
const pe={expiry:"2026-09-03",strike:23900,optionType:"PE" as const,ltp:100,quality:q};
const p=(ts:string,spot:number,ceLtp:number,peLtp:number)=>({ts,spotLtp:spot,spotQuality:q,premiums:[{...ce,ltp:ceLtp},{...pe,ltp:peLtp}]});
const close=(actual:number|null,expected:number,eps=1e-9)=>{assert.ok(actual!==null&&Math.abs(actual-expected)<=eps,`expected ${actual} to be within ${eps} of ${expected}`);};
function mdiInput():MdiInput{return {previous:{ts:"2026-09-02T04:00:00.000Z",sourceQuality:verified,fullPcr:.8,band7Pcr:.8,callWallStrike:24000,putWallStrike:23800,callWallStrength:100,putWallStrength:100,ceIv:12,peIv:12,indiaVix:12,futureLtp:23900},current:{ts:"2026-09-02T04:03:00.000Z",sourceQuality:verified,fullPcr:1,band7Pcr:1,callWallStrike:24050,putWallStrike:23850,callWallStrength:85,putWallStrength:120,ceIv:15,peIv:11,indiaVix:11.5,futureLtp:24020},strikeStep:50};}
const base={mdiInput:mdiInput(),signalTs:"2026-09-02T04:03:00.000Z",signalSpot:23900,signalSpotQuality:q,signalCe:ce,signalPe:pe};

test("bullish path computes observed verified extrema and end payoff",()=>{const out=deriveMdiPayoffPathResearch({...base,path:[p("2026-09-02T04:06:00.000Z",23920,112,94),p("2026-09-02T04:09:00.000Z",23890,96,106),p("2026-09-02T04:18:00.000Z",23960,128,86)]});assert.equal(out.state,"USABLE");assert.equal(out.mdiCoveragePct,100);assert.equal(out.sampleCount,3);assert.ok((out.observedSpotMfePct??0)>0);assert.ok((out.observedSpotMaePct??0)<0);close(out.observedChosenPremiumMfePct,28);close(out.observedChosenPremiumMaePct,-4);close(out.chosenPremiumEndPct,28);close(out.oppositePremiumEndPct,-14);assert.equal(out.pathObservationPolicy,"OBSERVED_VERIFIED_POINTS_ONLY_NOT_TRUE_CONTINUOUS_EXTREMA");});

test("caller cannot inject MDI bias; partial verified MDI fails closed",()=>{const m=mdiInput();m.current.sourceQuality={...verified,IV:"DEGRADED"};const out=deriveMdiPayoffPathResearch({...base,mdiInput:m,path:[p("2026-09-02T04:06:00.000Z",23920,112,94)]});assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("MDI_NOT_FULLY_VERIFIED"));});

test("signal timestamp must bind to MDI current",()=>{const out=deriveMdiPayoffPathResearch({...base,signalTs:"2026-09-02T04:04:00.000Z",path:[]});assert.ok(out.blockers.includes("SIGNAL_TIMESTAMP_NOT_BOUND_TO_MDI_CURRENT"));});

test("cross-session path fails closed",()=>{const out=deriveMdiPayoffPathResearch({...base,path:[p("2026-09-03T04:06:00.000Z",23920,112,94)]});assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("CROSS_SESSION_PATH_POINT"));});

test("duplicate timestamp fails closed",()=>{const a=p("2026-09-02T04:06:00.000Z",23920,112,94);const out=deriveMdiPayoffPathResearch({...base,path:[a,{...a}]});assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("DUPLICATE_PATH_TIMESTAMP"));});

test("unverified contract path fails closed",()=>{const a=p("2026-09-02T04:06:00.000Z",23920,112,94);a.premiums[0].quality="STALE" as any;const out=deriveMdiPayoffPathResearch({...base,path:[a]});assert.equal(out.state,"UNAVAILABLE");});

test("research layer has zero live authority and no cost-adjusted claim",()=>{const out=deriveMdiPayoffPathResearch({...base,path:[]});assert.equal(out.affectsVerdict,false);assert.equal(out.affectsTelegram,false);assert.equal(out.affectsExecution,false);assert.equal(out.createsOrders,false);assert.equal(out.aiMayOverride,false);assert.equal(out.profitPolicy,"GROSS_PATH_METRICS_ONLY_NO_COST_ADJUSTED_EDGE_CLAIM");});
