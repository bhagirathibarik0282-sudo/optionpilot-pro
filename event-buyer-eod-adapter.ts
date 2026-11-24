/** Offline EOD adapter. No inferred truth, quote timestamps, chain linkage or fills.
 * An independently exported H1 replay response is optional. The raw EOD remains
 * immutable. Sidecar chain rows need explicit provenance for strict evaluation. */
export function adaptEventBuyerEod(eod:any,symbol:string,replay?:any){
 const date=eod?.tradingDate,stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(eod?.schemaVersion!=='EOD_ARCHIVE_V2'||!['NIFTY','SENSEX','BANKNIFTY'].includes(symbol)||!Number.isFinite(open)||!['marketSnapshots','optionSnapshots','chainStates','researchMemories'].every(k=>Array.isArray(eod[k])))throw Error('UNSUPPORTED_EOD_SCHEMA');
 const rows=(k:string)=>eod[k].filter((r:any)=>r.symbol===symbol&&stamp(r.minute_bucket)>=open&&stamp(r.minute_bucket)<=close);
 const market=rows('marketSnapshots'),options=rows('optionSnapshots'),chain=rows('chainStates');
 const events:any[]=[],responses:any[]=[],availability:any={events:{},responses:{}};
 const seen=new Set<string>(),duplicate=new Set<string>();
 for(const r of eod.researchMemories){
  const p=r?.payload;if(p?.tradeDate!==date||p.symbol!==symbol||r.kind!==p.version||!['INTRADAY_NOTABLE_EVENT_V1','INTRADAY_PREMIUM_RESPONSE_V1'].includes(r.kind)||typeof p.memoryKey!=='string')continue;
  const key=r.kind+'|'+p.memoryKey;if(seen.has(key)){duplicate.add(key);continue;}seen.add(key);
  const type=r.kind==='INTRADAY_NOTABLE_EVENT_V1'?'events':'responses';
  (type==='events'?events:responses).push(p);
  const t=stamp(r.created_at);availability[type][p.memoryKey]=Number.isFinite(t)?new Date(t).toISOString():null;
 }
 for(const p of events)if(duplicate.has(p.version+'|'+p.memoryKey))delete availability.events[p.memoryKey];
 for(const p of responses)if(duplicate.has(p.version+'|'+p.memoryKey))delete availability.responses[p.memoryKey];
 const memory={ok:true,tradeDate:date,events,responses,availability};
 const validReplay=replay?.ok===true&&replay.request?.symbol===symbol&&replay.request?.tradeDate===date&&['market','options','chain'].every(k=>Array.isArray(replay[k]));
 const key=(r:any,kind:string)=>[r.symbol,stamp(r.minute_bucket),...(kind==='market'?[]:kind==='options'?[r.expiry,r.strike,r.option_type]:[r.expiry])].join('|');
 const same=(a:any,b:any,fields:string[])=>fields.every(f=>['backend_timestamp','quote_timestamp'].includes(f)?Number.isFinite(stamp(a[f]))&&stamp(a[f])===stamp(b[f]):a[f]===b[f]);
 const match=(original:any[],kind:string,fields:string[])=>{
  const index=new Map<string,any[]>();for(const r of original){const k=key(r,kind),a=index.get(k)||[];a.push(r);index.set(k,a);}
  const refs=new Map<string,any[]>();if(validReplay)for(const r of replay[kind]){const k=key(r,kind),a=refs.get(k)||[];a.push(r);refs.set(k,a);}
  return original.map(r=>{const k=key(r,kind),a=index.get(k),b=refs.get(k),v=b?.[0];
   const verified=a?.length===1&&b?.length===1&&v.truth_verdict==='TRUE'&&same(r,v,fields);
   return {...r,truth_verdict:verified?'TRUE':'UNKNOWN',...(kind==='chain'?{full_pcr_source:verified&&typeof v.snapshot_id==='string'&&Number.isFinite(stamp(v.source_timestamp))&&['Exact archived full-chain source','Normalized full-chain source'].includes(v.full_pcr_source)?v.full_pcr_source:null,snapshot_id:verified?v.snapshot_id??null:null,source_timestamp:verified?v.source_timestamp??null:null}:{} )};
  });
 };
 const m=match(market,'market',['snapshot_id','backend_timestamp','spot_ltp','india_vix','calculation_version']);
 const o=match(options,'options',['snapshot_id','quote_timestamp','quote_age_seconds','ltp','pdh','pdl','oi','calculation_version']);
 const c=match(chain,'chain',['full_chain_oi_pcr','call_wall_strike','put_wall_strike','calculation_version']);
 const count=(rs:any[])=>rs.filter(r=>r.truth_verdict==='TRUE').length;
 const coverage={marketMinutes:new Set(market.map((r:any)=>stamp(r.minute_bucket))).size,marketRows:market.length,optionRows:options.length,chainRows:chain.length,savedEvents:events.length,savedResponses:responses.length,qualifiedMarketRows:count(m),qualifiedOptionRows:count(o),qualifiedChainRows:count(c),explicitChainProvenance:c.filter(r=>r.truth_verdict==='TRUE'&&r.full_pcr_source&&r.snapshot_id&&r.source_timestamp).length,duplicateMemoryKeys:duplicate.size};
 return {recorded:{ok:validReplay,request:{symbol,tradeDate:date},market:m,options:o,chain:c},memory,coverage,blockers:[...(!validReplay?['INDEPENDENT_H1_REPLAY_REQUIRED']:[]),...(!coverage.explicitChainProvenance?['CHAIN_SOURCE_LINKAGE_UNAVAILABLE']:[])]};
}
