import { parseH1ReplayRequest, runH1ReplayHttp } from './h1-replay-http.js';
import { listH1TheoryRecordedDates } from './h1-theory-history.js';
import { compactRows } from './h1-replay-compact-v1.js';
import { resolveRecordedFullPcr, resolveRecordedOptionPdc } from './business-dashboard-v1-view.js';
import { renderRecordedDashboard } from './recorded-dashboard-view.js';

/** Narrow supervisor entry: SELECT-only archive readers. Never import server/runtime/router. */
export function createRecordedDashboardHandler(dependencies:any={}) {
 const dates=dependencies.dates||listH1TheoryRecordedDates, replay=dependencies.replay||runH1ReplayHttp;
 let active=0;
 return async function handle(request:any,response:any,status:any) {
  const url=new URL(request.url||'/','http://localhost'),path=url.pathname;
  const view=path==='/recorded-dashboard'||path==='/api/research/recorded-dashboard/view'||
   (!status.shouldRun&&(path==='/'||path==='/api/research/business-dashboard/view'));
  const dateRoute=path==='/api/research/recorded-dashboard/dates',replayRoute=path==='/api/research/recorded-dashboard/replay';
  if(!view&&!dateRoute&&!replayRoute)return false;
  const send=(code:number,value:any,html=false)=>{response.writeHead(code,{'Content-Type':html?'text/html; charset=utf-8':'application/json','Cache-Control':'no-store','X-OptionPilot-Mode':'RECORDED_READ_ONLY','X-Content-Type-Options':'nosniff'});response.end(html?value:JSON.stringify(value));return true;};
  if(request.method!=='GET')return send(405,{ok:false,error:'READ_ONLY_GET_REQUIRED'});
  if(view)return send(200,renderRecordedDashboard(),true);
  if(active>=2){response.setHeader('Retry-After','2');return send(429,{ok:false,error:'ARCHIVE_BUSY_RETRY'});}
  active++;
  try{
   if(dateRoute){const result=await dates();return send(result.ok?200:503,result);}
   const parsed=parseH1ReplayRequest({symbol:url.searchParams.get('symbol'),tradeDate:url.searchParams.get('date'),fromTime:url.searchParams.get('from'),toTime:url.searchParams.get('to'),scope:'CORE'});
   if(!parsed.ok)return send(400,{ok:false,error:parsed.reason});
   const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
   if(minutes(parsed.value.toTime)-minutes(parsed.value.fromTime)>60)return send(400,{ok:false,error:'MAX_ARCHIVE_WINDOW_60_MINUTES'});
   const result=await replay(parsed.value,true);
   if(!result.ok)return send(503,{ok:false,error:result.reason||'ARCHIVE_QUERY_FAILED'});
   // Verify legacy PCR/PDC using exact archived provenance before discarding bulky canonical rows.
   return send(200,{ok:true,mode:'RECORDED_READ_ONLY',request:result.request,
    market:compactRows(result.market||[]),options:compactRows(resolveRecordedOptionPdc(result)),
    chain:compactRows(resolveRecordedFullPcr(result)),continuity:result.continuity||null});
  }catch{return send(503,{ok:false,error:'RECORDED_STORAGE_UNAVAILABLE'});}
  finally{active--;}
 };
}
