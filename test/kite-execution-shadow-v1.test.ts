import test from "node:test";
import assert from "node:assert/strict";
import { evaluateKiteExecutionShadow } from "../kite-execution-shadow-v1.js";

const consumer:any={version:"CANONICAL_BUSINESS_CONSUMER_V1",buyerCandidate:{candidateKey:"NIFTY:CE:24000:X",role:"OPTION_BUYER",symbol:"NIFTY",optionSide:"CE",strike:24000,expiryDate:"2026-09-08",dte:1,moneyness:"ATM",premiumLtp:100,dteBucket:"CURRENT_OR_NEAR",sourceAuthority:"EXECUTION_CANDIDATE_SELECTOR_V2"},horizons:[],telegram:{allowed:true,reason:"BUYER_READY"},candidateKey:"NIFTY:CE:24000:X",sameCanonicalCandidateForDashboardAndTelegram:true,affectsExecution:false,createsOrders:false,aiMayOverride:false};

test("shadow blocks opposite index while NIFTY/SENSEX exclusivity is active",()=>{const x=evaluateKiteExecutionShadow({consumer,currentState:"WATCH",event:"ENTRY_CONDITIONS_READY",dataFresh:true,contractValid:true,activeSymbol:"SENSEX",lots:2,entryConditionConfirmed:true});assert.equal(x.decision,"BLOCK");assert.ok(x.blockers.includes("NIFTY_SENSEX_EXCLUSIVITY_BLOCK"));assert.equal(x.createsOrders,false);assert.equal(x.sendsBrokerRequest,false);});

test("shadow uses exact canonical candidate and advances lifecycle without broker request",()=>{const x=evaluateKiteExecutionShadow({consumer,currentState:"WATCH",event:"ENTRY_CONDITIONS_READY",dataFresh:true,contractValid:true,activeSymbol:null,lots:2,entryConditionConfirmed:true});assert.equal(x.ready,true);assert.equal(x.candidateKey,consumer.candidateKey);assert.equal(x.lifecycle?.nextState,"ENTRY_READY");assert.equal(x.lots,2);assert.equal(x.mode,"SHADOW_ONLY");assert.equal(x.sendsBrokerRequest,false);assert.equal(x.createsOrders,false);});

test("shadow fails closed for stale data or wrong lot policy",()=>{const x=evaluateKiteExecutionShadow({consumer,currentState:"WATCH",event:"ENTRY_CONDITIONS_READY",dataFresh:false,contractValid:true,activeSymbol:null,lots:1,entryConditionConfirmed:true});assert.equal(x.ready,false);assert.ok(x.blockers.includes("LIVE_DATA_NOT_FRESH"));assert.ok(x.blockers.includes("SCALP_TWO_LOTS_REQUIRED"));});
