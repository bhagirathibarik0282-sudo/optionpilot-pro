/**
 * Research-only presentation adapter for one selected recorded event.
 * Inputs must already have passed the upstream recorded/official-source gates.
 * It does not retrieve, interpolate, rank, score, or infer trading direction.
 */
export type ContextFamily = 'SPOT'|'FUTURES'|'PREMIUM'|'PCR_OI'|'HEAVYWEIGHT'|'SECTOR'|'FII_DII';
export type IndexSymbol = 'NIFTY'|'SENSEX'|'BANKNIFTY';
export type ContextPhase = 'BEFORE'|'EVENT'|'AFTER';
export type EventIdentity = {
  index: IndexSymbol; date: string; timeIst: string; kind: string;
  expiry?: string; strike?: number; side?: 'CE'|'PE';
};
export type ContextObservation = {
  index: IndexSymbol; family: ContextFamily; entity: string; metric: string;
  // All timestamps are ISO-8601 with explicit offset or Z. bucketAt is the
  // recorded observation bucket, not an invented exact exchange tick.
  bucketAt: string; sourceAt: string; availableAt: string;
  value: number|null; changePct?: number|null;
  weightPct?: number|null; weightSource?: string|null;
  contribution?: number|null; contributionSource?: string|null;
  expiry?: string; strike?: number; side?: 'CE'|'PE';
  sessionDate?: string; publishedAt?: string;
  verified: boolean; source: 'EXISTING_RECORDED'|'OFFICIAL_FII_DII';
  provenance: string;
};
export type ContextCell = {
  family: ContextFamily; entity: string; metric: string; value: number|null;
  changePct: number|null; weightPct: number|null; contribution: number|null;
  bucketAt: string; sourceAt: string; availableAt: string; provenance: string;
};
export type ContextLane = { phase: ContextPhase; offsetMinutes: number; timeIst: string; cells: ContextCell[] };
export type ContextInput = {
  event: EventIdentity; observations: ContextObservation[]; asOf: string;
  // When the triggering event was first OBSERVED/ACCEPTED, not its minute bucket.
  // Mandatory to exclude quotes arriving after the event became known.
  eventKnownAt: string;
  includeOutcomes?: boolean; offsets?: readonly number[];
};
const SAFETY = {readOnly:true,writesPerformed:false,brokerRequests:false,newDatabase:false,
  affectsSelector:false,affectsVerdict:false,affectsTelegram:false,affectsExecution:false,createsOrders:false} as const;
const DEFAULT_OFFSETS = [-30,-15,-3,0,3,15,30] as const;
const VALID_OFFSETS = new Set([-60,-30,-15,-6,-3,-1,0,1,3,6,15,30,60]);
const n = (v: unknown): number|null => typeof v==='number' && Number.isFinite(v)?v:null;
const utc = (v: string): number|null => {
  if(typeof v!=='string'|| !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t=Date.parse(v);return Number.isFinite(t)?t:null;
};
const ist = (t:number) => new Date(t+19800000).toISOString().slice(11,16);
const eventMs=(e:EventIdentity):number|null=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!/^(?:0[9]|1[0-5]):[0-5]\d$/.test(e.timeIst))return null;
  if(e.timeIst<'09:15'||e.timeIst>'15:30')return null;
  const t=Date.parse(e.date+'T'+e.timeIst+':00+05:30');
  return Number.isFinite(t)&&new Date(t+19800000).toISOString().slice(0,10)===e.date?t:null;
};
const key=(o:ContextObservation)=>[o.family,o.entity,o.metric,o.bucketAt,o.expiry??'',o.strike??'',o.side??''].join('|');
const fingerprint=(o:ContextObservation)=>JSON.stringify([
  o.index,o.family,o.entity,o.metric,o.bucketAt,o.sourceAt,o.availableAt,o.value,
  o.changePct,o.weightPct,o.weightSource,o.contribution,o.contributionSource,
  o.expiry,o.strike,o.side,o.provenance
]);
function cell(o:ContextObservation):ContextCell {
  const weight= n(o.weightPct);
  const contribution=n(o.contribution);
  return {family:o.family,entity:o.entity,metric:o.metric,value:n(o.value),
    // No publication or intraday cell may inherit an unproven caller arrow.
    // Intraday deltas are filled only by measuredCell's admitted 3m baseline.
    changePct:null,
    weightPct:weight!==null && weight>=0 && weight<=100 && !!o.weightSource?.trim()?weight:null,
    contribution:contribution!==null && !!o.contributionSource?.trim()?contribution:null,
    bucketAt:o.bucketAt,sourceAt:o.sourceAt,availableAt:o.availableAt,provenance:o.provenance};
}
export function buildEventContextLadder(input:ContextInput){
  const at=eventMs(input.event),asOf=utc(input.asOf),knownAt=utc(input.eventKnownAt);
  const offsets=input.offsets??DEFAULT_OFFSETS;
  const fail=(reason:string)=>({ok:false,reason,mode:'READ_ONLY_EVENT_CONTEXT_LADDER_V1',safety:SAFETY});
  if(at===null||asOf===null||knownAt===null||knownAt<at||knownAt>=at+60000||asOf<knownAt||!input.event.kind?.trim())return fail('INVALID_EVENT_OR_ASOF');
  if(!Array.isArray(offsets)||!offsets.length||offsets.length>12||
    new Set(offsets).size!==offsets.length||offsets.some(x=>!VALID_OFFSETS.has(x)))return fail('INVALID_OFFSETS');
  if(!['NIFTY','SENSEX','BANKNIFTY'].includes(input.event.index))return fail('INVALID_INDEX');
  const sessionOpen=Date.parse(input.event.date+'T09:15:00+05:30');
  const sessionClose=Date.parse(input.event.date+'T15:30:00+05:30');
  // A historical event match must use only observations known when the event
  // actually became visible. Its bucket START is not a decision timestamp.
  // Retrospective +N outcomes remain a separate opt-in lane.
  const eventKnowledgeCutoff=knownAt;
  const blocked:string[]=[];
  const groups=new Map<string,ContextObservation[]>();
  let rejected=0;
  for(const o of input.observations){
    // FII/DII is a dated publication, NOT an intraday data point.
    if(o.family==='FII_DII'){
      if(o.index!==input.event.index) {rejected++;continue;}
      const p=o.publishedAt?utc(o.publishedAt):null;
      const available=utc(o.availableAt),source=utc(o.sourceAt);
      if(o.source!=='OFFICIAL_FII_DII'||!o.verified||!o.provenance||!o.sessionDate||
        o.sessionDate>input.event.date||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(o.sessionDate)||
        p===null||available===null||source===null||
        source>p||p>available||source>at||p>eventKnowledgeCutoff||
        available>at||available>asOf||!o.entity?.trim()||!o.metric?.trim()) {rejected++;continue;}
      const k='PUBLISHED|'+o.entity+'|'+o.metric+'|'+o.sessionDate;
      groups.set(k,[...(groups.get(k)??[]),o]);continue;
    }
    if(o.index!==input.event.index||o.source!=='EXISTING_RECORDED'||!o.verified||
      !o.provenance||!o.entity||!o.metric) {rejected++;continue;}
    if(o.family==='PREMIUM' && (!/^\d{4}-\d{2}-\d{2}$/.test(input.event.expiry??'')||
      !Number.isInteger(input.event.strike)||!(input.event.strike!>0)||
      !['CE','PE'].includes(input.event.side??'')||
      o.expiry!==input.event.expiry||o.strike!==input.event.strike||o.side!==input.event.side)){rejected++;continue;}
    if(o.family==='PCR_OI'&&input.event.expiry&&o.expiry!==input.event.expiry){rejected++;continue;}
    const bucket=utc(o.bucketAt),source=utc(o.sourceAt),available=utc(o.availableAt);
    if(bucket===null||source===null||available===null||source>available+5000||
      available>asOf||available<bucket||available>=bucket+60000||
      bucket<sessionOpen||bucket>sessionClose||source<bucket-60000||source>=bucket+60000){rejected++;continue;}
    const minutes=(bucket-at)/60000;
    if(!offsets.includes(minutes)||(!input.includeOutcomes&&minutes>0)||
      (minutes<=0&&(available>eventKnowledgeCutoff||source>eventKnowledgeCutoff))){rejected++;continue;}
    // Historical outcomes remain separate and never enter the event-time lane.
    const k=key(o);
    groups.set(k,[...(groups.get(k)??[]),o]);
  }
  const unique=new Map<string,ContextObservation>();
  for(const [k,items] of groups){
    if(new Set(items.map(fingerprint)).size!==1){blocked.push('CONFLICTING_OBSERVATIONS:'+k);continue;}
    unique.set(k,items[0]);
  }
  // Δ% is permitted only from two admitted observations of the SAME metric,
  // EXACT option identity and adjacent 3-minute buckets. No nearest neighbor,
  // interpolation, missing-window fill, or retrospective future baseline.
  const seriesKey=(o:ContextObservation)=>[o.family,o.entity,o.metric,o.expiry??'',o.strike??'',o.side??''].join('|');
  const admitted=new Map<string,ContextObservation>();
  for(const o of unique.values())if(o.family!=='FII_DII')admitted.set(seriesKey(o)+'|'+o.bucketAt,o);
  const measuredCell=(o:ContextObservation):ContextCell=>{
    const c=cell(o);
    // A supplied percentage is not proof of an admitted adjacent baseline.
    // Recompute from qualified observations; never let caller-provided arrows
    // bypass missing-data, contract or PCR source-continuity gates.
    if(!['LTP','OI','OI PCR'].includes(o.metric))return c;
    const t=utc(o.bucketAt);
    if(t===null)return c;
    const before=admitted.get(seriesKey(o)+'|'+new Date(t-180000).toISOString());
    // Expiry-matched PCR is still not comparable when the full-chain
    // source scope/provenance has switched across samples.
    if(o.family==='PCR_OI'&&before?.provenance!==o.provenance)return c;
    const baseline=n(before?.value),current=n(o.value);
    if(baseline!==null&&baseline>0&&current!==null)
      c.changePct=Math.round((current/baseline-1)*1000000)/10000;
    return c;
  };
  const lanes:ContextLane[]=offsets.filter(x=>input.includeOutcomes||x<=0).map(offset=>{
    const target=new Date(at+offset*60000).toISOString();
    const cells=[...unique.values()].filter(o=>o.family!=='FII_DII'&&o.bucketAt===target)
      .map(measuredCell).sort((a,b)=>a.family.localeCompare(b.family)||a.entity.localeCompare(b.entity)||a.metric.localeCompare(b.metric));
    return {phase:offset<0?'BEFORE' as const:offset===0?'EVENT' as const:'AFTER' as const,
      offsetMinutes:offset,timeIst:ist(at+offset*60000),cells};
  });
  // Only pre-event official publications. An EOD FII/DII report published
  // after a morning event cannot be used to explain what was known beforehand.
  const publications=[...unique.entries()].filter(([k])=>k.startsWith('PUBLISHED|'))
    .map(([,o])=>o).sort((a,b)=>(b.sessionDate??'').localeCompare(a.sessionDate??''));
  const latestPerEntityMetric=new Set<string>();
  const institutionalContext=publications.filter(o=>{
    const k=o.entity+'|'+o.metric;if(latestPerEntityMetric.has(k))return false;
    latestPerEntityMetric.add(k);return true;
  }).map(o=>({...cell(o),sessionDate:o.sessionDate!,publishedAt:o.publishedAt!}));
  return {ok:true,status:blocked.length?'PARTIAL':unique.size===0?'NO_ACCEPTED_EVIDENCE':'RECORDED',mode:'READ_ONLY_EVENT_CONTEXT_LADDER_V1',
    event:input.event,asOf:input.asOf,lanes,institutionalContext,
    coverage:{accepted:[...unique.values()].filter(x=>x.family!=='FII_DII').length,
      institutional:institutionalContext.length,rejected,conflicts:blocked.length},
    blocked,safety:SAFETY,
    limitations:['Per-event, per-family facts only; no cross-event context mixing.',
      'After-event checkpoints are retrospective only; not decision-time inputs.',
      'FII/DII is previous-published official context, not an intraday stream.',
      'Weightage and contribution need separately verified provenance.',
      'Delta percentages are computed only from two qualified adjacent 3-minute same-metric/contract observations; missing baselines show a dash.',
      'EventKnownAt is an actual accepted receipt time; late-arriving records cannot enter event-time evidence.',
      'Late-arriving records cannot enter the event-time signature; outcomes remain separate.',
      'Upstream observation truth checks remain mandatory; no confidence, prediction or P&L.']};
}
