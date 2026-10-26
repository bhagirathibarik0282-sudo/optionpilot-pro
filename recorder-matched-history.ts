import {listH1TheoryRecordedDates} from './h1-theory-history.js';
import {runH1ReplayHttp,parseH1ReplayRequest,type H1ReplayHttpResult,type H1ReplayRequest} from './h1-replay-http.js';
import {buildRagPremiumSnapshot,inspectRagSnapshotAdmission,parseRagEventRequest,type RagEventRequest} from './rag-event-evidence.js';
import {computeRecorderMatchedOutcome,validRecorderMatchRule,type RecorderMatchRule} from './recorder-matched-outcome.js';

type Input={target:Record<string,string|undefined>;historyFrom:string;historyTo:string;rule:RecorderMatchRule};
type Dependencies={listDates:typeof listH1TheoryRecordedDates;read:typeof runH1ReplayHttp};
const DAY=86400000,MAX_SESSIONS=20,MAX_CONTRACTS_PER_SESSION=64;
const day=(d:string)=>Date.parse(d+'T00:00:00Z');
const exactDate=(d:unknown)=>typeof d==='string'&&/^\d{4}-\d\d-\d\d$/.test(d)&&parseH1ReplayRequest({tradeDate:d}).ok;
const iso=(v:unknown)=>{const t=Date.parse(String(v??''));return Number.isFinite(t)?new Date(t).toISOString():null;};
const minute=(t:string)=>Number(t.slice(0,2))*60+Number(t.slice(3));
const clock=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');

/** Internal, explicit read-only operation. Not mounted on HTTP or app startup.
 * Enumerate every recorded contract in the selected bounded date/time scope;
 * never ask an LLM or caller to provide the matching cases. */
export async function loadRecorderMatchedHistory(input:Input,deps:Dependencies={listDates:listH1TheoryRecordedDates,read:runH1ReplayHttp}){
 const audit={dateIndexReads:0,replayReads:0,selectedSessionDates:[] as string[],loadedSessionDates:[] as string[],
  failedSessionDates:[] as string[],recordedContracts:0,emptyContractSessions:[] as string[],
  rejectedContracts:[] as {date:string;expiry:string;strike:number;side:string;reason:string}[],
  targetAdmission:null as ReturnType<typeof inspectRagSnapshotAdmission>|null};
 const base={mode:'READ_ONLY_RECORDER_MATCHED_HISTORY_V1',audit,
  limits:{maxSessions:MAX_SESSIONS,maxContractsPerSession:MAX_CONTRACTS_PER_SESSION,concurrency:1,retries:0},
  safety:{readOnly:true,writesPerformed:false,newDatabase:false,affectsSelector:false,affectsTelegram:false,affectsExecution:false},
  limitations:['Bounded recorded-date scope, not all history or exchange-wide contract inventory.',
   'Only initial supported matching features; no public route or dashboard activation.',
   'No previous-session reference read: current matching features do not use prior PDH/PDL.']};
 const fail=(reason:string)=>({...base,status:'UNAVAILABLE',reason,ratePct:null,result:null});
 if(!input||!validRecorderMatchRule(input.rule))return fail('MATCH_RULE_NOT_CONFIGURED');
 const parsed=parseRagEventRequest({...input.target,kind:'SNAPSHOT',lookback:'3',includeOutcomes:'false'});
 if(!parsed.ok)return fail(parsed.reason);
 const targetRequest=parsed.value,eventMinute=minute(targetRequest.time);
 if(!exactDate(input.historyFrom)||!exactDate(input.historyTo)||
  input.historyFrom>input.historyTo||input.historyTo>=targetRequest.date)return fail('INVALID_PRIOR_HISTORY_RANGE');
 if(eventMinute<558||eventMinute+input.rule.horizonMinutes>930)return fail('EXACT_OUTCOME_WINDOW_OUTSIDE_SESSION');
 const request=(date:string,outcomes:boolean):H1ReplayRequest=>({symbol:targetRequest.symbol,tradeDate:date,
  fromTime:clock(eventMinute-3),toTime:clock(eventMinute+(outcomes?input.rule.horizonMinutes:0)),scope:'FULL'});
 const read=async(q:H1ReplayRequest)=>{
  audit.replayReads++;const r=await deps.read(q);
  if(!r?.ok||r.mode!=='READ_ONLY_H1_3M_REPLAY'||r.productionImpact!=='NONE'||
   !r.request||Object.entries(q).some(([k,v])=>(r.request as any)[k]!==v)||
   !Array.isArray(r.market)||!Array.isArray(r.options)||!Array.isArray(r.chain))throw new Error('SOURCE_READ_OR_IDENTITY_FAILED');
  const c=r.continuity;
  if(!c?.complete||c.missingBuckets.length||c.observedMarkerBuckets!==c.expectedBuckets||
   c.truthCounts.TRUE!==c.expectedBuckets)throw new Error('INCOMPLETE_SOURCE_MARKERS');
  return r;
 };
 // These features deliberately do not use retrospective prior-session levels.
 // An absent optional reference is not fabricated into a successful prior read.
 const noPrior:H1ReplayHttpResult={ok:false,mode:'READ_ONLY_H1_3M_REPLAY',productionImpact:'NONE',request:null,
  reason:'PRIOR_REFERENCE_NOT_REQUESTED_FOR_SUPPORTED_MATCH_FEATURES'};
 try{
  audit.dateIndexReads++;
  const inventory=await deps.listDates();
  if(!inventory?.ok||inventory.mode!=='READ_ONLY_H1_RECORDED_DATE_INDEX_V1'||inventory.productionImpact!=='NONE'||!Array.isArray(inventory.dates))
   return fail('RECORDER_DATE_INVENTORY_UNAVAILABLE');
  if(inventory.dates.some(r=>r.symbol===targetRequest.symbol&&!exactDate(r.tradeDate)))
   return fail('AMBIGUOUS_DATE_INVENTORY');
  const dates=inventory.dates.filter(r=>r.symbol===targetRequest.symbol&&r.tradeDate>=input.historyFrom&&r.tradeDate<=input.historyTo)
   .map(r=>r.tradeDate).sort();
  if(new Set(dates).size!==dates.length||dates.some(d=>!exactDate(d)))return fail('AMBIGUOUS_DATE_INVENTORY');
  if(dates.length>MAX_SESSIONS)return fail('HISTORY_RANGE_EXCEEDS_BOUNDED_SESSION_LIMIT');
  if(!dates.length)return fail('NO_RECORDED_SESSIONS_IN_RANGE');
  audit.selectedSessionDates=dates;
  const current=await read(request(targetRequest.date,false));
  const target=buildRagPremiumSnapshot(targetRequest,current,noPrior);
  if(!target.ok){audit.targetAdmission=inspectRagSnapshotAdmission(targetRequest,current);return fail('TARGET_RECORDER_SNAPSHOT_UNAVAILABLE');}
  // Validate target rule/cutoff/features before reading any historical sessions.
  const preflight=computeRecorderMatchedOutcome(target,[],input.rule,{source:'EXISTING_POSTGRES_H1_REPLAY',sessionDates:dates,
   complete:true,truncated:false,failedSessionDates:[]});
  if(preflight.reason!=='INSUFFICIENT_INDEPENDENT_RECORDER_MATCHES')return fail(preflight.reason);
  const dte=(day(targetRequest.expiry)-day(targetRequest.date))/DAY;
  const snapshots:Record<string,any>[]=[];
  for(const date of dates){
   try{
    const replay=await read(request(date,true)),expiry=new Date(day(date)+dte*DAY).toISOString().slice(0,10);
    const contracts=new Set<number>();
    const fromMs=Date.parse(date+'T'+clock(eventMinute-3)+':00+05:30');
    const toMs=Date.parse(date+'T'+clock(eventMinute+input.rule.horizonMinutes)+':00+05:30');
    // Enumerate identities across the entire loaded window, not just surviving
    // event-time rows. A lost event row must become rejected evidence instead
    // of silently deleting a contract/session from the probability denominator.
    for(const row of replay.options!){
     if(row.symbol!==targetRequest.symbol||row.option_type!==targetRequest.side)continue;
     const contractExpiry=iso(row.expiry)?.slice(0,10);
     if(!contractExpiry)throw new Error('INVALID_RECORDED_CONTRACT_EXPIRY');
     if(contractExpiry!==expiry)continue;
     const stamp=iso(row.minute_bucket),ms=stamp?Date.parse(stamp):NaN;
     if(!Number.isFinite(ms)||ms<fromMs||ms>toMs)throw new Error('CONTRACT_ROW_OUTSIDE_REPLAY_WINDOW');
     const strike=Number(row.strike);
     if(!Number.isInteger(strike)||strike<=0)throw new Error('INVALID_RECORDED_CONTRACT_INVENTORY');
     contracts.add(strike);
    }
    if(contracts.size>MAX_CONTRACTS_PER_SESSION)throw new Error('CONTRACT_INVENTORY_EXCEEDS_BOUND');
    if(!contracts.size)audit.emptyContractSessions.push(date);
    for(const strike of [...contracts].sort((a,b)=>a-b)){
     const selected:RagEventRequest={...targetRequest,date,expiry,strike,includeOutcomes:true,asOf:Date.parse(target.event.availableAt)};
     const snapshot=buildRagPremiumSnapshot(selected,replay,noPrior);
     if(!snapshot.ok)audit.rejectedContracts.push({date,expiry,strike,side:targetRequest.side,reason:snapshot.reason});
     snapshots.push(snapshot);
     audit.recordedContracts++;
    }
    audit.loadedSessionDates.push(date);
   }catch{
    audit.failedSessionDates.push(date);
    // No source retry, outcome-based replacement or silent successful partial pool.
    return fail('HISTORICAL_RECORDER_SESSION_READ_INCOMPLETE');
   }
  }
  const result=computeRecorderMatchedOutcome(target,snapshots,input.rule,{source:'EXISTING_POSTGRES_H1_REPLAY',sessionDates:dates,
   complete:true,truncated:false,failedSessionDates:[]});
  return {...base,status:result.status,reason:result.reason,ratePct:result.ratePct,result};
 }catch{return fail('RECORDER_HISTORY_LOAD_FAILED');}
}
