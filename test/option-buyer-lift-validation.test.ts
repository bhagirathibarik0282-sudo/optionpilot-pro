import test from "node:test";
import assert from "node:assert/strict";
import { validateOptionBuyerMdiLift } from "../option-buyer-lift-validation.js";
import type { MdiInput, MdiSourceQualityMap } from "../mdi-research-shadow.js";

const verified:MdiSourceQualityMap={PCR:"VERIFIED",WALL:"VERIFIED",IV:"VERIFIED",VIX:"VERIFIED",FUTURES:"VERIFIED"};
function mdi(bull=true,date="2026-09-03"):MdiInput{return {previous:{ts:`${date}T04:00:00.000Z`,sourceQuality:verified,fullPcr:.8,band7Pcr:.8,callWallStrike:24000,putWallStrike:23800,callWallStrength:100,putWallStrength:100,ceIv:12,peIv:12,indiaVix:12,futureLtp:23900},current:{ts:`${date}T04:03:00.000Z`,sourceQuality:verified,fullPcr:bull?1:.6,band7Pcr:bull?1:.6,callWallStrike:bull?24050:23950,putWallStrike:bull?23850:23750,callWallStrength:bull?85:120,putWallStrength:bull?120:85,ceIv:bull?15:11,peIv:bull?11:15,indiaVix:bull?11.5:12.5,futureLtp:bull?24020:23820},strikeStep:50};}
const candidate=(side:"CE"|"PE",dte=1)=>({symbol:"NIFTY" as const,side,strike:23900,expiryDate:"2026-09-03",dte,moneyness:"ATM" as const,premiumLtp:100,capitalFit:true,liquidityOk:true,spreadOk:true,premiumResponseConfirmed:true,deltaGammaResponseConfirmed:true,thetaIvBurdenAcceptable:true,multiExpiryConflictAbsent:true,currentOrNearExpiryUsable:true,higherDteUsable:false,fallbackDteApproved:true});
const contract=(side:"CE"|"PE")=>({side,strike:23900,expiryDate:"2026-09-03"});
const payoff=(exitBid:number)=>({exchange:"NSE" as const,quantity:130,accountState:"NON_DEBIT" as const,evaluationDate:"2026-09-03",entry:{bid:99,ask:100,quality:"VERIFIED" as const},exit:{bid:exitBid,ask:exitBid+.5,quality:"VERIFIED" as const}});
const sample=(id:string,bull:boolean,side:"CE"|"PE",dte:number,exitBid:number)=>({sampleId:id,mdiInput:mdi(bull),candidate:candidate(side,dte),payoffContract:contract(side),netPayoffInput:payoff(exitBid)});

test("compares same selector-qualified baseline against MDI-matched subset by DTE",()=>{const out=validateOptionBuyerMdiLift([sample("a",true,"CE",1,115),sample("b",false,"CE",1,95),sample("c",true,"CE",3,110)]);assert.equal(out.state,"USABLE");assert.equal(out.baselineQualifiedCount,3);assert.equal(out.mdiFilteredQualifiedCount,2);const expiry=out.buckets.find(x=>x.dteBucket==="EXPIRY_0_1");assert.equal(expiry?.baselineCount,2);assert.equal(expiry?.mdiFilteredCount,1);assert.ok((expiry?.avgNetReturnLiftPctPoints??0)>0);assert.equal(out.semantics,"RESEARCH_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF");assert.equal(out.regimePolicy,"NOT_INCLUDED_UNTIL_DETERMINISTIC_REGIME_SOURCE_IS_BOUND");});

test("duplicate sample id fails closed",()=>{const s=sample("x",true,"CE",1,110);const out=validateOptionBuyerMdiLift([s,s]);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("DUPLICATE_SAMPLE_ID"));});

test("payoff contract must bind exactly to selected candidate",()=>{const s=sample("x",true,"CE",1,110);const out=validateOptionBuyerMdiLift([{...s,payoffContract:{...s.payoffContract,strike:24000}}]);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("PAYOFF_CONTRACT_NOT_BOUND_TO_CANDIDATE"));});

test("MDI date must bind to payoff evaluation date",()=>{const s=sample("x",true,"CE",1,110);const out=validateOptionBuyerMdiLift([{...s,mdiInput:mdi(true,"2026-09-02")}]);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("MDI_DATE_NOT_BOUND_TO_PAYOFF_EVALUATION_DATE"));});

test("invalid historical cost date cannot enter baseline",()=>{const s=sample("x",true,"CE",1,110);const out=validateOptionBuyerMdiLift([{...s,netPayoffInput:{...s.netPayoffInput,evaluationDate:"2026-09-02"}}]);assert.equal(out.state,"UNAVAILABLE");assert.equal(out.baselineQualifiedCount,0);});

test("no live authority",()=>{const out=validateOptionBuyerMdiLift([]);assert.equal(out.affectsVerdict,false);assert.equal(out.affectsTelegram,false);assert.equal(out.affectsExecution,false);assert.equal(out.createsOrders,false);assert.equal(out.aiMayOverride,false);});
