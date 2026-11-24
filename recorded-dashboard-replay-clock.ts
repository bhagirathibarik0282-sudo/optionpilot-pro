/**
 * Shared replay display boundary, extracted from the intent of draft #836.
 * The existing recorder owns playback. This module does not create a timer,
 * request data, persist anything, or change trading authority.
 */
export function projectDashboardReplay(state:any, frame:any, blocked=false) {
  const symbols=['NIFTY','SENSEX','BANKNIFTY'], kinds=['market','options','chain'];
  const validDate=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(Date.parse(v+'T00:00:00Z')).toISOString().slice(0,10)===v;
  const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
  const day=(v:any)=>Number.isFinite(stamp(v))?new Date(stamp(v)+19800000).toISOString().slice(0,10):null;
  const date=validDate(state.loadingDate)&&state.archiveLoading?state.loadingDate:validDate(frame?.date)?frame.date:validDate(state.date)?state.date:'';
  const cutoff=stamp(frame?.at);
  const timeline=[...new Set<string>((Array.isArray(frame?.timeline)?frame.timeline:[]).filter((v:any)=>day(v)===date))].sort((a,b)=>stamp(a)-stamp(b));
  const ready=!blocked&&!state.archiveLoading&&date===state.date&&frame?.date===date&&Number.isFinite(cutoff)&&day(frame.at)===date&&timeline.some(t=>stamp(t)===cutoff);
  const rowValid=(r:any,s:string)=>r?.symbol===s&&r.truth_verdict==='TRUE'&&Number.isFinite(stamp(r.minute_bucket));
  const rows=(v:any)=>Array.isArray(v)?v:[];
  // Recorded row and marker clocks are lower bounds on availability, not
  // proof of transaction commit, exchange freshness or immutable history.
  const known=(r:any,k:string)=>{
    const bucket=stamp(r.minute_bucket),stored=stamp(r.created_at),marker=stamp(r.truth_marker_created_at);
    if(!(bucket<=cutoff&&stored>=bucket&&stored<=cutoff&&marker>=bucket&&marker<=cutoff))return false;
    if(k==='market'){const receipt=stamp(r.backend_timestamp);return receipt>=bucket&&receipt<=stored;}
    if(k==='options'){const quote=stamp(r.quote_timestamp);return day(r.quote_timestamp)===day(r.minute_bucket)&&quote<=stored;}
    return true;
  };
  const derivedKnown=(source:any,recorded:any,bucket:any)=>{
    const t=stamp(source),r=stamp(recorded),b=stamp(bucket);
    return t>=b&&t<b+60000&&r>=t&&r<=cutoff;
  };
  const sanitize=(r:any,k:string)=>{
    if(k==='chain'&&r.full_pcr_source==='Exact archived full-chain source'&&!derivedKnown(r.full_pcr_source_timestamp,r.full_pcr_recorded_at,r.minute_bucket))
      return {...r,full_chain_oi_pcr:null,full_pcr_source:'Archive source not yet available at cursor'};
    if(k==='options'&&r.pdc_source==='EXACT_ARCHIVED_KITE_OHLC_CLOSE'&&!derivedKnown(r.pdc_source_timestamp,r.pdc_recorded_at,r.minute_bucket))
      return {...r,pdc:null,pdc_source:'Archive source not yet available at cursor'};
    return r;
  };
  const project=(v:any,s:string,prior=false)=>Object.fromEntries(kinds.map(k=>[k,rows(v?.[k]).filter((r:any)=>rowValid(r,s)&&(prior?day(r.minute_bucket)!==null&&String(day(r.minute_bucket))<date:day(r.minute_bucket)===date)&&known(r,k)).map((r:any)=>sanitize(r,k))]));
  const current:any={},history:any={},baseline:any={},health:any={};
  for(const s of symbols){
    current[s]=ready?project(frame.current?.[s],s):Object.fromEntries(kinds.map(k=>[k,[]]));
    history[s]=ready?rows(frame.history?.[s]).map((h:any)=>project(h,s,true)):[];
    baseline[s]=null;
    health[s]={state:ready?'REPLAY':'UNAVAILABLE',freshness:{state:ready?'RECORDED':'UNAVAILABLE',latestAt:ready?frame.at:null},message:ready?'Recorded row/marker availability cutoff; commit time unverified; no live substitution':'Replay frame unavailable'};
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

/** A full-expiry archived sample is not a band sample. Qualify its source
 * and storage-row timestamps independently. Storage time is not a fill or
 * a guarantee of transaction-commit availability. No timestamp rounding. */
export function sharedFullOiRows(rows:any[],date:string,symbol:string,expiry:string,at:string|null){
 const out=new Map<number,any>(),ambiguous=new Set<number>();
 const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const cutoff=stamp(at),open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!Number.isFinite(cutoff)||cutoff<open||cutoff>close||!expiry)return out;
 for(const r of rows||[]){
  const source=stamp(r?.sourceAt),stored=stamp(r?.recordedAt);
  if(r?.symbol!==symbol||r.expiry!==expiry||!(source>=open&&source<=cutoff&&source<close&&stored>=source&&stored<=cutoff)||
   !Number.isSafeInteger(r.ceOi)||r.ceOi<=0||!Number.isSafeInteger(r.peOi)||r.peOi<0||
   typeof r.pcr!=='number'||!Number.isFinite(r.pcr)||r.pcr<0||Math.abs(r.pcr-r.peOi/r.ceOi)>Math.max(1,r.pcr)*1e-12)continue;
  const bucket=Math.floor((source-open)/60000);
  if(stored>=open+(bucket+1)*60000)continue;
  if(out.has(bucket)){ambiguous.add(bucket);continue;}
  out.set(bucket,r);
 }
 for(const bucket of ambiguous)out.delete(bucket);
 return out;
}

/** Exact archived 30-leg band, separated from full-expiry OI. Require the
 * same market snapshot, one CE and PE per integer offset, same strike by
 * offset and valid OI/quote timestamps. Never substitute missing legs. */
export function sharedBandOiRows(data:any,date:string,symbol:string,expiry:string,at:string|null){
 const out=new Map<number,any>(),market=new Map<number,any[]>(),options=new Map<number,any[]>();
 const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const cutoff=stamp(at),open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!Number.isFinite(cutoff)||cutoff<open||cutoff>close||!expiry)return out;
 const number=(v:any)=>typeof v==='number'||typeof v==='string'&&v.trim()!==''?Number(v):NaN;
 const group=(map:Map<number,any[]>,r:any)=>{const t=stamp(r.minute_bucket);if(!(t>=open&&t<=close&&t<=cutoff&&(t-open)%60000===0)||r.symbol!==symbol)return;const list=map.get(t)||[];list.push(r);map.set(t,list);};
 for(const r of data?.market||[])group(market,r);
 for(const r of data?.options||[])if(String(r.expiry).slice(0,10)===expiry&&Number.isInteger(number(r.atm_offset))&&Math.abs(number(r.atm_offset))<=7)group(options,r);
 for(const [t,legs] of options){
  const ms=market.get(t);if(ms?.length!==1||ms[0].truth_verdict!=='TRUE'||!ms[0].snapshot_id||legs.length!==30)continue;
  const ce=new Map<number,any>(),pe=new Map<number,any>();let valid=true;
  for(const r of legs){
   const side=r.option_type==='CE'?ce:r.option_type==='PE'?pe:null,offset=number(r.atm_offset),oi=number(r.oi),strike=number(r.strike),q=stamp(r.quote_timestamp),age=number(r.quote_age_seconds);
   if(!side||side.has(offset)||r.truth_verdict!=='TRUE'||r.snapshot_id!==ms[0].snapshot_id||!Number.isSafeInteger(oi)||oi<0||!(strike>0&&Number.isFinite(strike))||!(age>=0&&age<=30)||!(q>=open&&q<=cutoff&&q<t+60000)){valid=false;break;}
   side.set(offset,{oi,strike});
  }
  if(!valid||ce.size!==15||pe.size!==15)continue;
  let ceOi=0,peOi=0,previous=-Infinity;const strikes:number[]=[];
  for(let k=-7;k<=7;k++){const c=ce.get(k),p=pe.get(k);if(!c||!p||c.strike!==p.strike||c.strike<=previous){valid=false;break;}previous=c.strike;strikes.push(c.strike);ceOi+=c.oi;peOi+=p.oi;}
  if(!valid||!Number.isSafeInteger(ceOi)||ceOi<=0||!Number.isSafeInteger(peOi))continue;
  out.set((t-open)/60000,{expiry,ceOi,peOi,pcr:peOi/ceOi,basket:strikes.join('|'),coverage:30});
 }
 return out;
}
