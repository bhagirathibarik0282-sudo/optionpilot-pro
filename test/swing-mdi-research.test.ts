import test from "node:test";
import assert from "node:assert/strict";
import { deriveSwingMdiResearch } from "../swing-mdi-research.js";
import type { MdiInput, MdiSourceQualityMap } from "../mdi-research-shadow.js";

const verified: MdiSourceQualityMap = { PCR:"VERIFIED", WALL:"VERIFIED", IV:"VERIFIED", VIX:"VERIFIED", FUTURES:"VERIFIED" };
function input(date:string,prev:number,curr:number):MdiInput{return {previous:{ts:`${date}T03:45:00.000Z`,sourceQuality:verified,fullPcr:.8+prev*.001,band7Pcr:.85+prev*.001,callWallStrike:24000+prev,putWallStrike:23800+prev,callWallStrength:100,putWallStrength:100,ceIv:12+Math.max(prev,0)*.01,peIv:12+Math.max(-prev,0)*.01,indiaVix:12,futureLtp:23900+prev},current:{ts:`${date}T03:51:00.000Z`,sourceQuality:verified,fullPcr:.8+curr*.001,band7Pcr:.85+curr*.001,callWallStrike:24000+curr,putWallStrike:23800+curr,callWallStrength:curr>=prev?90:110,putWallStrength:curr>=prev?115:90,ceIv:12+Math.max(curr,0)*.01,peIv:12+Math.max(-curr,0)*.01,indiaVix:curr>=prev?11.5:12.5,futureLtp:23900+curr},strikeStep:50};}

test("multi-session bullish persistence uses same-session verified MDI only",()=>{const rows=[["2026-08-28",40],["2026-08-31",45],["2026-09-01",50],["2026-09-02",55],["2026-09-03",60]] as const;const out=deriveSwingMdiResearch(rows.map(([d,v])=>({tradeDate:d,mdiInput:input(d,0,v)})));const five=out.windows.find(w=>w.sessions===5)!;assert.equal(five.usableSessions,5);assert.equal(five.coveragePct,100);assert.equal(five.bias,"BULLISH_PERSISTENCE");});

test("look-ahead or cross-session timestamps are rejected",()=>{const bad=input("2026-09-04",0,50);const out=deriveSwingMdiResearch([{tradeDate:"2026-09-03",mdiInput:bad},{tradeDate:"2026-09-02",mdiInput:input("2026-09-02",0,45)}]);assert.equal(out.latestTradeDate,"2026-09-02");});

test("low verified coverage fails closed",()=>{const bad=input("2026-09-01",0,50);bad.current.sourceQuality={...verified,PCR:"PROXY",WALL:"STALE",IV:"DEGRADED"};const out=deriveSwingMdiResearch([{tradeDate:"2026-09-01",mdiInput:bad},{tradeDate:"2026-09-02",mdiInput:input("2026-09-02",0,45)},{tradeDate:"2026-09-03",mdiInput:input("2026-09-03",0,55)}]);const three=out.windows.find(w=>w.sessions===3)!;assert.equal(three.coveragePct,66.7);assert.equal(three.bias,"UNAVAILABLE");});

test("duplicate trade dates do not double-count",()=>{const out=deriveSwingMdiResearch([{tradeDate:"2026-09-01",mdiInput:input("2026-09-01",0,45)},{tradeDate:"2026-09-01",mdiInput:input("2026-09-01",0,-45)},{tradeDate:"2026-09-02",mdiInput:input("2026-09-02",0,50)},{tradeDate:"2026-09-03",mdiInput:input("2026-09-03",0,55)}]);assert.equal(out.windows.find(w=>w.sessions===3)!.availableSessions,3);});

test("invalid calendar date is rejected",()=>{const out=deriveSwingMdiResearch([{tradeDate:"2026-02-31",mdiInput:input("2026-02-28",0,40)}]);assert.equal(out.latestTradeDate,null);});

test("swing MDI remains research-only",()=>{const out=deriveSwingMdiResearch([]);assert.equal(out.affectsVerdict,false);assert.equal(out.affectsTelegram,false);assert.equal(out.affectsExecution,false);assert.equal(out.createsOrders,false);assert.equal(out.aiMayOverride,false);});
