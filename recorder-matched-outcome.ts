import {projectRecordedRagLadder} from './rag-recorder-event-ladder-bridge.js';

type Snapshot=Record<string,any>;
export type RecorderMatchRule={
 version:string; declaredAt:string; features:('PREMIUM_3M_DIRECTION'|'SPOT_VS_PDC')[];
 horizonMinutes:3|15|30; movement:'INCREASE'|'DECREASE'; minimumMovePct:number;
 minIndependentSessions:number;
};
export type RecorderHistoryScope={
 source:'EXISTING_POSTGRES_H1_REPLAY'; sessionDates:string[]; complete:boolean;
 truncated:boolean; failedSessionDates:string[];
};
const dateMs=(s:unknown)=>{
 if(typeof s!=='string'||!/^\d{4}-\d\d-\d\d$/.test(s))return NaN;
 const t=Date.parse(s+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?t:NaN;
};
const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
// Compare the decimal values supplied by the Recorder without rounding a
// floating-point percentage at an inclusive outcome threshold.
function decimal(v:number):[bigint,bigint]{
 const [coefficient,exponent='0']=v.toString().split('e');
 const [whole,fraction='']=coefficient.split('.'),scale=fraction.length-Number(exponent);
 const n=BigInt(whole+fraction);
 return scale>=0?[n,10n**BigInt(scale)]:[n*10n**BigInt(-scale),1n];
}
function meetsMove(start:number,end:number,minimumPct:number,increase:boolean){
 const [a,ad]=decimal(start),[b,bd]=decimal(end),[m,md]=decimal(minimumPct);
 return (b*ad-a*bd)*(increase?1n:-1n)*100n*md>=a*bd*m;
}
const cell=(view:any,offset:number,family:string,metric:string)=>view.lanes?.find((l:any)=>l.offsetMinutes===offset)?.cells.find((c:any)=>c.family===family&&c.metric===metric);
function admitted(raw:Snapshot){
 try{
  if(!raw||raw.safety?.writesPerformed!==false||!finite(dateMs(raw.identity?.date))||!finite(dateMs(raw.identity?.expiry)))return null;
  const view=projectRecordedRagLadder(raw,false);if(!view.ok)return null;
  const price=cell(view,0,'PREMIUM','LTP'),spot=cell(view,0,'SPOT','LTP');
  const dte=(dateMs(raw.identity.expiry)-dateMs(raw.identity.date))/86400000;
  if(!price||price.value<=0||!spot||spot.value<=0||!Number.isInteger(dte)||dte<0)return null;
  return {raw,view,price,spot,dte,id:[raw.identity.symbol,raw.identity.date,raw.identity.expiry,raw.identity.strike,raw.identity.side,raw.event.timeIst].join('|')};
 }catch{return null;}
}
function signature(a:NonNullable<ReturnType<typeof admitted>>,rule:RecorderMatchRule){
 const values:any[]=[a.raw.identity.symbol,a.raw.identity.side,a.dte,a.raw.event.timeIst,
  Math.sign(a.spot.value-a.raw.identity.strike)*(a.raw.identity.side==='CE'?1:-1)];
 for(const feature of rule.features){
  if(feature==='PREMIUM_3M_DIRECTION'){
   // Existing projection admits a delta only for exact adjacent comparable endpoints.
   const baseline=cell(a.view,-3,'PREMIUM','LTP');
   if(!finite(a.price.changePct)||!baseline||baseline.value<=0)return null;
   values.push(Math.sign(a.price.value-baseline.value));
  }else if(feature==='SPOT_VS_PDC'){
   const pdc=cell(a.view,0,'SPOT','PDC');if(!pdc||pdc.value<=0)return null;
   values.push(Math.sign(a.spot.value-pdc.value));
  }else return null;
 }
 return JSON.stringify(values);
}
/** Internal deterministic core only. Supply snapshots/scope from audited Recorder
 * loaders, never LLM matches or public request JSON. No loader/UI is wired here. */
export function computeRecorderMatchedOutcome(target:Snapshot,history:Snapshot[],rule:RecorderMatchRule,scope:RecorderHistoryScope){
 const counts={loaded:history?.length??0,rejected:0,outsideScope:0,unmatched:0,duplicates:0,
  conflicts:0,missingFeatures:0,matchedEpisodes:0,selectedSessions:0,missingOutcomes:0,resolved:0,qualifying:0};
 const episodes:any[]=[];
 const base={mode:'READ_ONLY_RECORDER_MATCHED_OUTCOME_V1',label:'Historical matched outcome rate',
  rule:rule??null,matching:'SAME_INDEX_SIDE_CALENDAR_DTE_EVENT_MINUTE_AND_MONEYNESS_SIGN',
  deduplication:'EARLIEST_MATCH_PER_PRIOR_SESSION_BEFORE_OUTCOME_REVIEW',
  counts,episodes,safety:{readOnly:true,writesPerformed:false,affectsSelector:false,affectsTelegram:false,affectsExecution:false},
  limitations:['Historical frequency, not a calibrated forecast, trade win rate or profit probability.',
   'Supplied session inventory must be produced by an audited complete Recorder loader.',
   'Calendar DTE and relative strike sign are coarse matching conditions; strikes may differ across episodes.',
   'One episode per session reduces overlap; independence across sessions is not guaranteed.']};
 const unavailable=(reason:string)=>({...base,status:'UNAVAILABLE',reason,ratePct:null,confidence95Pct:null});
 if(!Array.isArray(history)||!rule||typeof rule.version!=='string'||!rule.version.trim()||
  !Number.isFinite(Date.parse(rule.declaredAt))||!Array.isArray(rule.features)||rule.features.length<1||
  new Set(rule.features).size!==rule.features.length||rule.features.some(f=>!['PREMIUM_3M_DIRECTION','SPOT_VS_PDC'].includes(f))||
  ![3,15,30].includes(rule.horizonMinutes)||!['INCREASE','DECREASE'].includes(rule.movement)||
  !finite(rule.minimumMovePct)||rule.minimumMovePct<=0||!Number.isInteger(rule.minIndependentSessions)||rule.minIndependentSessions<2)
  return unavailable('MATCH_RULE_NOT_CONFIGURED');
 const chosen=admitted(target);if(!chosen)return unavailable('TARGET_RECORDER_EVIDENCE_UNAVAILABLE');
 const targetKnownAt=Date.parse(target.event.availableAt);
 if(Date.parse(rule.declaredAt)>targetKnownAt)return unavailable('RULE_DECLARED_AFTER_TARGET_CUTOFF');
 if(!scope||scope.source!=='EXISTING_POSTGRES_H1_REPLAY'||scope.complete!==true||scope.truncated!==false||
  !Array.isArray(scope.sessionDates)||!scope.sessionDates.length||new Set(scope.sessionDates).size!==scope.sessionDates.length||
  scope.sessionDates.some(d=>!finite(dateMs(d))||d>=target.identity.date)||
  !Array.isArray(scope.failedSessionDates)||scope.failedSessionDates.length)
  return unavailable('COMPLETE_HISTORY_SCOPE_UNAVAILABLE');
 const targetSignature=signature(chosen,rule);if(targetSignature===null)return unavailable('TARGET_MATCH_FEATURE_UNAVAILABLE');
 const events=new Map<string,{sample:NonNullable<ReturnType<typeof admitted>>;fingerprint:string;conflict:boolean}>();
 for(const raw of history){
  // Exclude the selected/current session and later sessions before matching.
  if(raw?.identity?.date>=target.identity.date){counts.outsideScope++;continue;}
  const a=admitted(raw);if(!a){counts.rejected++;continue;}
  if(!scope.sessionDates.includes(a.raw.identity.date)){counts.outsideScope++;continue;}
  const fingerprint=JSON.stringify([a.view,a.raw.provenance.selectedEvidenceSha256,a.raw.outcomes??[]]);
  const old=events.get(a.id);
  if(old){counts.duplicates++;if(old.fingerprint!==fingerprint)old.conflict=true;continue;}
  events.set(a.id,{sample:a,fingerprint,conflict:false});
 }
 const perSession=new Map<string,NonNullable<ReturnType<typeof admitted>>>();
 for(const {sample:a,conflict} of events.values()){
  if(conflict){counts.conflicts++;continue;}
  const key=signature(a,rule);
  if(key===null){counts.missingFeatures++;continue;}
  if(key!==targetSignature){counts.unmatched++;continue;}
  counts.matchedEpisodes++;
  const old=perSession.get(a.raw.identity.date);
  if(!old||Date.parse(a.raw.event.availableAt)<Date.parse(old.raw.event.availableAt)||
   a.raw.event.availableAt===old.raw.event.availableAt&&a.id.localeCompare(old.id)<0)perSession.set(a.raw.identity.date,a);
 }
 // Select the session episode without examining its eventual outcome.
 const samples=[...perSession.values()].sort((a,b)=>a.id.localeCompare(b.id));counts.selectedSessions=samples.length;
 for(const a of samples){
  let end:any=null;
  try{const view=projectRecordedRagLadder(a.raw,true);if(view.ok)end=cell(view,rule.horizonMinutes,'PREMIUM','LTP');}catch{}
  if(!end||end.value<=0||Date.parse(end.availableAt)>targetKnownAt){counts.missingOutcomes++;continue;}
  const changePct=(end.value-a.price.value)/a.price.value*100;
  if(!finite(changePct)){counts.missingOutcomes++;continue;}
  const qualifies=meetsMove(a.price.value,end.value,rule.minimumMovePct,rule.movement==='INCREASE');
  counts.resolved++;if(qualifies)counts.qualifying++;
  episodes.push({recorderEventId:a.id,sourceDate:a.raw.identity.date,contract:{...a.raw.identity},
   evidenceSha256:a.raw.provenance.selectedEvidenceSha256,eventKnownAt:a.raw.event.availableAt,
   outcomeAvailableAt:end.availableAt,horizonMinutes:rule.horizonMinutes,eventPrice:a.price.value,
   outcomePrice:end.value,changePct,qualifies});
 }
 // Unknown outcomes or ambiguous admissions must not disappear from the denominator.
 if(counts.rejected||counts.conflicts||counts.missingFeatures||counts.missingOutcomes)
  return unavailable('INCOMPLETE_OR_CONFLICTING_RECORDER_EVIDENCE');
 if(counts.resolved<rule.minIndependentSessions)return unavailable('INSUFFICIENT_INDEPENDENT_RECORDER_MATCHES');
 const n=counts.resolved,p=counts.qualifying/n,z=1.959963984540054,z2=z*z;
 // Wilson score interval: NIST https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
 const denominator=1+z2/n,center=(p+z2/(2*n))/denominator;
 const half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/denominator;
 return {...base,status:'AVAILABLE',reason:'VERIFIED_MATCHED_OUTCOMES_COUNTED',ratePct:p*100,
  confidence95Pct:{method:'WILSON_SCORE_APPROXIMATE',low:p===0?0:Math.max(0,center-half)*100,high:p===1?100:Math.min(1,center+half)*100}};
}
