import { calibrateH1DeltaThreshold, type H1DeltaCalibrationObservation } from "./h1-delta-threshold-calibration-v1.js";

export interface H1DeltaOosDay { tradeDate:string; rows:H1DeltaCalibrationObservation[]; }
export function runH1DeltaOosCalibration(days:H1DeltaOosDay[]) {
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
  return {version:"H1_DELTA_OOS_CALIBRATION_V1",semantics:"HISTORICAL_RESEARCH_ONLY",productionImpact:"NONE",dayCount:ordered.length,calibrationDates:calibration.map(x=>x.tradeDate),oosDates:oos.map(x=>x.tradeDate),candidateThresholdP95:candidate,calibration:cal,validation,oosPassRateAtCandidate:oosPassRate};
}
