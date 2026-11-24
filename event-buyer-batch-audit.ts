import {projectSharedEventMemory,buildSharedEventTimeline,buildSharedEventComparison} from './shared-event-memory-view.js';
import {evaluateEventBuyerHypothesis} from './event-buyer-hypothesis.js';
/** Offline read-only batch evaluator. One explicit preselected expiry pair per
 * index/date. Counts sampled outcomes, not fills or portfolio trades.
 * No reconstruction of missing minutes or retrospective event admission. */
export function auditEventBuyerSession(input:any){
 const date=input?.date,symbol=input?.symbol,expiries=input?.expiries,raw=input?.recorded,memory=input?.memory;
 const validDate=(x:any)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
 const valid=validDate(date)&&['NIFTY','SENSEX','BANKNIFTY'].includes(symbol)&&Array.isArray(expiries)&&expiries.length===2&&expiries.every((x:any)=>validDate(x)&&x>=date)&&expiries[0]<expiries[1];
 const out:any={date,symbol,expiries,status:'UNAVAILABLE',expectedMinutes:376,trueMarketMinutes:0,eligibleSavedEvents:0,excludedSavedEvents:null,results:[],netPnl:null,profitFactor:null,portfolioDrawdown:null,verifiedFills:0};
 if(!valid){out.reason='INVALID_PRESELECTED_EXPIRIES_OR_IDENTITY';return out;}
 if(raw?.ok!==true||raw.request?.symbol!==symbol||raw.request?.tradeDate!==date||!Array.isArray(raw.market)||!Array.isArray(raw.options)||!Array.isArray(raw.chain)||memory?.ok!==true||memory.tradeDate!==date||!memory.availability||!Array.isArray(memory.events)||!Array.isArray(memory.responses)){out.reason='RAW_REPLAY_OR_MEMORY_UNAVAILABLE';return out;}
 const open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 const rows=(values:any[])=>values.filter(r=>r?.symbol===symbol&&typeof r.minute_bucket==='string'&&Number.isFinite(Date.parse(r.minute_bucket))&&Date.parse(r.minute_bucket)>=open&&Date.parse(r.minute_bucket)<=close);
 const market=rows(raw.market),options=rows(raw.options),chain=rows(raw.chain);
 const buckets=new Map<number,any[]>();for(const r of market){const t=Date.parse(r.minute_bucket);if((t-open)%60000!==0)continue;const a=buckets.get(t)||[];a.push(r);buckets.set(t,a);}
 out.trueMarketMinutes=[...buckets.values()].filter(a=>a.length===1&&a[0].truth_verdict==='TRUE').length;
 out.status=out.trueMarketMinutes===376?'COMPLETE_MARKET_GRID_ONLY':'PARTIAL_MARKET_GRID';
 const state={date,replay:{active:true,at:new Date(close).toISOString()},current:{[symbol]:{market,options,chain}}};
 const admitted=projectSharedEventMemory(memory,date,state.replay.at,symbol).events.filter(e=>expiries.includes(e.expiry));
 const events=admitted.sort((a,b)=>Date.parse(memory.availability.events[a.memoryKey])-Date.parse(memory.availability.events[b.memoryKey])||a.memoryKey.localeCompare(b.memoryKey));
 out.eligibleSavedEvents=events.length;out.excludedSavedEvents=memory.events.filter((e:any)=>e.symbol===symbol).length-events.length;
 out.archiveReadLimit=memory.readLimitEvents??null;out.archiveMayBeTruncated=Number.isFinite(memory.readLimitEvents)&&memory.events.length>=memory.readLimitEvents;
 const seen=new Set<string>();
 for(const original of events){
  const key=[original.symbol,original.at,original.strike].join('|');if(seen.has(key))continue;seen.add(key);
  const known=memory.availability.events[original.memoryKey],event={...original,expiry:expiries[0]};
  // Expiry pair is supplied externally before outcome evaluation. Never pick
  // the better-performing expiry or substitute a nearby strike.
  const pairs=buildSharedEventComparison(state,event,known,null,expiries[1],buildSharedEventTimeline);
  for(const r of evaluateEventBuyerHypothesis(state,event,known,pairs,buildSharedEventTimeline)){
   const points=r.status==='OBSERVED_EXIT'&&r.entry&&r.exit?r.exit.price-r.entry.price:null;
   out.results.push({...r,eventKey:original.memoryKey,eventAt:original.at,eventStoredAt:known,sampledPremiumPoints:points,sampledR:points===null?null:points/r.riskPoints});
  }
 }
 out.counts={candidates:out.results.length,entries:out.results.filter((r:any)=>r.entry).length,closed:out.results.filter((r:any)=>r.status==='OBSERVED_EXIT').length,unverified:out.results.filter((r:any)=>r.status==='UNVERIFIED').length,noCandidate:out.results.filter((r:any)=>r.status==='NO_CANDIDATE').length};
 const closed=out.results.filter((r:any)=>typeof r.sampledPremiumPoints==='number');
 out.sampled={wins:closed.filter((r:any)=>r.sampledPremiumPoints>0).length,losses:closed.filter((r:any)=>r.sampledPremiumPoints<0).length,flat:closed.filter((r:any)=>r.sampledPremiumPoints===0).length,meanR:closed.length?closed.reduce((a:number,r:any)=>a+r.sampledR,0)/closed.length:null};
 out.limitations=['Observed independent event candidates; overlapping signals are not portfolio trades.','Three-minute archives cannot establish complete exact-minute entry/holding paths.','No verified fills or historical costs; net P&L, profit factor and portfolio drawdown withheld.','Explicit expiry selection required; source provenance and selection timing must be independently audited.'];
 return out;
}
