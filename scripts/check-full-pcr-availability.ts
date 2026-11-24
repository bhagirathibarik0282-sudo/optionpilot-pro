import {pathToFileURL} from 'node:url';
import {deriveLiveThreeIndexPcr} from '../live-three-index-pcr.js';

/** Read the existing HTTP snapshot only: no extra broker call, DB access or writes. */
export function inspectPcrAvailability(payload:any){
 const display=payload?.snapshot?.indices?{...payload,pcrDisplay:Object.fromEntries(payload.snapshot.indices.map((a:any)=>[a.symbol,a.pcrSnapshot?{...a.pcrSnapshot,expiry:a.expiry,periodMs:60000}:null]))}:payload;
 const view=deriveLiveThreeIndexPcr(display);
 const rows=view.rows.map((r:any)=>({symbol:r.symbol,expiry:r.expiry,
  observation:r.current?'FRESH_FULL':r.reportedPcr?.basis==='LAST_REPORTED_WITH_EARLIER_PACKETS'?'LAST_REPORTED_EARLIER_PACKETS':r.reportedPcr?'SAME_SESSION_REPORTED':'UNAVAILABLE',
  value:r.current?.value??r.reportedPcr?.value??null,
  ceTotal:r.current?.ceTotal??r.reportedPcr?.ceTotal??null,peTotal:r.current?.peTotal??r.reportedPcr?.peTotal??null,
  expected:r.current?.expected??r.reportedPcr?.expected??r.coverageInfo?.expected??null,
  fresh:r.coverageInfo?.fresh??null,old:r.coverageInfo?.stale??null,missing:r.coverageInfo?.missing??null,invalid:r.coverageInfo?.invalid??null,
  checkedAt:r.current?new Date(r.current.checked).toISOString():r.reportedPcr?.checkedAt??null,
  sourceNote:r.reportedPcr?.sourceNote||null,reason:r.pcrStatus,
 }));
 const freshThreeIndexComplete=view.live&&rows.every(r=>r.observation==='FRESH_FULL');
 return {ok:freshThreeIndexComplete,freshThreeIndexComplete,
  allThreeReportedComplete:view.live&&rows.every(r=>r.value!==null),
  connectionState:payload?.connectionState??null,runtimeReason:payload?.error??null,
  serverTime:payload?.serverTime??null,rows};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const origin=new URL(process.argv[2]||'https://optionpilot-pro-v2-production.up.railway.app');
  const response=await fetch(new URL('/api/research/dashboard-live',origin),{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  const report=inspectPcrAvailability(await response.json());
  console.log(JSON.stringify({...report,httpStatus:response.status},null,2));
  process.exitCode=response.ok&&report.ok?0:2;
 }catch{console.log(JSON.stringify({ok:false,reason:'LIVE_SNAPSHOT_READ_FAILED'}));process.exitCode=2;}
}
