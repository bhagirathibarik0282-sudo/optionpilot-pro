/** Compact Watch history for the existing verified full-expiry PCR samples. */
export const DASHBOARD_WATCH_OI_KIND = 'DASHBOARD_WATCH_OI_V1';
const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
type WatchOiSample = {
 symbol: string; expiry: string; sourceAt: string; pcr: number;
 ceOi: number; peOi: number; ceWall: number | null; peWall: number | null;
};
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const stamp = (value: unknown) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
function watchOiSample(date: string, row: any): WatchOiSample | null {
 const time=stamp(row?.sourceAt),open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!symbols.includes(row?.symbol)||!validDate(row.expiry)||row.expiry<date||!(time>=open&&time<close)||
  !Number.isSafeInteger(row.ceOi)||row.ceOi<=0||!Number.isSafeInteger(row.peOi)||row.peOi<0||
  typeof row.pcr!=='number'||!Number.isFinite(row.pcr)||row.pcr<0||Math.abs(row.pcr-row.peOi/row.ceOi)>Math.max(1,row.pcr)*1e-12)return null;
 return {symbol:row.symbol,expiry:row.expiry,sourceAt:new Date(time).toISOString(),pcr:row.pcr,ceOi:row.ceOi,peOi:row.peOi,
  ceWall:positive(row.ceWall),peWall:positive(row.peWall)};
}
export function dashboardWatchOiCycle(date: string, cycleAt: string, results: ReadonlyMap<string, any>) {
 const cycle=stamp(cycleAt);
 if(!validDate(date)||!(cycle>=Date.parse(date+'T09:15:00+05:30')&&cycle<Date.parse(date+'T15:30:00+05:30')))return null;
 const rows=symbols.flatMap(symbol=>{
  const nearest=[...results.keys()].filter(key=>key.startsWith(symbol+'|')).sort()[0];
  const result=results.get(nearest),lo=stamp(result?.sourceMinAt),hi=stamp(result?.sourceMaxAt),checked=stamp(result?.checkedAt);
  const coverage=result?.coverage;
  if(result?.state!=='COMPLETE'||result.source!=='KITE_REST_FULL_EXPIRY_SNAPSHOT'||result.fetchState!=='OK'||
   result.cycleStartedAt!==cycleAt||coverage?.complete!==true||!Number.isInteger(coverage.expected)||coverage.expected<=0||
   coverage.freshOi!==coverage.expected||!(checked>=cycle&&checked-cycle<=60000&&hi>=lo&&hi-lo<=30000&&checked-hi>=-5000&&checked-lo<=30000)||
   lo<Date.parse(date+'T09:15:00+05:30'))return [];
  const row=watchOiSample(date,{symbol,expiry:nearest.split('|')[1],sourceAt:result.sourceMaxAt,pcr:result.fullPcr,
   ceOi:result.ceTotal,peOi:result.peTotal,ceWall:result.callWall?.strike,peWall:result.putWall?.strike});
  return row?[row]:[];
 });
 return rows.length?{version:DASHBOARD_WATCH_OI_KIND,memoryKey:cycleAt,tradeDate:date,rows}:null;
}
export async function readDashboardWatchOi(date: string, query: (sql:string,params:unknown[])=>Promise<{rows:any[]}|null>, now=new Date()) {
 if(!validDate(date)||date>new Date(now.getTime()+19_800_000).toISOString().slice(0,10))throw Error('INVALID_DATE');
 const start=Date.parse(date+'T00:00:00+05:30');
 const result=await query('SELECT payload,created_at AS recorded_at FROM app_state_log WHERE kind=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC,id DESC LIMIT 376',
  [DASHBOARD_WATCH_OI_KIND,new Date(start).toISOString(),new Date(start+86_400_000).toISOString()]);
 if(!result)throw Error('STORAGE_UNAVAILABLE');
 const rows=new Map<string,WatchOiSample & {recordedAt?:string}>();
 for(const {payload,recorded_at} of result.rows){
  if(payload?.version!==DASHBOARD_WATCH_OI_KIND||payload.tradeDate!==date||!Array.isArray(payload.rows)||payload.rows.length>3)continue;
  for(const raw of payload.rows){
   const row=watchOiSample(date,raw);
   if(!row||stamp(row.sourceAt)>now.getTime())continue;
   const key=row.symbol+'|'+row.expiry+'|'+row.sourceAt.slice(0,16);
   const prior=rows.get(key);
   const recorded=recorded_at instanceof Date?recorded_at.getTime():stamp(recorded_at);
   const qualified=Number.isFinite(recorded)&&recorded>=stamp(row.sourceAt)&&recorded<=now.getTime();
   if(!prior||row.sourceAt>prior.sourceAt)rows.set(key,qualified?{...row,recordedAt:new Date(recorded).toISOString()}:row);
  }
 }
 return {date,rows:[...rows.values()]};
}
