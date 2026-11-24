/**
 * Shared replay display boundary, extracted from the intent of draft #836.
 * The existing recorder owns playback. This module does not create a timer,
 * request data, persist anything, or change trading authority.
 */
export function projectDashboardReplay(state:any, frame:any, blocked=false) {
  const symbols=['NIFTY','SENSEX','BANKNIFTY'], kinds=['market','options','chain'];
  const validDate=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(Date.parse(v+'T00:00:00Z')).toISOString().slice(0,10)===v;
  const stamp=(v:any)=>typeof v==='string'?Date.parse(v):NaN;
  const day=(v:any)=>Number.isFinite(stamp(v))?new Date(stamp(v)+19800000).toISOString().slice(0,10):null;
  const date=validDate(state.loadingDate)&&state.archiveLoading?state.loadingDate:validDate(frame?.date)?frame.date:validDate(state.date)?state.date:'';
  const cutoff=stamp(frame?.at);
  const timeline=[...new Set<string>((Array.isArray(frame?.timeline)?frame.timeline:[]).filter((v:any)=>day(v)===date))].sort((a,b)=>stamp(a)-stamp(b));
  const ready=!blocked&&!state.archiveLoading&&date===state.date&&frame?.date===date&&Number.isFinite(cutoff)&&day(frame.at)===date&&timeline.some(t=>stamp(t)===cutoff);
  const rowValid=(r:any,s:string)=>r?.symbol===s&&r.truth_verdict==='TRUE'&&Number.isFinite(stamp(r.minute_bucket));
  const rows=(v:any)=>Array.isArray(v)?v:[];
  const current:any={},history:any={},baseline:any={},health:any={};
  for(const s of symbols){
    current[s]=Object.fromEntries(kinds.map(k=>[k,ready?rows(frame.current?.[s]?.[k]).filter((r:any)=>rowValid(r,s)&&day(r.minute_bucket)===date&&stamp(r.minute_bucket)<=cutoff):[]]));
    history[s]=ready?rows(frame.history?.[s]).map((h:any)=>Object.fromEntries(kinds.map(k=>[k,rows(h?.[k]).filter((r:any)=>rowValid(r,s)&&day(r.minute_bucket)!==null&&String(day(r.minute_bucket))<date)]))):[];
    baseline[s]=null;
    health[s]={state:ready?'REPLAY':'UNAVAILABLE',freshness:{state:ready?'RECORDED':'UNAVAILABLE',latestAt:ready?frame.at:null},message:ready?'Recorded playback; no live substitution':'Replay frame unavailable'};
  }
  // Explicit allowlist of the production dashboard state fields. Do not spread
  // live state or retrospective derived events into a historical frame.
  return {date,scope:state.scope,recordedDates:rows(state.recordedDates).filter(validDate),current,history,baseline,health,
    stocks:{},sectors:null,cash:null,cashLoading:false,cashError:'Unavailable at replay time',
    ratings:[],quoteStatus:{},quoteLoading:false,loading:!!state.archiveLoading,archiveLoading:!!state.archiveLoading,
    loadingDate:state.archiveLoading?date:null,
    replay:{active:true,at:ready?frame.at:null,playing:ready&&!!frame.playing,timeline:ready?timeline:[],index:ready?timeline.findIndex(t=>stamp(t)===cutoff):-1}};
}

/** Watch's 09:15–15:30 inclusive minute grid. Never round a timestamp or use the nearest quote. */
export function replayWatchMinute(date:string, at:string|null):number|null {
  if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))return null;
  const ist=new Date(Date.parse(at)+19800000).toISOString();
  if(ist.slice(0,10)!==date||ist.slice(17,23)!=='00.000')return null;
  const minute=Number(ist.slice(11,13))*60+Number(ist.slice(14,16));
  return minute>=555&&minute<=930?minute-555:null;
}
