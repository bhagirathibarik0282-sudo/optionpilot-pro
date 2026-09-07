import { calibrateH1DeltaThreshold, type H1DeltaCalibrationObservation } from "./h1-delta-threshold-calibration-v1.js";

export type H1DeltaDteBucket = "EXPIRY_0_1" | "NEAR_2_4" | "MID_5_9" | "FAR_10_PLUS";

export interface H1DeltaDteCalibrationObservation extends H1DeltaCalibrationObservation { dte: number; }

function bucketFor(dte:number):H1DeltaDteBucket {
  if(dte<=1) return "EXPIRY_0_1";
  if(dte<=4) return "NEAR_2_4";
  if(dte<=9) return "MID_5_9";
  return "FAR_10_PLUS";
}

export function calibrateH1DeltaByDte(rows:H1DeltaDteCalibrationObservation[]) {
  const buckets:Record<H1DeltaDteBucket,H1DeltaDteCalibrationObservation[]>={EXPIRY_0_1:[],NEAR_2_4:[],MID_5_9:[],FAR_10_PLUS:[]};
  for(const r of rows){ if(Number.isInteger(r.dte)&&r.dte>=0) buckets[bucketFor(r.dte)].push(r); }
  const out=Object.entries(buckets).map(([bucket,rs])=>({bucket:bucket as H1DeltaDteBucket,...calibrateH1DeltaThreshold(rs)}));
  return {version:"H1_DELTA_DTE_CALIBRATION_V1",semantics:"HISTORICAL_RESEARCH_ONLY",productionImpact:"NONE",buckets:out,affectsSelector:false,affectsExecution:false,failClosed:true} as const;
}
