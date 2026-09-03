import { deriveMdiResearchShadow, type MdiInput } from "./mdi-research-shadow.js";
import { selectExecutionCandidate, type ExecutionCandidateInput } from "./execution-candidate-selector.js";
import { deriveOptionBuyerNetPayoffResearch, type OptionBuyerNetPayoffInput } from "./option-buyer-net-payoff-research.js";

export type LiftState = "USABLE" | "UNAVAILABLE";
export type LiftDteBucket = "EXPIRY_0_1" | "NEAR_2_4" | "FALLBACK_5_7" | "BANKNIFTY_HIGHER_10_35";
export interface LiftContractIdentity { side:"CE"|"PE"; strike:number; expiryDate:string; }
export interface OptionBuyerLiftSample { sampleId:string; mdiInput:MdiInput; candidate:ExecutionCandidateInput; payoffContract:LiftContractIdentity; netPayoffInput:OptionBuyerNetPayoffInput; }
export interface LiftBucketSummary { dteBucket:LiftDteBucket; baselineCount:number; mdiFilteredCount:number; mdiRetentionPct:number|null; baselineAvgEstimatedNetReturnPct:number|null; mdiFilteredAvgEstimatedNetReturnPct:number|null; avgNetReturnLiftPctPoints:number|null; baselinePositiveRatePct:number|null; mdiFilteredPositiveRatePct:number|null; positiveRateLiftPctPoints:number|null; }
export interface OptionBuyerLiftValidationResult { state:LiftState; totalSamples:number; baselineQualifiedCount:number; mdiFilteredQualifiedCount:number; overallMdiRetentionPct:number|null; buckets:LiftBucketSummary[]; blockers:string[]; ruleVersion:"OPTION_BUYER_MDI_LIFT_VALIDATION_V1"; semantics:"RESEARCH_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF"; baselinePolicy:"SAME_SELECTOR_QUALIFIED_OPTION_BUYER_SAMPLES_WITHOUT_MDI_FILTER"; mdiPolicy:"SAME_SAMPLES_SUBSET_WITH_FULLY_VERIFIED_DIRECTIONAL_MDI_MATCHING_CANDIDATE_SIDE"; payoffPolicy:"CURRENT_RATE_DATE_EXECUTABLE_QUOTE_ESTIMATE_BOUND_TO_CANDIDATE_CONTRACT"; regimePolicy:"NOT_INCLUDED_UNTIL_DETERMINISTIC_REGIME_SOURCE_IS_BOUND"; inferencePolicy:"DESCRIPTIVE_ONLY_NO_MIN_SAMPLE_OR_STATISTICAL_SIGNIFICANCE_CLAIM"; affectsVerdict:false; affectsTelegram:false; affectsExecution:false; createsOrders:false; aiMayOverride:false; }

const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const rate=(xs:number[])=>xs.length?(xs.filter(x=>x>0).length/xs.length)*100:null;
const retention=(selected:number,baseline:number)=>baseline>0?(selected/baseline)*100:null;
const date=(s:string)=>{const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null;};
function sideMatchesMdi(bias:string,side:string){if(bias==="MILD_BULLISH"||bias==="STRONG_BULLISH")return side==="CE";if(bias==="MILD_BEARISH"||bias==="STRONG_BEARISH")return side==="PE";return false;}

export function validateOptionBuyerMdiLift(samples:OptionBuyerLiftSample[]):OptionBuyerLiftValidationResult{
 const blockers:string[]=[];const seen=new Set<string>();const byBucket=new Map<LiftDteBucket,{baseline:number[];mdi:number[]}>();let baselineQualifiedCount=0,mdiFilteredQualifiedCount=0;
 for(const s of samples){
  if(!s.sampleId?.trim()){blockers.push("MISSING_SAMPLE_ID");continue;}if(seen.has(s.sampleId)){blockers.push("DUPLICATE_SAMPLE_ID");continue;}seen.add(s.sampleId);
  const candidate=selectExecutionCandidate(s.candidate);if(candidate.decision!=="SELECT"||candidate.dteBucket==="UNSUPPORTED")continue;
  if(s.payoffContract.side!==s.candidate.side||s.payoffContract.strike!==s.candidate.strike||s.payoffContract.expiryDate!==s.candidate.expiryDate){blockers.push("PAYOFF_CONTRACT_NOT_BOUND_TO_CANDIDATE");continue;}
  const mdiDate=date(s.mdiInput.current.ts);if(mdiDate==null||mdiDate!==s.netPayoffInput.evaluationDate){blockers.push("MDI_DATE_NOT_BOUND_TO_PAYOFF_EVALUATION_DATE");continue;}
  const payoff=deriveOptionBuyerNetPayoffResearch(s.netPayoffInput);if(payoff.state!=="USABLE"||!finite(payoff.estimatedNetReturnPctOnPremium))continue;
  const bucket=candidate.dteBucket as LiftDteBucket;if(!byBucket.has(bucket))byBucket.set(bucket,{baseline:[],mdi:[]});const g=byBucket.get(bucket)!;g.baseline.push(payoff.estimatedNetReturnPctOnPremium);baselineQualifiedCount++;
  const mdi=deriveMdiResearchShadow(s.mdiInput);if(mdi.coveragePct===100&&mdi.mdi!=null&&sideMatchesMdi(mdi.bias,s.candidate.side)){g.mdi.push(payoff.estimatedNetReturnPctOnPremium);mdiFilteredQualifiedCount++;}
 }
 const buckets=[...byBucket.entries()].map(([dteBucket,g])=>{const bAvg=mean(g.baseline),mAvg=mean(g.mdi),bRate=rate(g.baseline),mRate=rate(g.mdi);return{dteBucket,baselineCount:g.baseline.length,mdiFilteredCount:g.mdi.length,mdiRetentionPct:retention(g.mdi.length,g.baseline.length),baselineAvgEstimatedNetReturnPct:bAvg,mdiFilteredAvgEstimatedNetReturnPct:mAvg,avgNetReturnLiftPctPoints:bAvg==null||mAvg==null?null:mAvg-bAvg,baselinePositiveRatePct:bRate,mdiFilteredPositiveRatePct:mRate,positiveRateLiftPctPoints:bRate==null||mRate==null?null:mRate-bRate};}).sort((a,b)=>a.dteBucket.localeCompare(b.dteBucket));
 if(baselineQualifiedCount===0)blockers.push("NO_BASELINE_QUALIFIED_SAMPLES");if(mdiFilteredQualifiedCount===0)blockers.push("NO_MDI_FILTERED_QUALIFIED_SAMPLES");
 return{state:blockers.length?"UNAVAILABLE":"USABLE",totalSamples:samples.length,baselineQualifiedCount,mdiFilteredQualifiedCount,overallMdiRetentionPct:retention(mdiFilteredQualifiedCount,baselineQualifiedCount),buckets,blockers:[...new Set(blockers)],ruleVersion:"OPTION_BUYER_MDI_LIFT_VALIDATION_V1",semantics:"RESEARCH_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF",baselinePolicy:"SAME_SELECTOR_QUALIFIED_OPTION_BUYER_SAMPLES_WITHOUT_MDI_FILTER",mdiPolicy:"SAME_SAMPLES_SUBSET_WITH_FULLY_VERIFIED_DIRECTIONAL_MDI_MATCHING_CANDIDATE_SIDE",payoffPolicy:"CURRENT_RATE_DATE_EXECUTABLE_QUOTE_ESTIMATE_BOUND_TO_CANDIDATE_CONTRACT",regimePolicy:"NOT_INCLUDED_UNTIL_DETERMINISTIC_REGIME_SOURCE_IS_BOUND",inferencePolicy:"DESCRIPTIVE_ONLY_NO_MIN_SAMPLE_OR_STATISTICAL_SIGNIFICANCE_CLAIM",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
}
