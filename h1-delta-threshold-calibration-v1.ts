export interface H1DeltaCalibrationObservation {
  symbol: string;
  minuteBucket: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  ltp: number;
  delta: number;
  gamma: number;
}

export interface H1DeltaCalibrationSummary {
  version: "H1_DELTA_THRESHOLD_CALIBRATION_V1";
  semantics: "HISTORICAL_RESEARCH_ONLY";
  cadenceMinutes: 3;
  sampleCount: number;
  absoluteDeltaChange: { p50: number | null; p75: number | null; p90: number | null; p95: number | null; p99: number | null; max: number | null; passRateAt003: number | null };
  productionImpact: "NONE";
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const a=[...xs].sort((x,y)=>x-y);
  const i=(a.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo);
}

export function calibrateH1DeltaThreshold(rows: H1DeltaCalibrationObservation[]): H1DeltaCalibrationSummary {
  const groups=new Map<string,H1DeltaCalibrationObservation[]>();
  for(const r of rows){
    if(!Number.isFinite(Date.parse(r.minuteBucket))||!Number.isFinite(r.delta)||!Number.isFinite(r.gamma)||r.gamma<0||!Number.isFinite(r.ltp)||r.ltp<=0) continue;
    const k=`${r.symbol}|${r.expiry}|${r.strike}|${r.optionType}`;
    const a=groups.get(k)??[]; a.push(r); groups.set(k,a);
  }
  const changes:number[]=[];
  for(const a of groups.values()){
    a.sort((x,y)=>Date.parse(x.minuteBucket)-Date.parse(y.minuteBucket));
    for(let i=1;i<a.length;i++){
      const gap=Date.parse(a[i].minuteBucket)-Date.parse(a[i-1].minuteBucket);
      if(gap===180000) changes.push(Math.abs(a[i].delta-a[i-1].delta));
    }
  }
  return {
    version:"H1_DELTA_THRESHOLD_CALIBRATION_V1", semantics:"HISTORICAL_RESEARCH_ONLY", cadenceMinutes:3,
    sampleCount:changes.length,
    absoluteDeltaChange:{p50:percentile(changes,.5),p75:percentile(changes,.75),p90:percentile(changes,.9),p95:percentile(changes,.95),p99:percentile(changes,.99),max:changes.length?Math.max(...changes):null,passRateAt003:changes.length?changes.filter(x=>x>=.03).length/changes.length:null},
    productionImpact:"NONE"
  };
}
