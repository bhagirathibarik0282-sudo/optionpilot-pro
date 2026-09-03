import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseObservedCandidateCoverage } from "../h1-observed-candidate-coverage-diagnostic.js";
import type { H1ReplayHttpResult, H1ReplayRequest } from "../h1-replay-http.js";

const request: H1ReplayRequest = { symbol:"NIFTY", tradeDate:"2026-09-02", fromTime:"09:15", toTime:"15:30", scope:"CORE" };
const row=(ts:string,is_candidate:unknown,ask:number|null,bid:number|null):Record<string,unknown>=>({
  minute_bucket:ts, expiry:"2026-09-03", strike:24000, option_type:"CE", dte:1,
  is_candidate, truth_verdict:"TRUE", ask, bid, validation_status:"RESEARCH_ELIGIBLE", liquidity_status:"OK"
});

test("diagnoses missing candidate flags",()=>{
  const replay:H1ReplayHttpResult={ok:true,mode:"READ_ONLY_H1_3M_REPLAY",productionImpact:"NONE",request,options:[row("2026-09-02T03:45:00.000Z",false,100,99)]};
  const out=diagnoseObservedCandidateCoverage(request,replay);
  assert.equal(out.candidateTrue,0);
  assert.ok(out.blockers.includes("NO_IS_CANDIDATE_TRUE_ROWS"));
});

test("counts exact plus30 positive bid path",()=>{
  const replay:H1ReplayHttpResult={ok:true,mode:"READ_ONLY_H1_3M_REPLAY",productionImpact:"NONE",request,options:[
    row("2026-09-02T03:45:00.000Z",true,100,99),
    row("2026-09-02T04:15:00.000Z",false,101,120),
  ]};
  const out=diagnoseObservedCandidateCoverage(request,replay);
  assert.equal(out.candidateTrue,1);
  assert.equal(out.truthTrueCandidateRows,1);
  assert.equal(out.positiveAskCandidateRows,1);
  assert.equal(out.exactPlus30ExitAvailableRows,1);
  assert.equal(out.exactPlus30PositiveBidRows,1);
  assert.deepEqual(out.blockers,[]);
  assert.equal(out.affectsExecution,false);
  assert.equal(out.affectsTelegram,false);
});
