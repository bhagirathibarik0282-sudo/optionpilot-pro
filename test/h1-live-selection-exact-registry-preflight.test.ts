import test from "node:test";
import assert from "node:assert/strict";
import { preflightH1LiveSelectionIntoExactRegistry } from "../h1-live-selection-exact-registry-preflight.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { H1LiveContractSelectionResult } from "../h1-live-contract-selection.js";

function selection(peerCount=2):H1LiveContractSelectionResult {
  const peers=[
    {expiry:"2026-09-15",strike:25000,ceInstrumentToken:5,peInstrumentToken:6,ceTradingsymbol:"NIFTY15CE",peTradingsymbol:"NIFTY15PE"},
    {expiry:"2026-09-22",strike:25050,ceInstrumentToken:7,peInstrumentToken:8,ceTradingsymbol:"NIFTY22CE",peTradingsymbol:"NIFTY22PE"},
  ].slice(0,peerCount);
  return {
    version:"H1_LIVE_CONTRACT_SELECTION_V1",ready:true,blockers:[],source:"KITE_MASTER_PLUS_REST_SPOT_SELECTION_ONLY",productionImpact:"NONE",
    affectsDirection:false,affectsVerdict:false,affectsExecution:false,affectsTelegram:false,activatesShadow:false,infersTokens:false,failClosed:true,
    rows:[{symbol:"NIFTY",spot:25031,expiry:"2026-09-08",strike:25050,ceInstrumentToken:3,peInstrumentToken:4,ceTradingsymbol:"NIFTY08CE",peTradingsymbol:"NIFTY08PE",peerPairs:peers}],
  };
}

function base(){
  return new KiteImmediateTokenRegistry([
    {instrumentToken:99,symbol:"NIFTY",role:"SPOT",instrumentLabel:"NIFTY 50",optionSide:null},
    {instrumentToken:3,symbol:"NIFTY",role:"OPTION",instrumentLabel:"NIFTY08CE",expiry:"2026-09-08",strike:25050,optionSide:"CE"},
  ]);
}

test("adds only exact primary and two peer option tokens while preserving base registry",()=>{
  const r=preflightH1LiveSelectionIntoExactRegistry(base(),selection());
  assert.equal(r.ready,true);
  assert.equal(r.addedOptionTokens,5);
  assert.equal(r.selectedPairCount,3);
  assert.equal(r.infersTokens,false);
  assert.equal(r.affectsVerdict,false);
  assert.equal(r.affectsExecution,false);
  assert.equal(r.affectsTelegram,false);
  assert.deepEqual(r.registry!.tokens().sort((a,b)=>a-b),[3,4,5,6,7,8,99]);
});

test("fails closed unless exactly two peer pairs are present",()=>{
  const r=preflightH1LiveSelectionIntoExactRegistry(base(),selection(1));
  assert.equal(r.ready,false);
  assert.match(r.blockers[0],/EXACTLY_TWO_PEER_PAIRS_REQUIRED:NIFTY:1/);
  assert.equal(r.registry,null);
});

test("fails closed when an existing token has a conflicting identity",()=>{
  const conflicting=new KiteImmediateTokenRegistry([
    {instrumentToken:99,symbol:"NIFTY",role:"SPOT",instrumentLabel:"NIFTY 50",optionSide:null},
    {instrumentToken:5,symbol:"NIFTY",role:"OPTION",instrumentLabel:"WRONG",expiry:"2026-09-15",strike:25100,optionSide:"CE"},
  ]);
  const r=preflightH1LiveSelectionIntoExactRegistry(conflicting,selection());
  assert.equal(r.ready,false);
  assert.deepEqual(r.blockers,["TOKEN_IDENTITY_CONFLICT:5"]);
});

test("propagates not-ready selection blockers without building a registry",()=>{
  const s=selection(); s.ready=false; s.rows=[]; s.blockers=["UPSTREAM_BLOCKED"];
  const r=preflightH1LiveSelectionIntoExactRegistry(base(),s);
  assert.equal(r.ready,false);
  assert.deepEqual(r.blockers,["LIVE_SELECTION_NOT_READY","UPSTREAM_BLOCKED"]);
  assert.equal(r.registry,null);
});
