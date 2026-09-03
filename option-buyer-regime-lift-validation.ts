import { classifyMarketRegime, type MarketRegimeInput, type MarketRegime } from "./market-regime-engine.js";
import { validateOptionBuyerMdiLift, type OptionBuyerLiftSample } from "./option-buyer-lift-validation.js";

export type RegimeLiftState = "USABLE" | "UNAVAILABLE";
export type SupportedRegime = Exclude<MarketRegime,"UNKNOWN">;
export interface OptionBuyerRegimeLiftSample extends OptionBuyerLiftSample { regimeInput: MarketRegimeInput; }
export interface RegimeLiftSummary { regime:SupportedRegime; baselineCount:number; mdiFilteredCount:number; mdiRetentionPct:number|null; baselineAvgEstimatedNetReturnPct:number|null; mdiFilteredAvgEstimatedNetReturnPct:number|null; avgNetReturnLiftPctPoints:number|null; baselinePositiveRatePct:number|null; mdiFilteredPositiveRatePct:number|null; positiveRateLiftPctPoints:number|null; }
export interface OptionBuyerRegimeLiftResult { state:RegimeLiftState; totalSamples:number; regimeQualifiedSamples:number; unknownRegimeSamples:number; regimes:RegimeLiftSummary[]; blockers:string[]; ruleVersion:"OPTION_BUYER_REGIME_LIFT_VALIDATION_V1"; semantics:"RESEARCH_DESCRIPTIVE_REGIME_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF"; regimePolicy:"MARKET_REGIME_ENGINE_V1_VALIDATED_EVIDENCE_ONLY"; liftPolicy:"OPTION_BUYER_MDI_LIFT_VALIDATION_V1_REUSED_WITHIN_EACH_REGIME"; aggregationPolicy:"COUNT_WEIGHTED_FROM_DTE_BUCKET_SUMMARIES"; inferencePolicy:"DESCRIPTIVE_ONLY_NO_STATISTICAL_SIGNIFICANCE_CLAIM"; affectsVerdict:false; affectsTelegram:false; affectsExecution:false; createsOrders:false; aiMayOverride:false; }

const weightedMean=(parts:Array<{value:number|null,count:number}>)=>{let total=0,sum=0;for(const p of parts){if(p.value==null||p.count<=0)continue;sum+=p.value*p.count;total+=p.count;}return total?sum/total:null;};

export function validateOptionBuyerRegimeLift(samples:OptionBuyerRegimeLiftSample[]):OptionBuyerRegimeLiftResult {
 const blockers:string[]=[];const seen=new Set<string>();const grouped=new Map<SupportedRegime,OptionBuyerLiftSample[]>();let unknownRegimeSamples=0;
 for(const s of samples){
  if(!s.sampleId?.trim()){blockers.push("MISSING_SAMPLE_ID");continue;}if(seen.has(s.sampleId)){blockers.push("DUPLICATE_SAMPLE_ID");continue;}seen.add(s.sampleId);
  const r=classifyMarketRegime(s.regimeInput);if(!r.ready||r.regime==="UNKNOWN"){unknownRegimeSamples++;continue;}
  const regime=r.regime as SupportedRegime;const base:OptionBuyerLiftSample={sampleId:s.sampleId,mdiInput:s.mdiInput,candidate:s.candidate,payoffContract:s.payoffContract,netPayoffInput:s.netPayoffInput};const arr=grouped.get(regime)??[];arr.push(base);grouped.set(regime,arr);
 }
 const regimes:RegimeLiftSummary[]=[];let regimeQualifiedSamples=0;
 for(const [regime,group] of grouped){
  const lift=validateOptionBuyerMdiLift(group);regimeQualifiedSamples+=lift.baselineQualifiedCount;
  const bAvg=weightedMean(lift.buckets.map(x=>({value:x.baselineAvgEstimatedNetReturnPct,count:x.baselineCount})));
  const mAvg=weightedMean(lift.buckets.map(x=>({value:x.mdiFilteredAvgEstimatedNetReturnPct,count:x.mdiFilteredCount})));
  const bRate=weightedMean(lift.buckets.map(x=>({value:x.baselinePositiveRatePct,count:x.baselineCount})));
  const mRate=weightedMean(lift.buckets.map(x=>({value:x.mdiFilteredPositiveRatePct,count:x.mdiFilteredCount})));
  regimes.push({regime,baselineCount:lift.baselineQualifiedCount,mdiFilteredCount:lift.mdiFilteredQualifiedCount,mdiRetentionPct:lift.baselineQualifiedCount?lift.mdiFilteredQualifiedCount/lift.baselineQualifiedCount*100:null,baselineAvgEstimatedNetReturnPct:bAvg,mdiFilteredAvgEstimatedNetReturnPct:mAvg,avgNetReturnLiftPctPoints:bAvg==null||mAvg==null?null:mAvg-bAvg,baselinePositiveRatePct:bRate,mdiFilteredPositiveRatePct:mRate,positiveRateLiftPctPoints:bRate==null||mRate==null?null:mRate-bRate});
 }
 regimes.sort((a,b)=>a.regime.localeCompare(b.regime));if(regimeQualifiedSamples===0)blockers.push("NO_REGIME_QUALIFIED_OPTION_BUYER_SAMPLES");
 return{state:blockers.length?"UNAVAILABLE":"USABLE",totalSamples:samples.length,regimeQualifiedSamples,unknownRegimeSamples,regimes,blockers:[...new Set(blockers)],ruleVersion:"OPTION_BUYER_REGIME_LIFT_VALIDATION_V1",semantics:"RESEARCH_DESCRIPTIVE_REGIME_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF",regimePolicy:"MARKET_REGIME_ENGINE_V1_VALIDATED_EVIDENCE_ONLY",liftPolicy:"OPTION_BUYER_MDI_LIFT_VALIDATION_V1_REUSED_WITHIN_EACH_REGIME",aggregationPolicy:"COUNT_WEIGHTED_FROM_DTE_BUCKET_SUMMARIES",inferencePolicy:"DESCRIPTIVE_ONLY_NO_STATISTICAL_SIGNIFICANCE_CLAIM",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
}
