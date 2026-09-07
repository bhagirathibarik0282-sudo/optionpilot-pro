import { runH1DeltaOosCalibration, type H1DeltaOosDay } from "./h1-delta-oos-calibration-v1.js";
import type { H1DeltaDteBucket } from "./h1-delta-dte-regime-calibration-v1.js";

const BUCKETS:H1DeltaDteBucket[]=["EXPIRY_0_1","NEAR_2_4","MID_5_9","FAR_10_PLUS"];
function bucketFor(dte:number):H1DeltaDteBucket|null {
  if(!Number.isFinite(dte)||dte<0) return null;
  if(dte<=1) return "EXPIRY_0_1";
  if(dte<=4) return "NEAR_2_4";
  if(dte<=9) return "MID_5_9";
  return "FAR_10_PLUS";
}
function dteFrom(day:string, expiry:string):number|null {
  const a=Date.parse(`${day.slice(0,10)}T00:00:00Z`), b=Date.parse(`${expiry.slice(0,10)}T00:00:00Z`);
  if(!Number.isFinite(a)||!Number.isFinite(b)) return null;
  const d=Math.round((b-a)/86_400_000);
  return d>=0?d:null;
}
export function runH1DeltaDteOosCalibration(days:H1DeltaOosDay[]){
  const buckets=BUCKETS.map(bucket=>{
    const bucketDays=days.map(d=>({tradeDate:d.tradeDate,rows:d.rows.filter(r=>bucketFor(dteFrom(d.tradeDate,r.expiry)??NaN)===bucket)}));
    const result=runH1DeltaOosCalibration(bucketDays);
    return {bucket,...result};
  });
  return {version:"H1_DELTA_DTE_OOS_CALIBRATION_V1",semantics:"HISTORICAL_RESEARCH_ONLY",productionImpact:"NONE",buckets,affectsSelector:false,affectsTelegram:false,affectsExecution:false,failClosed:true} as const;
}
