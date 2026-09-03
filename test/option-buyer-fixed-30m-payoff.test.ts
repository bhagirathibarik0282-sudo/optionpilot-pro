import test from "node:test";
import assert from "node:assert/strict";
import { validateFixed30mOptionBuyerPayoff } from "../option-buyer-fixed-30m-payoff.js";

const candidate={symbol:"NIFTY" as const,side:"CE" as const,strike:23900,expiryDate:"2026-09-03",dte:1,moneyness:"ATM" as const,premiumLtp:100,capitalFit:true,liquidityOk:true,spreadOk:true,premiumResponseConfirmed:true,deltaGammaResponseConfirmed:true,thetaIvBurdenAcceptable:true,multiExpiryConflictAbsent:true,currentOrNearExpiryUsable:true,higherDteUsable:false,fallbackDteApproved:true};
const q=(ts:string,bid:number,ask:number,strike=23900)=>({ts,expiryDate:"2026-09-03",strike,side:"CE" as const,bid,ask,quality:"VERIFIED" as const});
const base=()=>({signalTs:"2026-09-03T04:03:00.000Z",candidate,entryQuote:q("2026-09-03T04:03:00.000Z",99,100),futureQuotes:[q("2026-09-03T04:33:00.000Z",114,114.5)],exchange:"NSE" as const,quantity:130,accountState:"NON_DEBIT" as const,evaluationDate:"2026-09-03"});

test("uses exact +30m verified same-contract executable quotes",()=>{const out=validateFixed30mOptionBuyerPayoff(base());assert.equal(out.state,"USABLE");assert.equal(out.targetTs,"2026-09-03T04:33:00.000Z");assert.equal(out.observedTs,out.targetTs);assert.ok((out.estimatedNetPnl??0)>0);assert.equal(out.horizonPolicy,"EXACT_PLUS_30_MINUTES_NO_NEAREST_SUBSTITUTION");assert.equal(out.dateBindingPolicy,"EVALUATION_DATE_MUST_MATCH_SIGNAL_IST_DATE");});

test("nearest timestamp substitution is forbidden",()=>{const x=base();x.futureQuotes=[q("2026-09-03T04:32:00.000Z",114,114.5)];const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("EXACT_30M_EXIT_QUOTE_UNAVAILABLE"));});

test("same-contract binding forbids ATM drift",()=>{const x=base();x.futureQuotes=[q("2026-09-03T04:33:00.000Z",114,114.5,23950)];const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("EXACT_30M_EXIT_QUOTE_UNAVAILABLE"));});

test("duplicate exact same-contract quotes fail closed",()=>{const x=base();x.futureQuotes=[q("2026-09-03T04:33:00.000Z",114,114.5),q("2026-09-03T04:33:00.000Z",115,115.5)];const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("DUPLICATE_EXACT_30M_EXIT_QUOTES"));});

test("entry quote must be exact signal-time and verified",()=>{const x=base();x.entryQuote={...x.entryQuote,ts:"2026-09-03T04:02:00.000Z"};const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("ENTRY_QUOTE_NOT_BOUND_TO_SIGNAL_TIMESTAMP"));});

test("selector blocked candidate fails closed",()=>{const x=base();x.candidate={...candidate,spreadOk:false};const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("OPTION_BUYER_CANDIDATE_NOT_SELECTOR_QUALIFIED"));});

test("evaluation date must match signal IST date to prevent historical rate leakage",()=>{const x=base();x.evaluationDate="2026-09-02";const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("EVALUATION_DATE_NOT_BOUND_TO_SIGNAL_IST_DATE"));});

test("historical same-date sample still reaches net-payoff rate gate",()=>{const x=base();x.signalTs="2026-09-02T04:03:00.000Z";x.entryQuote={...x.entryQuote,ts:"2026-09-02T04:03:00.000Z"};x.futureQuotes=[{...x.futureQuotes[0],ts:"2026-09-02T04:33:00.000Z"}];x.evaluationDate="2026-09-02";const out=validateFixed30mOptionBuyerPayoff(x);assert.equal(out.state,"UNAVAILABLE");assert.ok(out.blockers.includes("NET_PAYOFF_RATE_SCHEDULE_NOT_VERIFIED_FOR_EVALUATION_DATE"));});

test("research layer has zero live authority",()=>{const out=validateFixed30mOptionBuyerPayoff(base());assert.equal(out.affectsVerdict,false);assert.equal(out.affectsTelegram,false);assert.equal(out.affectsExecution,false);assert.equal(out.createsOrders,false);assert.equal(out.aiMayOverride,false);});
