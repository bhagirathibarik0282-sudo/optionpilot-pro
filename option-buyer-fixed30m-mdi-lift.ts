import { deriveMdiResearchShadow, type MdiInput } from "./mdi-research-shadow.js";
import { validateFixed30mOptionBuyerPayoff, type Fixed30mPayoffInput } from "./option-buyer-fixed-30m-payoff.js";

export interface Fixed30mMdiLiftSample { sampleId:string; mdiInput:MdiInput; payoffInput:Fixed30mPayoffInput; }
export interface Fixed30mMdiLiftResult {
 state:"USABLE"|"UNAVAILABLE"; totalSamples:number; baselineCount:number; mdiFilteredCount:number; mdiRetentionPct:number|null;
 baselineAvgNetReturnPct:number|null; mdiFilteredAvgNetReturnPct:number|null; avgNetReturnLiftPctPoints:number|null;
 baselinePositiveRatePct:number|null; mdiFilteredPositiveRatePct:number|null; positiveRateLiftPctPoints:number|null;
 baselineLossRatePct:number|null; mdiFilteredLossRatePct:number|null; badTradeReductionPctPoints:number|null;
 blockers:string[]; ruleVersion:"OPTION_BUYER_FIXED30M_MDI_LIFT_V1";
 semantics:"RESEARCH_DESCRIPTIVE_FIXED30M_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF";
 horizonPolicy:"ALL_INCLUDED_SAMPLES_EXACT_PLUS_30M"; inferencePolicy:"DESCRIPTIVE_ONLY_NO_STATISTICAL_SIGNIFICANCE_CLAIM";
 affectsVerdict:false; affectsTelegram:false; affectsExecution:false; createsOrders:false; aiMayOverride:false;
}
const avg=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const rate=(x:number[],pred:(v:number)=>boolean)=>x.length?x.filter(pred).length/x.length*100:null;
const direction=(bias:string)=>bias.includes("BULLISH")?"CE":bias.includes("BEARISH")?"PE":null;
export function validateFixed30mMdiLift(samples:Fixed30mMdiLiftSample[]):Fixed30mMdiLiftResult{
 const blockers:string[]=[]; const ids=new Set<string>(); const logical=new Set<string>(); const baseline:number[]=[]; const mdiFiltered:number[]=[];
 for(const s of samples){
  if(!s.sampleId?.trim()){blockers.push("MISSING_SAMPLE_ID");continue;} if(ids.has(s.sampleId)){blockers.push("DUPLICATE_SAMPLE_ID");continue;} ids.add(s.sampleId);
  const payoff=validateFixed30mOptionBuyerPayoff(s.payoffInput); if(payoff.state!=="USABLE"||payoff.estimatedNetReturnPctOnPremium==null) continue;
  const key=`${s.payoffInput.signalTs}|${payoff.candidateKey??"NONE"}|30`; if(logical.has(key)){blockers.push("DUPLICATE_LOGICAL_SIGNAL_CONTRACT_HORIZON");continue;} logical.add(key);
  baseline.push(payoff.estimatedNetReturnPctOnPremium);
  const mdi=deriveMdiResearchShadow(s.mdiInput); const side=direction(mdi.bias);
  if(mdi.mdi!=null&&mdi.coveragePct===100&&side===s.payoffInput.candidate.side&&s.mdiInput.current.ts===s.payoffInput.signalTs) mdiFiltered.push(payoff.estimatedNetReturnPctOnPremium);
 }
 if(!baseline.length) blockers.push("NO_USABLE_EXACT_30M_BASELINE_SAMPLES");
 if(!mdiFiltered.length) blockers.push("NO_MDI_FILTERED_EXACT30M_SAMPLES");
 const bAvg=avg(baseline),mAvg=avg(mdiFiltered),bPos=rate(baseline,v=>v>0),mPos=rate(mdiFiltered,v=>v>0),bLoss=rate(baseline,v=>v<0),mLoss=rate(mdiFiltered,v=>v<0);
 return {state:blockers.length?"UNAVAILABLE":"USABLE",totalSamples:samples.length,baselineCount:baseline.length,mdiFilteredCount:mdiFiltered.length,mdiRetentionPct:baseline.length?mdiFiltered.length/baseline.length*100:null,baselineAvgNetReturnPct:bAvg,mdiFilteredAvgNetReturnPct:mAvg,avgNetReturnLiftPctPoints:bAvg==null||mAvg==null?null:mAvg-bAvg,baselinePositiveRatePct:bPos,mdiFilteredPositiveRatePct:mPos,positiveRateLiftPctPoints:bPos==null||mPos==null?null:mPos-bPos,baselineLossRatePct:bLoss,mdiFilteredLossRatePct:mLoss,badTradeReductionPctPoints:bLoss==null||mLoss==null?null:bLoss-mLoss,blockers:[...new Set(blockers)],ruleVersion:"OPTION_BUYER_FIXED30M_MDI_LIFT_V1",semantics:"RESEARCH_DESCRIPTIVE_FIXED30M_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF",horizonPolicy:"ALL_INCLUDED_SAMPLES_EXACT_PLUS_30M",inferencePolicy:"DESCRIPTIVE_ONLY_NO_STATISTICAL_SIGNIFICANCE_CLAIM",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
}
