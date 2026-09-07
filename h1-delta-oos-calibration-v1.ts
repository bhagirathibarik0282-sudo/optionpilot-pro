import { calibrateH1DeltaThreshold, type H1DeltaCalibrationObservation } from "./h1-delta-threshold-calibration-v1.js";

export interface H1DeltaOosDay { tradeDate:string; rows:H1DeltaCalibrationObservation[]; }

type DteBucket = "EXPIRY_0_1" | "NEAR_2_4" | "MID_5_9" | "FAR_10_PLUS";
const DTE_BUCKETS:DteBucket[]=["EXPIRY_0_1","NEAR_2_4","MID_5_9","FAR_10_PLUS"];
function bucketForDte(dte:number):DteBucket|null {
  if(!Number.isFinite(dte)||dte<0) return null;
  if(dte<=1) return "EXPIRY_0_1";
  if(dte<=4) return "NEAR_2_4";
  if(dte<=9) return "MID_5_9";
  return "FAR_10_PLUS";
}
function dteFrom(tradeDate:string, row:H1DeltaCalibrationObservation & {dte?:number}):number|null {
  const canonical=Number(row.dte);
  if(Number.isInteger(canonical)&&canonical>=0) return canonical;
  const a=Date.parse(`${tradeDate.slice(0,10)}T00:00:00Z`), b=Date.parse(`${String(row.expiry).slice(0,10)}T00:00:00Z`);
  if(!Number.isFinite(a)||!Number.isFinite(b)) return null;
  const d=Math.round((b-a)/86_400_000);
  return d>=0?d:null;
}
function runCore(days:H1DeltaOosDay[]) {
  const ordered=[...days].sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));
  const cut=Math.max(1,Math.floor(ordered.length*.7));
  const calibration=ordered.slice(0,cut), oos=ordered.slice(cut);
  const cal=calibrateH1DeltaThreshold(calibration.flatMap(x=>x.rows));
  const validation=calibrateH1DeltaThreshold(oos.flatMap(x=>x.rows));
  const candidate=cal.absoluteDeltaChange.p95;
  const oosPassRate=candidate==null||!oos.length?null:(() => {
    let n=0, pass=0;
    for(const d of oos) {
      const groups=new Map<string,H1DeltaCalibrationObservation[]>();
      for(const r of d.rows){const k=`${r.symbol}|${r.expiry}|${r.strike}|${r.optionType}`; const a=groups.get(k)??[];a.push(r);groups.set(k,a);}
      for(const a of groups.values()){a.sort((x,y)=>Date.parse(x.minuteBucket)-Date.parse(y.minuteBucket));for(let i=1;i<a.length;i++)if(Date.parse(a[i].minuteBucket)-Date.parse(a[i-1].minuteBucket)===180000){n++;if(Math.abs(a[i].delta-a[i-1].delta)>=candidate)pass++;}}
    }
    return n?pass/n:null;
  })();
  return {dayCount:ordered.length,calibrationDates:calibration.map(x=>x.tradeDate),oosDates:oos.map(x=>x.tradeDate),candidateThresholdP95:candidate,calibration:cal,validation,oosPassRateAtCandidate:oosPassRate};
}
export function runH1DeltaOosCalibration(days:H1DeltaOosDay[]) {
  const overall=runCore(days);
  const dteBuckets=DTE_BUCKETS.map(bucket=>({
    bucket,
    ...runCore(days.map(d=>({tradeDate:d.tradeDate,rows:d.rows.filter(r=>bucketForDte(dteFrom(d.tradeDate,r as H1DeltaCalibrationObservation & {dte?:number})??NaN)===bucket)}))),
  }));
  return {version:"H1_DELTA_OOS_CALIBRATION_V1",semantics:"HISTORICAL_RESEARCH_ONLY",productionImpact:"NONE",...overall,dteOosCalibration:{version:"H1_DELTA_DTE_OOS_READBACK_V1",semantics:"HISTORICAL_RESEARCH_ONLY",productionImpact:"NONE",buckets:dteBuckets,affectsSelector:false,affectsTelegram:false,affectsExecution:false,failClosed:true}};
}
