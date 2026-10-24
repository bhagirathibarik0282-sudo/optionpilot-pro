import type {Hono} from 'hono';
import {parseRagEventRequest,readRagEventEvidence} from './rag-event-evidence.js';
import {buildEventContextLadder,type ContextObservation,type ContextInput} from './rag-event-context-ladder.js';
import {renderEventContextLadder,EVENT_CONTEXT_LADDER_CSS} from './rag-event-context-ladder-view.js';

/**
 * One explicit Recorder click → existing audited RAG snapshot read → source
 * bounded event-family ladder. No new source, database, poller or new RAG model.
 */
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const num=(n:unknown):number|null=>typeof n==='number'&&Number.isFinite(n)?n:null;
const iso=(x:unknown):string|null=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const SAFETY={readOnly:true,writesPerformed:false,brokerRequests:false,newDatabase:false,
  affectsSelector:false,affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false} as const;
type RagEvidence=Record<string,any>;
function verifiedInput(raw:RagEvidence,includeOutcomes:boolean):ContextInput|null {
 if(!raw||raw.ok!==true||!raw.identity||!raw.event||raw.mode!=='READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1'||
   raw.source!=='EXISTING_POSTGRES_H1_REPLAY'||raw.safety?.readOnly!==true)return null;
 const e=raw.identity, at=String(raw.event.timeIst??'');
 if(!['NIFTY','SENSEX','BANKNIFTY'].includes(e.symbol)||!['CE','PE'].includes(e.side)||
   !/^\d{4}-\d\d-\d\d$/.test(e.date)||!/^\d{4}-\d\d-\d\d$/.test(e.expiry)||
   !Number.isInteger(e.strike)||e.strike<=0||!/^\d\d:\d\d$/.test(at))return null;
 const available=iso(raw.event.availableAt),digest=raw.provenance?.selectedEvidenceSha256;
 if(!available||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))return null;
 const eventMs=Date.parse(e.date+'T'+at+':00+05:30');
 if(!(Date.parse(available)>=eventMs&&Date.parse(available)<eventMs+60000))return null;
 const observations:ContextObservation[]=[];
 const identity={index:e.symbol,date:e.date,timeIst:at,kind:'PREMIUM_SNAPSHOT',
   expiry:e.expiry,strike:e.strike,side:e.side};
 const points=[...(Array.isArray(raw.beforeAndAt)?raw.beforeAndAt:[]),
   ...(includeOutcomes&&Array.isArray(raw.outcomes)?raw.outcomes:[])];
 for(const p of points){
   if(!p||!Number.isInteger(p.offset)||p.offset>0&&!includeOutcomes)continue;
   const bucket=iso(p.bucketAt),receipt=iso(p.receiptAt);
   if(!bucket||!receipt||p.timeIst!==new Date(Date.parse(bucket)+19800000).toISOString().slice(11,16)||
     Date.parse(bucket)!==eventMs+p.offset*60000)continue;
   const add=(family:ContextObservation['family'],entity:string,metric:string,value:unknown,sourceAt:string,
     availableAt:string,provenance:string,extra:Partial<ContextObservation>={})=>{
     const n=num(value);if(n===null)return;
     observations.push({index:e.symbol,family,entity,metric,value:n,bucketAt:bucket,
       sourceAt,availableAt,source:'EXISTING_RECORDED',verified:true,
       provenance:'H1 TRUE replay · '+provenance+' · '+digest,...extra});
   };
   // TRUE marker and recorded receipt confirm a saved market measurement, not
   // the exchange freshness of each stock/futures/option packet.
   for(const [field,label] of [['spot','LTP'],['pdh','PDH'],['pdc','PDC'],['pdl','PDL'],['vix','INDIA_VIX']] as const)
     add('SPOT',field==='vix'?'INDIA VIX':e.symbol,label,p.context?.[field],receipt,receipt,
       'market marker receipt; spot exchange-source time independently unverified');
   const q=p.pair?.[e.side.toLowerCase()];
   if(q&&iso(q.quoteAt)&&iso(q.receiptAt)&&q.snapshotId){
     add('PREMIUM',e.strike+' '+e.side,'LTP',q.price,iso(q.quoteAt)!,iso(q.receiptAt)!,
       'exact side/strike/expiry quote, snapshot '+String(q.snapshotId),{
         expiry:e.expiry,strike:e.strike,side:e.side
       });
     add('PREMIUM',e.strike+' '+e.side,'OI',q.oi,iso(q.quoteAt)!,iso(q.receiptAt)!,
       'archived quote OI; not proof of OI-change time',{
         expiry:e.expiry,strike:e.strike,side:e.side
       });
   }
   // Only explicitly resolved full-chain provenance, never a band substitute.
   if(['Exact archived full-chain source','Normalized full-chain source','Exact canonical full-chain source'].includes(p.context?.fullPcrSource)){
     add('PCR_OI','FULL PCR','OI PCR',p.context.fullPcr,receipt,receipt,
       p.context.fullPcrSource+'; chain source exchange-age independently unverified',{expiry:e.expiry});
   }
   // Futures expiry/continuity, historical sector weights and intra-session
   // institutional flow are not validated by this particular replay response.
   // Keep those family panels missing rather than manufacturing a row.
 }
 const end=e.date+'T15:30:00+05:30';
 // Market-close 15:30 bucket may be received seconds after the bucket starts.
 // Retrospective as-of allows that final minute, but never changes eventKnownAt.
 return {event:identity,observations,asOf:new Date(Date.parse(end)+60000).toISOString(),eventKnownAt:available,includeOutcomes,
   offsets:[-30,-15,-3,0,3,15,30]};
}
export function projectRecordedRagLadder(raw:RagEvidence,includeOutcomes=true){
 const input=verifiedInput(raw,includeOutcomes);
 if(!input)return {ok:false,reason:'EXACT_RAG_SOURCE_OR_EVENT_KNOWN_AT_UNAVAILABLE',mode:'READ_ONLY_EVENT_CONTEXT_LADDER_V1',safety:SAFETY};
 return buildEventContextLadder(input);
}
export function renderRecordedRagLadderPage(html:string,status=200){
 const title='OptionPilot Pro · Recorder Event Context';
 return '<!doctype html><html lang="or"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
   esc(title)+'</title><style>body{margin:0;background:#071225;color:#ecf6ff;font:16px/1.5 system-ui}main{max-width:1100px;margin:auto;padding:12px}a{color:#8ce5f5}'+
   EVENT_CONTEXT_LADDER_CSS+'</style></head><body><main><p><a href="/api/research/business-dashboard/view">← Recorder / Dashboard</a></p>'+
   '<p role="status">Saved evidence · read only · HTTP '+status+'. Similarity retrieval and constituent interval histories are not claimed.</p>'+
   html+'</main></body></html>';
}
export function mountRecorderEventContextLadderRoute(
 app:Hono,read:typeof readRagEventEvidence=readRagEventEvidence) {
 app.get('/rag-event-context-ladder/view',async c=>{
   c.header('Cache-Control','no-store');
   // Explicit user selection. Never auto-select a contract, fill a missing
   // timestamp, or infer a crossing from a snapshot.
   const query={...c.req.query(),kind:'SNAPSHOT',includeOutcomes:'true',lookback:'3'};
   const parsed=parseRagEventRequest(query);
   if(!parsed.ok)return c.html(renderRecordedRagLadderPage(
     '<section role="alert">Invalid exact recorded selection: '+esc(parsed.reason)+'</section>',400),400);
   try {
     const evidence=await read(parsed.value);
     // Defend the request/response boundary: even a well-formed snapshot for
     // ANOTHER contract must never be shown for the chosen recorder selection.
     const identity=(evidence as RagEvidence)?.identity;
     const matched=identity?.symbol===parsed.value.symbol&&
       identity?.date===parsed.value.date&&identity?.expiry===parsed.value.expiry&&
       identity?.strike===parsed.value.strike&&identity?.side===parsed.value.side&&
       (evidence as RagEvidence)?.event?.timeIst===parsed.value.time;
     const projected=matched?projectRecordedRagLadder(evidence,true):
       {ok:false,reason:'REQUEST_RESPONSE_CONTRACT_IDENTITY_MISMATCH',
        mode:'READ_ONLY_EVENT_CONTEXT_LADDER_V1',safety:SAFETY};
     const code=projected.ok?200:422;
     return c.html(renderRecordedRagLadderPage(renderEventContextLadder(projected),code),code);
   }catch{
     return c.html(renderRecordedRagLadderPage(
       '<section role="alert">Saved research read unavailable. No values substituted.</section>',503),503);
   }
 });
}
