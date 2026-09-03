import type { MdiBias } from "./mdi-research-shadow.js";
import type { OutcomePriceQuality, PremiumContractPoint } from "./mdi-outcome-replay-validator.js";

export type PayoffDirection = "BULLISH" | "BEARISH";
export type PayoffState = "USABLE" | "UNAVAILABLE";

export interface PayoffPathPoint {
  ts: string;
  spotLtp: number | null;
  spotQuality: OutcomePriceQuality;
  premiums: PremiumContractPoint[];
}

export interface MdiPayoffPathInput {
  signalTs: string;
  mdiBias: MdiBias;
  signalSpot: number | null;
  signalSpotQuality: OutcomePriceQuality;
  signalCe: PremiumContractPoint;
  signalPe: PremiumContractPoint;
  path: PayoffPathPoint[];
}

export interface MdiPayoffPathResult {
  state: PayoffState;
  direction: PayoffDirection | null;
  sampleCount: number;
  spotMfePct: number | null;
  spotMaePct: number | null;
  chosenPremiumMfePct: number | null;
  chosenPremiumMaePct: number | null;
  chosenPremiumEndPct: number | null;
  oppositePremiumEndPct: number | null;
  blockers: string[];
  ruleVersion: "MDI_PAYOFF_PATH_RESEARCH_V1";
  semantics: "REPLAY_PATH_RESEARCH_ONLY";
  sourcePolicy: "VERIFIED_SAME_SESSION_SAME_CONTRACT_PATH_ONLY";
  profitPolicy: "GROSS_PATH_METRICS_ONLY_NO_COST_ADJUSTED_EDGE_CLAIM";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const verified=(q:OutcomePriceQuality)=>q==="VERIFIED";
const ms=(s:string)=>{const v=Date.parse(s);return Number.isFinite(v)?v:null};
const date=(s:string)=>{const v=ms(s);return v==null?null:new Date(v).toISOString().slice(0,10)};
const pct=(a:number,b:number)=>((b-a)/Math.abs(a))*100;
const same=(a:PremiumContractPoint,b:PremiumContractPoint)=>a.expiry===b.expiry&&a.strike===b.strike&&a.optionType===b.optionType;
function direction(b:MdiBias):PayoffDirection|null{if(b==="MILD_BULLISH"||b==="STRONG_BULLISH")return "BULLISH";if(b==="MILD_BEARISH"||b==="STRONG_BEARISH")return "BEARISH";return null;}
function extrema(values:number[],dir:PayoffDirection){if(!values.length)return {mfe:null,mae:null};return dir==="BULLISH"?{mfe:Math.max(...values),mae:Math.min(...values)}:{mfe:-Math.min(...values),mae:-Math.max(...values)};}

export function deriveMdiPayoffPathResearch(input:MdiPayoffPathInput):MdiPayoffPathResult{
  const blockers:string[]=[];
  const dir=direction(input.mdiBias);
  const signalMs=ms(input.signalTs);
  const signalDate=date(input.signalTs);
  if(!dir) blockers.push("MDI_NOT_DIRECTIONAL");
  if(signalMs==null||signalDate==null) blockers.push("INVALID_SIGNAL_TIMESTAMP");
  if(!finite(input.signalSpot)||input.signalSpot===0||!verified(input.signalSpotQuality)) blockers.push("SIGNAL_SPOT_NOT_VERIFIED");
  if(input.signalCe.optionType!=="CE"||input.signalPe.optionType!=="PE"||input.signalCe.expiry!==input.signalPe.expiry||input.signalCe.strike!==input.signalPe.strike) blockers.push("SIGNAL_PREMIUM_PAIR_NOT_MATCHED");
  if(!finite(input.signalCe.ltp)||!finite(input.signalPe.ltp)||input.signalCe.ltp===0||input.signalPe.ltp===0||!verified(input.signalCe.quality)||!verified(input.signalPe.quality)) blockers.push("SIGNAL_PREMIUMS_NOT_VERIFIED");
  const ordered=[...input.path].sort((a,b)=>(ms(a.ts)??0)-(ms(b.ts)??0));
  const seen=new Set<number>(); const spotReturns:number[]=[]; const chosenReturns:number[]=[]; let chosenEnd:number|null=null,oppEnd:number|null=null;
  for(const p of ordered){
    const t=ms(p.ts); if(t==null||signalMs==null||t<=signalMs) {blockers.push("NON_FORWARD_OR_INVALID_PATH_TIMESTAMP");continue;}
    if(date(p.ts)!==signalDate){blockers.push("CROSS_SESSION_PATH_POINT");continue;}
    if(seen.has(t)){blockers.push("DUPLICATE_PATH_TIMESTAMP");continue;} seen.add(t);
    if(!finite(p.spotLtp)||!verified(p.spotQuality)){blockers.push("PATH_SPOT_NOT_VERIFIED");continue;}
    const ce=p.premiums.filter(x=>same(input.signalCe,x)); const pe=p.premiums.filter(x=>same(input.signalPe,x));
    if(ce.length!==1||pe.length!==1||!finite(ce[0].ltp)||!finite(pe[0].ltp)||!verified(ce[0].quality)||!verified(pe[0].quality)){blockers.push("PATH_PREMIUM_CONTRACT_NOT_UNIQUELY_VERIFIED");continue;}
    spotReturns.push(pct(input.signalSpot as number,p.spotLtp));
    const chosen=dir==="BULLISH"?ce[0]:pe[0]; const opp=dir==="BULLISH"?pe[0]:ce[0]; const chosenSignal=dir==="BULLISH"?input.signalCe:input.signalPe; const oppSignal=dir==="BULLISH"?input.signalPe:input.signalCe;
    chosenEnd=pct(chosenSignal.ltp as number,chosen.ltp as number); oppEnd=pct(oppSignal.ltp as number,opp.ltp as number); chosenReturns.push(chosenEnd);
  }
  const unique=[...new Set(blockers)];
  if(unique.length||!dir||!spotReturns.length||!chosenReturns.length) return {state:"UNAVAILABLE",direction:dir,sampleCount:spotReturns.length,spotMfePct:null,spotMaePct:null,chosenPremiumMfePct:null,chosenPremiumMaePct:null,chosenPremiumEndPct:null,oppositePremiumEndPct:null,blockers:unique.length?unique:["NO_USABLE_PATH_POINTS"],ruleVersion:"MDI_PAYOFF_PATH_RESEARCH_V1",semantics:"REPLAY_PATH_RESEARCH_ONLY",sourcePolicy:"VERIFIED_SAME_SESSION_SAME_CONTRACT_PATH_ONLY",profitPolicy:"GROSS_PATH_METRICS_ONLY_NO_COST_ADJUSTED_EDGE_CLAIM",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
  const spot=extrema(spotReturns,dir); const premium=extrema(chosenReturns,"BULLISH");
  return {state:"USABLE",direction:dir,sampleCount:spotReturns.length,spotMfePct:spot.mfe,spotMaePct:spot.mae,chosenPremiumMfePct:premium.mfe,chosenPremiumMaePct:premium.mae,chosenPremiumEndPct:chosenEnd,oppositePremiumEndPct:oppEnd,blockers:[],ruleVersion:"MDI_PAYOFF_PATH_RESEARCH_V1",semantics:"REPLAY_PATH_RESEARCH_ONLY",sourcePolicy:"VERIFIED_SAME_SESSION_SAME_CONTRACT_PATH_ONLY",profitPolicy:"GROSS_PATH_METRICS_ONLY_NO_COST_ADJUSTED_EDGE_CLAIM",affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,aiMayOverride:false};
}
