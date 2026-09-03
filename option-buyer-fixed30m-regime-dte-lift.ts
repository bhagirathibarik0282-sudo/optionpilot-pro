import { classifyMarketRegime, type MarketRegime, type MarketRegimeInput } from "./market-regime-engine.js";
import { validateFixed30mMdiLift, type Fixed30mMdiLiftSample } from "./option-buyer-fixed30m-mdi-lift.js";

export type Fixed30mDteBucket = "EXPIRY_0_1"|"NEAR_2_4"|"FALLBACK_5_7"|"BANKNIFTY_HIGHER_10_35";
export type SupportedRegime = Exclude<MarketRegime,"UNKNOWN">;
export interface Fixed30mRegimeDteSample extends Fixed30mMdiLiftSample { regimeInput:MarketRegimeInput; regimeObservedAt:string; }
export interface Fixed30mRegimeDteCell {
 regime:SupportedRegime; dteBucket:Fixed30mDteBucket; baselineCount:number; mdiFilteredCount:number; mdiRetentionPct:number|null;
 baselineAvgNetReturnPct:number|null; mdiFilteredAvgNetReturnPct:number|null; avgNetReturnLiftPctPoints:number|null;
 baselinePositiveRatePct:number|null; mdiFilteredPositiveRatePct:number|null; positiveRateLiftPctPoints:number|null;
 baselineLossRatePct:number|null; mdiFilteredLossRatePct:number|null; badTradeReductionPctPoints:number|null;
}
export interface Fixed30mRegimeDteResult {
 state:"USABLE"|"UNAVAILABLE"; totalSamples:number; qualifiedSamples:number; excludedUnknownRegime:number; excludedUnsupportedDte:number;
 cells:Fixed30mRegimeDteCell[]; blockers:string[]; ruleVersion:"OPTION_BUYER_FIXED30M_REGIME_DTE_LIFT_V1";
 semantics:"RESEARCH_DESCRIPTIVE_EXACT30M_REGIME_DTE_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF";
 regimePolicy:"MARKET_REGIME_ENGINE_V1_EXACT_SIGNAL_TIMESTAMP_BOUND"; dtePolicy:"FIXED_DTE_BUCKETS_0_1_2_4_5_7_AND_BANKNIFTY_ONLY_10_35";
 horizonPolicy:"ALL_INCLUDED_SAMPLES_EXACT_PLUS_30M"; inferencePolicy:"DESCRIPTIVE_ONLY_NO_STATISTICAL_SIGNIFICANCE_CLAIM";
 affectsVerdict:false; affectsTelegram:false; affectsExecution:false; createsOrders:false; aiMayOverride:false;
}
const bucket=(symbol:string,dte:number):Fixed30mDteBucket|null=>dte>=0&&dte<=1?"EXPIRY_0_1":dte>=2&&dte<=4?"NEAR_2_4":dte>=5&&dte<=7?"FALLBACK_5_7":symbol==="BANKNIFTY"&&dte>=10&&dte<=35?"BANKNIFTY_HIGHER_10_35":null;
const regimes:SupportedRegime[]=["TRENDING_UP","TRENDING_DOWN","RANGE","HIGH_VOLATILITY","TRANSITION"];
export function validateFixed30mRegimeDteLift(samples:Fixed30mRegimeDteSample[]):Fixed30mRegimeDteResult{
 const blockers:string[]=[]; const ids=new Set<string>(); const logical=new Set<string>(); const groups=new Map<string,Fixed30mMdiLiftSample[]>();
 let excludedUnknownRegime=0,excludedUnsupportedDte=0,qualifiedSamples=0;
 for(const s of samples){
  if(!s.sampleId?.trim()){blockers.push("MISSING_SAMPLE_ID");continue;} if(ids.has(s.sampleId)){blockers.push("DUPLICATE_SAMPLE_ID");continue;} ids.add(s.sampleId);
  const c=s.payoffInput.candidate; const lk=`${s.payoffInput.signalTs}|${c.symbol}|${c.side}|${c.strike}|${c.expiryDate}|30`;
  if(logical.has(lk)){blockers.push("DUPLICATE_LOGICAL_SIGNAL_CONTRACT_HORIZON");continue;} logical.add(lk);
  if(s.regimeObservedAt!==s.payoffInput.signalTs){blockers.push("REGIME_TIMESTAMP_NOT_BOUND_TO_SIGNAL_TIMESTAMP");continue;}
  const r=classifyMarketRegime(s.regimeInput); if(!r.ready||r.regime==="UNKNOWN"){excludedUnknownRegime++;continue;}
  const d=bucket(c.symbol,c.dte); if(!d){excludedUnsupportedDte++;continue;}
  const key=`${r.regime}|${d}`; const arr=groups.get(key)??[]; arr.push({sampleId:s.sampleId,mdiInput:s.mdiInput,payoffInput:s.payoffInput}); groups.set(key,arr); qualifiedSamples++;
 }
 const cells:Fixed30mRegimeDteCell[]=[];
 for(const regime of regimes) for(const dteBucket of ["EXPIRY_0_1","NEAR_2_4","FALLBACK_5_7","BANKNIFTY_HIGHER_10_35"] as Fixed30mDteBucket[]){
  const arr=groups.get(`${regime}|${dteBucket}`); if(!arr?.length) continue; const x=validateFixed30mMdiLift(arr); if(x.state!=="USABLE") continue;
  cells.push({regime,dteBucket,baselineCount:x.baselineCount,mdiFilteredCount:x.mdiFilteredCount,mdiRetentionPct:x.mdiRetentionPct,baselineAvgNetReturnPct:x.baselineAvgNetReturnPct,mdiFilteredAvgNetReturnPct:x.mdiFilteredAvgNetReturnPct,avgNetReturnLiftPctPoints:x.avgNetReturnLiftPctPoints,baselinePositiveRatePct:x.baselinePositiveRatePct,mdiFilteredPositiveRatePct:x.mdiFilteredPositiveRatePct,positiveRateLiftPctPoints:x.positiveRateLiftPctPoints,baselineLossRatePct:x.baselineLossRatePct,mdiFilteredLossRatePct:x.mdiFilteredLossRatePct,badTradeReductionPctPoints:x.badTradeReductionPctPoints});
 }
 if(!qualifiedSamples) blockers.push("NO_REGIME_DTE_QUALIFIED_EXACT30M_SAMPLES");
 if(!cells.length) blockers.push("NO_USABLE_REGIME_DTE_LIFT_CELLS");
 return{state:blockers.length?"UNAVAILABLE":"USABLE",totalSamples:samples.length,qualifiedSamples,excludedUnknownRegime,excludedUnsupportedDte,cells,blockers:[...new Set(blockers)],ruleVersion:"OPTION_BUYER_FIXED30M_REGIME_DTE_LIFT_V1",semantics:"RESEARCH_DESCRIPTIVE_EXACT30M_REGIME_DTE_FILTER_LIFT_ONLY_NOT_CAUSAL_EDGE_PROOF",regimePolicy:"MARKET_REGIME_ENGINE_V1_EXACT_SIGNAL_TIMESTAMP_BOUND",dtePolicy:"FIXED_DTE_BUCKETS_0_1_2_4_5_7_AND_BANKNIFTY_ONLY_10_35",horizonPolicy:"ALL_INCLUDED_SAMPLES_EXACT_PLUS_30M",inferencePolicy:"DESCRIPTIVE_ONLY_NO_STATISTICAL_SIGNIFICANCE_CLAIM",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
}
