import test from "node:test";import assert from "node:assert/strict";
import { advanceTradeLifecycle } from "../trade-lifecycle-engine.js";
import { reconcileBrokerOrder } from "../broker-order-reconciliation.js";
import { authorizeBrokerExecution } from "../broker-execution-authorization.js";

function step(state:any,event:any,flags:any={}){return advanceTradeLifecycle({currentState:state,event,dataFresh:true,contractValid:true,sameCandidate:true,sameStyle:true,exitConditionConfirmed:false,partialBookConditionConfirmed:false,trailConditionConfirmed:false,protectConditionConfirmed:false,entryConditionConfirmed:false,entryActivatedConfirmed:false,thesisHoldingConfirmed:false,...flags});}

test("shadow lifecycle proves full deterministic profit-management path without execution",()=>{
 let x=step("WATCH","ENTRY_CONDITIONS_READY",{entryConditionConfirmed:true});assert.equal(x.nextState,"ENTRY_READY");
 x=step(x.nextState,"ENTRY_ACTIVATED",{entryActivatedConfirmed:true});assert.equal(x.nextState,"ACTIVE");
 x=step(x.nextState,"THESIS_HOLDING",{thesisHoldingConfirmed:true});assert.equal(x.nextState,"HOLD");
 x=step(x.nextState,"PROFIT_PROTECTION_REQUIRED",{protectConditionConfirmed:true});assert.equal(x.nextState,"PROTECT");
 x=step(x.nextState,"PARTIAL_BOOK_TRIGGERED",{partialBookConditionConfirmed:true});assert.equal(x.nextState,"PARTIAL_BOOK");
 x=step(x.nextState,"TRAIL_TRIGGERED",{trailConditionConfirmed:true});assert.equal(x.nextState,"TRAIL");
 x=step(x.nextState,"EXIT_TRIGGERED",{exitConditionConfirmed:true});assert.equal(x.nextState,"EXIT");assert.equal(x.affectsExecution,false);
});

test("broker rejection with zero fill is reconciled without residual order",()=>{
 const r=reconcileBrokerOrder({brokerConnected:true,expectedQty:150,filledQty:0,pendingQty:0,brokerStatus:"REJECTED",hasDuplicateResidualIntent:false,orderStateFresh:true});
 assert.equal(r.decision,"OK");assert.equal(r.allowResidualIntent,false);assert.equal(r.protectFilledQty,0);assert.deepEqual(r.reasonCodes,["TERMINAL_STATUS_NO_FILL"]);
});

test("partial fill plus rejection requires reconciliation and protects only filled quantity",()=>{
 const r=reconcileBrokerOrder({brokerConnected:true,expectedQty:150,filledQty:50,pendingQty:0,brokerStatus:"REJECTED",hasDuplicateResidualIntent:false,orderStateFresh:true});
 assert.equal(r.decision,"RECONCILE");assert.equal(r.protectFilledQty,50);assert.equal(r.allowNewEntry,false);assert.equal(r.allowResidualIntent,true);assert.equal(r.residualQty,100);assert.deepEqual(r.reasonCodes,["PARTIAL_FILL_RECONCILIATION_REQUIRED"]);
});

test("live authorization remains impossible even when every readiness input passes",()=>{
 const a=authorizeBrokerExecution({mode:"LIVE",orderBuildDecision:"BUILD",executionRiskDecision:"ALLOW",killSwitchDecision:"ALLOW",idempotencyDecision:"ALLOW",exactContractBound:true,evidencePersistenceConfirmed:true,brokerSessionReady:true});
 assert.equal(a.decision,"BLOCK");assert.ok(a.reasonCodes.includes("LIVE_EXECUTION_NOT_ENABLED_IN_V1"));assert.equal(a.placesOrder,false);assert.equal(a.shadowOnly,true);
});
