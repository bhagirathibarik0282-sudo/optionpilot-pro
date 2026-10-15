import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { parseH1FixedContractJourneyRequest } from './h1-fixed-contract-journey-http.js';
import { parseH1ReplayRequest, runH1ReplayHttp, type H1ReplayHttpResult, type H1ReplayRequest } from './h1-replay-http.js';
import { isCasTradingDate } from './cas-closing-memory.js';
import { prepareMemoryData } from './intraday-observation-memory.js';

type Row = Record<string, any>;
export type RagEventRequest = { symbol: H1ReplayRequest['symbol']; date: string; expiry: string; strike: number;
  side: 'CE'|'PE'; time: string; includeOutcomes: boolean; asOf: number };
const SAFETY = { readOnly:true, writesPerformed:false, affectsSelector:false, affectsVerdict:false,
  affectsTelegram:false, affectsExecution:false, createsOrders:false } as const;
const iso = (v:unknown) => { const n=Date.parse(String(v??'')); return Number.isFinite(n)?new Date(n).toISOString():null; };
const num = (v:unknown) => (typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
const at = (d:string,t:string) => Date.parse(`${d}T${t}:00+05:30`);
const clock = (ms:number) => new Date(ms+19800000).toISOString().slice(11,16);
const day = (ms:number) => new Date(ms+19800000).toISOString().slice(0,10);
const expiry = (r:Row) => iso(r.expiry)?.slice(0,10);
const hash = (rows:unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function one(rows:Row[]):Row|null {
  const unique=new Map(rows.map(r=>[JSON.stringify(r),r]));
  return unique.size===1?[...unique.values()][0]:null;
}
export function previousRagSession(date:string):string|null {
  for(let i=1;i<=10;i++) { const d=new Date(Date.parse(date+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);if(isCasTradingDate(d))return d; }
  return null;
}
export function parseRagEventRequest(q:Record<string,string|undefined>): {ok:true;value:RagEventRequest}|{ok:false;reason:string} {
  const fixed=parseH1FixedContractJourneyRequest({symbol:q.symbol,expiry:q.expiry,strike:q.strike,optionType:q.side,fromDate:q.date,toDate:q.date});
  if(!fixed.ok)return fixed;
  const time=q.time??'';const replay=parseH1ReplayRequest({symbol:q.symbol,tradeDate:q.date,fromTime:time,toTime:time});
  if(!replay.ok)return replay;
  if(!isCasTradingDate(fixed.value.fromDate)||!previousRagSession(fixed.value.fromDate))return {ok:false,reason:'UNSUPPORTED_OR_NONTRADING_DATE'};
  const minutes=Number(time.slice(0,2))*60+Number(time.slice(3));
  if(minutes<558||(minutes-555)%3!==0)return {ok:false,reason:'EVENT_REQUIRES_REGULAR_3M_PAIR'};
  if(q.includeOutcomes!==undefined&&!['true','false'].includes(q.includeOutcomes))return {ok:false,reason:'INVALID_OUTCOME_OPTION'};
  let asOf=Infinity;
  if(q.asOf!==undefined) {
    if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(q.asOf)||
      !parseH1ReplayRequest({tradeDate:q.asOf.slice(0,10)}).ok)return {ok:false,reason:'INVALID_AS_OF'};
    asOf=Date.parse(q.asOf+(/(?:Z|[+-]\d{2}:\d{2})$/.test(q.asOf)?'':'+05:30'));
    if(!Number.isFinite(asOf))return {ok:false,reason:'INVALID_AS_OF'};
  }
  return {ok:true,value:{symbol:fixed.value.symbol,date:fixed.value.fromDate,expiry:fixed.value.expiry,
    strike:fixed.value.strike,side:fixed.value.optionType,time,includeOutcomes:q.includeOutcomes==='true',asOf}};
}
function marketAt(replay:H1ReplayHttpResult,r:RagEventRequest,ms:number):Row|null {
  return one((replay.market??[]).filter(m=>m.symbol===r.symbol&&iso(m.minute_bucket)===new Date(ms).toISOString()));
}
function quoteAt(replay:H1ReplayHttpResult,r:RagEventRequest,ms:number,side:string,cutoff=Infinity):Row|null {
  const m=marketAt(replay,r,ms);
  if(!m||m.truth_verdict!=='TRUE'||!iso(m.backend_timestamp)||Date.parse(iso(m.backend_timestamp)!)>cutoff||ms>cutoff)return null;
  const rows=(replay.options??[]).filter(o=>o.symbol===r.symbol&&expiry(o)===r.expiry&&num(o.strike)===r.strike&&o.option_type===side&&iso(o.minute_bucket)===new Date(ms).toISOString());
  // Relative expiry aliases can duplicate an identical exact contract.
  const signatures=new Map(rows.map(o=>[JSON.stringify([o.ltp,o.oi,o.quote_timestamp,o.snapshot_id,o.truth_verdict,o.day_high,o.day_low]),o]));
  if(signatures.size!==1)return null;
  const q=[...signatures.values()][0],qt=iso(q.quote_timestamp),price=num(q.ltp);
  if(!qt||price===null||price<=0||q.truth_verdict!=='TRUE'||!q.snapshot_id||q.snapshot_id!==m.snapshot_id)return null;
  const age=(Date.parse(iso(m.backend_timestamp)!)-Date.parse(qt))/1000;
  if(day(Date.parse(qt))!==day(ms)||age< -5||age>30||Date.parse(qt)>cutoff)return null;
  return {price,oi:num(q.oi),quoteAt:qt,receiptAt:iso(m.backend_timestamp),snapshotId:q.snapshot_id,
    quoteAgeSeconds:age,dayHigh:num(q.day_high),dayLow:num(q.day_low),storedPdh:num(q.pdh),storedPdl:num(q.pdl)};
}
export function buildRagEventEvidence(r:RagEventRequest,current:H1ReplayHttpResult,prior:H1ReplayHttpResult) {
  const fail=(reason:string)=>({ok:false,mode:'READ_ONLY_RAG_EVENT_EVIDENCE_V1',status:'BLOCKED',reason,safety:SAFETY});
  const previous=previousRagSession(r.date);
  if(!current.ok||!prior.ok)return fail('REPLAY_SOURCE_UNAVAILABLE');
  if(current.request?.symbol!==r.symbol||current.request.tradeDate!==r.date||prior.request?.symbol!==r.symbol||prior.request.tradeDate!==previous)return fail('REPLAY_SOURCE_IDENTITY_MISMATCH');
  const end=at(previous!,'15:30'),terminal=quoteAt(prior,r,end,r.side,r.asOf);
  if(!terminal||terminal.dayHigh===null||terminal.dayLow===null||terminal.dayLow<=0||terminal.dayHigh<terminal.dayLow)return fail('PREVIOUS_REFERENCE_UNAVAILABLE');
  const priorTimes=[...new Set((prior.options??[]).filter(o=>o.symbol===r.symbol&&expiry(o)===r.expiry&&num(o.strike)===r.strike&&o.option_type===r.side).map(o=>iso(o.minute_bucket)))].filter((s):s is string=>s!==null);
  const referenceRows=priorTimes.filter(s=>day(Date.parse(s))===previous).map(s=>quoteAt(prior,r,Date.parse(s),r.side,r.asOf)).filter((q):q is Row=>q!==null);
  if(referenceRows.some(q=>q.dayHigh===null||q.dayLow===null||q.dayLow<=0||q.dayHigh<q.dayLow)||
    Math.max(...referenceRows.map(q=>q.dayHigh))!==terminal.dayHigh||Math.min(...referenceRows.map(q=>q.dayLow))!==terminal.dayLow)return fail('PREVIOUS_REFERENCE_INCONSISTENT');
  const eventMs=at(r.date,r.time),before=quoteAt(current,r,eventMs-180000,r.side,r.asOf),event=quoteAt(current,r,eventMs,r.side,r.asOf);
  if(!before||!event)return fail('EXACT_EVENT_PAIR_UNAVAILABLE_AT_CUTOFF');
  const a=before.price,b=event.price,lo=terminal.dayLow,hi=terminal.dayHigh,flags:string[]=[];
  if(a>=lo&&b<lo)flags.push('PDL_LOSS');if(a<lo&&b>=lo)flags.push('PDL_RECOVERY');
  if(a<=hi&&b>hi)flags.push('PDH_BREAK');if(a>hi&&b<=hi)flags.push('PDH_LOSS');
  if(!flags.length)return fail('NO_RECONCILED_LEVEL_CROSSING');
  const prepared=prepareMemoryData(current);
  const checkpoint=(offset:number) => {
    const ms=eventMs+offset*60000;
    if(day(ms)!==r.date||ms<at(r.date,'09:15')||ms>at(r.date,'15:30')||ms>r.asOf)return null;
    const market=marketAt(current,r,ms);
    if(!market||market.truth_verdict!=='TRUE'||!iso(market.backend_timestamp)||Date.parse(iso(market.backend_timestamp)!)>r.asOf)return null;
    const ce=quoteAt(current,r,ms,'CE',r.asOf),pe=quoteAt(current,r,ms,'PE',r.asOf);
    const chain=one(prepared.chain.filter(c=>c.symbol===r.symbol&&expiry(c)===r.expiry&&iso(c.minute_bucket)===new Date(ms).toISOString()));
    return {offset,timeIst:clock(ms),bucketAt:new Date(ms).toISOString(),receiptAt:iso(market.backend_timestamp),pair:{ce,pe},
      context:{spot:num(market.spot_ltp),pdc:num(market.spot_prev_close),pdh:num(market.pdh),pdl:num(market.pdl),vix:num(market.india_vix),
        futures:num(market.future_ltp),futuresOi:num(market.future_oi),fullPcr:num(chain?.full_chain_oi_pcr),fullPcrSource:chain?.full_pcr_source??null,
        ceWall:num(chain?.call_wall_strike),peWall:num(chain?.put_wall_strike),ceWallOi:num(chain?.call_wall_oi),peWallOi:num(chain?.put_wall_oi)}};
  };
  const beforeAndAt=[-30,-15,-6,-3,0].map(checkpoint);
  const outcomes=r.includeOutcomes?[3,6,15,30].map(checkpoint):[];
  const sourceRows={previous:referenceRows,current:beforeAndAt,outcomes};
  return {ok:true,status:'PARTIAL',mode:'READ_ONLY_RAG_EVENT_EVIDENCE_V1',source:'EXISTING_POSTGRES_H1_REPLAY',safety:SAFETY,
    identity:{symbol:r.symbol,date:r.date,expiry:r.expiry,strike:r.strike,side:r.side,dte:Math.round((Date.parse(r.expiry)-Date.parse(r.date))/86400000)},
    event:{timeIst:r.time,flags,before:a,after:b,availableAt:new Date(Math.max(Date.parse(event.receiptAt),Date.parse(event.quoteAt))).toISOString()},
    reference:{sourceDate:previous,pdh:hi,pdl:lo,terminalAt:terminal.receiptAt,semantics:'RETROSPECTIVELY_RECONCILED_RECORDED_RANGE'},
    beforeAndAt,outcomes,cutoff:r.asOf===Infinity?null:new Date(r.asOf).toISOString(),
    coverage:{current:current.continuity??null,previous:prior.continuity??null},
    provenance:{selectedEvidenceSha256:hash(sourceRows),digestSemantics:'SELECTED_NORMALIZED_EVIDENCE_NOT_RAW_HTTP_BYTES',snapshotIds:[...new Set([before.snapshotId,event.snapshotId])]},
    answer:`${r.date} ${r.symbol} ${r.strike} ${r.side}, expiry ${r.expiry}: ${r.time} ISTରେ ${flags.join(', ')}। ପୂର୍ବ ୩ ମିନିଟ୍‌ର ₹${a.toFixed(2)} → ₹${b.toFixed(2)}; ଯାଞ୍ଚ ହୋଇଥିବା PDH ₹${hi.toFixed(2)}, PDL ₹${lo.toFixed(2)}।`,
    limitations:['Structured retrieval and deterministic answer; no embeddings or LLM call.','Exchange freshness and futures expiry continuity independently unverified.',
      'Exact index/expiry/strike/side identity; instrument token absent.','Wall label shift is not same-strike OI transfer.','No causal, trading, probability or profitability authority.']};
}
export async function readRagEventEvidence(r:RagEventRequest,read=runH1ReplayHttp) {
  const previous=previousRagSession(r.date)!;
  const eventMs=at(r.date,r.time),toMs=Math.min(at(r.date,'15:30'),eventMs+(r.includeOutcomes?30:0)*60000,r.asOf);
  if(toMs<eventMs)return {ok:false,status:'BLOCKED',reason:'EVENT_AFTER_CUTOFF',safety:SAFETY};
  const [current,prior]=await Promise.all([
    read({symbol:r.symbol,tradeDate:r.date,fromTime:clock(Math.max(at(r.date,'09:15'),eventMs-30*60000)),toTime:clock(toMs),scope:'CORE'}),
    read({symbol:r.symbol,tradeDate:previous,fromTime:'09:15',toTime:'15:30',scope:'CORE'})]);
  return buildRagEventEvidence(r,current,prior);
}
export function mountRagEventEvidenceRoute(app:Hono,read=readRagEventEvidence) {
  app.get('/rag-event-evidence',async c=>{
    c.header('Cache-Control','no-store');const p=parseRagEventRequest(c.req.query());
    if(!p.ok)return c.json({ok:false,status:'BLOCKED',reason:p.reason,safety:SAFETY},400);
    try {const result=await read(p.value);return c.json(result,result.ok?200:result.reason==='REPLAY_SOURCE_UNAVAILABLE'?503:422);}
    catch {return c.json({ok:false,status:'BLOCKED',reason:'EVIDENCE_SOURCE_UNAVAILABLE',safety:SAFETY},503);}
  });
}
