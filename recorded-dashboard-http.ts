import {parseRagEventRequest,readRagEventEvidence} from './rag-event-evidence.js';
import {readSameDteHistory} from './rag-same-dte-history-http.js';
import {renderRagEvidencePage} from './rag-evidence-card.js';
import { parseH1ReplayRequest, runH1ReplayHttp } from './h1-replay-http.js';
import { listH1TheoryRecordedDates } from './h1-theory-history.js';
import { compactRows } from './h1-replay-compact-v1.js';
import { resolveRecordedFullPcr, resolveRecordedOptionPdc } from './business-dashboard-v1-view.js';
import { renderRecordedDashboard } from './recorded-dashboard-view.js';
import {renderBnfShadowPage} from './bnf-shadow-page.js';
import { readBnfShadowDaywise,withBnfShadowDailyStatus } from './bnf-shadow-daywise.js';
import {bnfIstDay,validBnfHealthDate,readBnfShadowHealth} from './bnf-shadow-health.js';
import {readBnfReplayStatus} from './bnf-replay-archive.js';
import {readBnfShadowTimeline,validBnfTimelineDate} from './bnf-shadow-trade-timeline-v1.js';
import {timingSafeEqual} from 'node:crypto';

/** Narrow supervisor entry: SELECT-only archive readers. Never import server/runtime/router. */
export function createRecordedDashboardHandler(dependencies:any={}) {
 const dates=dependencies.dates||listH1TheoryRecordedDates, replay=dependencies.replay||runH1ReplayHttp;
 const ragEvidence=dependencies.ragEvidence||readRagEventEvidence,ragHistory=dependencies.ragHistory||readSameDteHistory;
 const daywise=dependencies.daywise||readBnfShadowDaywise,timeline=dependencies.timeline||readBnfShadowTimeline;
 let active=0;
 return async function handle(request:any,response:any,status:any) {
  const url=new URL(request.url||'/','http://localhost'),path=url.pathname;
  const shadowPage=path==='/banknifty-shadow';
  const view=path==='/recorded-dashboard'||path==='/api/research/recorded-dashboard/view'||
   (!status.shouldRun&&(path==='/'||path==='/api/research/business-dashboard/view'));
  const dateRoute=path==='/api/research/recorded-dashboard/dates',replayRoute=path==='/api/research/recorded-dashboard/replay',daywiseRoute=path==='/api/research/recorded-dashboard/bnf-shadow-daywise',timelineRoute=path==='/api/research/recorded-dashboard/bnf-shadow-timeline';
  const ragView=path==='/api/research/rag-event-evidence/view',ragRoute=path==='/api/research/rag-event-evidence',historyRoute=path==='/api/research/rag-same-dte-history';
  if(!view&&!shadowPage&&!dateRoute&&!replayRoute&&!daywiseRoute&&!timelineRoute&&!ragView&&!ragRoute&&!historyRoute)return false;
  const send=(code:number,value:any,html=false)=>{response.writeHead(code,{'Content-Type':html?'text/html; charset=utf-8':'application/json','Cache-Control':'no-store','X-OptionPilot-Mode':'RECORDED_READ_ONLY','X-Content-Type-Options':'nosniff'});response.end(html?value:JSON.stringify(value));return true;};
  if(request.method!=='GET')return send(405,{ok:false,error:'READ_ONLY_GET_REQUIRED'});
  if(shadowPage)return send(200,renderBnfShadowPage(),true);
  // Trade-level paper receipts are PRIVATE. Existing recorded dashboard routes are public;
  // this endpoint alone requires the pre-existing RESEARCH_ADMIN_TOKEN before any SELECT.
  if(timelineRoute){
   const secret=process.env.RESEARCH_ADMIN_TOKEN,header=request.headers.authorization;
   if(!secret)return send(503,{ok:false,error:'ADMIN_AUTH_NOT_CONFIGURED'});
   if(typeof header!=='string'||!header.startsWith('Bearer ')){
    return send(401,{ok:false,error:'ADMIN_AUTH_REQUIRED'});
   }
   const expected=Buffer.from('Bearer '+secret,'utf8'),actual=Buffer.from(header,'utf8');
   if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return send(401,{ok:false,error:'ADMIN_AUTH_REQUIRED'});
   const selected=url.searchParams.get('date');
   if(!validBnfTimelineDate(selected))return send(400,{ok:false,error:'INVALID_SHADOW_TRADE_DATE'});
  }
  if(view)return send(200,renderRecordedDashboard(status?.shouldRun===false),true);
  if(ragView)return send(200,renderRagEvidencePage(),true);
  if(active>=2){response.setHeader('Retry-After','2');return send(429,{ok:false,error:'ARCHIVE_BUSY_RETRY'});}
  // SELECT-only independent journal; no data derives from market snapshots or scaled 2-lot P&L.

  active++;
  try{
   if(ragRoute){const parsed=parseRagEventRequest(Object.fromEntries(url.searchParams));if(!parsed.ok)return send(400,{ok:false,status:'BLOCKED',reason:parsed.reason});const result=await ragEvidence(parsed.value);return send(result.ok?200:422,result);}
   if(historyRoute){const result=await ragHistory(Object.fromEntries(url.searchParams));return send(result.ok?200:422,result);}
   if(daywiseRoute){
    const date=url.searchParams.get('date')??bnfIstDay(Date.now()-86400000);
    if(!validBnfHealthDate(date))return send(400,{ok:false,reason:'INVALID_DATE'});
    const result=await daywise();
    const health=(dependencies.shadowHealth||readBnfShadowHealth)(date);
    const report=withBnfShadowDailyStatus(result,date,health);
    if(report.selectedDay)Object.assign(report.selectedDay,{replayEvidence:await (dependencies.replayStatus||readBnfReplayStatus)(date)});
    return send(result.ok?200:503,report);
   }
   if(timelineRoute){const result=await timeline(url.searchParams.get('date'));return send(result.ok?200:503,result);}
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
  }catch{return send(503,{ok:false,error:'RECORDED_STORAGE_UNAVAILABLE',...((ragRoute||historyRoute)?{status:'BLOCKED',reason:'EVIDENCE_SOURCE_UNAVAILABLE'}:{})});}
  finally{active--;}
 };
}
