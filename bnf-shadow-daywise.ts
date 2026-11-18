/** Read-only 1/2/4/6-lot report from the existing SHADOW paper journal.
 * No inferred fills, no lot scaling, no new broker or database writes.
 */
import { dbIsConfigured, dbQuerySafe } from './db.js';

export const BNF_SHADOW_COMPARISON_LOTS = [1, 2, 4, 6] as const;
export type BnfLot = typeof BNF_SHADOW_COMPARISON_LOTS[number];
type Query = (sql:string, params?:unknown[])=>Promise<{rows:any[]}|null>;
type JournalEvent = {occurred_at:unknown; kind:unknown; intent_id?:unknown; payload:unknown};
type Slot = {lots:BnfLot; verdict:'PAPER_JOURNAL'|'NOT_SIMULATED'; intents:number|null; entryFills:number|null; exitFills:number|null; closedTrades:number|null; estimatedNetPnlInr:number|null; stopLosses:number|null};
export type BnfDaywiseReport = {ok:boolean; mode:'BNF_SHADOW_DAYWISE_READ_ONLY_V1'; source:'DURABLE_PAPER_JOURNAL'; lots:readonly BnfLot[]; days:Array<{date:string; scenarios:Slot[]}>; reason:string; estimatedOnly:true; brokerOrders:0; fillsNotScaled:true};

const base = {mode:'BNF_SHADOW_DAYWISE_READ_ONLY_V1' as const,source:'DURABLE_PAPER_JOURNAL' as const,lots:BNF_SHADOW_COMPARISON_LOTS,estimatedOnly:true as const,brokerOrders:0 as const,fillsNotScaled:true as const};
const blocked=(reason:string):BnfDaywiseReport=>({...base,ok:false,days:[],reason});
const object=(v:unknown):Record<string,any>|null=>{
 try{const x=typeof v==='string'?JSON.parse(v):v;return x!==null&&typeof x==='object'&&!Array.isArray(x)?x:null;}
 catch{return null;}
};
const nonNegative=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*100)/100:null;
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.slice(0,10))&&Number.isFinite(Date.parse(v))?v.slice(0,10):null;

/** Every lot column requires its own actual journal receipts. No 2-lot P&L multiplication. */
export function summarizeBnfShadowDaywise(scopePayload:unknown,events:JournalEvent[]):BnfDaywiseReport{
 const snapshot=object(scopePayload);
 if(!snapshot||!Array.isArray(events))return blocked('JOURNAL_SNAPSHOT_INVALID');
 const buckets=new Map<string,Map<BnfLot,{intents:Set<string>;entryFills:number;exitFills:number;closed:Set<string>;}>>();
 for(const event of events){
  const day=date(event.occurred_at),payload=object(event.payload);
  if(!day||!payload||typeof event.kind!=='string')return blocked('JOURNAL_EVENT_INVALID');
  const trade=object(payload.trade),contract=object(trade?.contract);
  const requested=trade?.requested_qty,size=contract?.contract_lot_size;
  if(!Number.isSafeInteger(requested)||!Number.isSafeInteger(size)||size<=0||requested<=0||requested%size!==0)return blocked('JOURNAL_CONTRACT_QUANTITY_UNVERIFIED');
  const lots=requested/size;
  if(!BNF_SHADOW_COMPARISON_LOTS.includes(lots as BnfLot))return blocked('JOURNAL_LOTS_UNSUPPORTED');
  const id=typeof event.intent_id==='string'?event.intent_id:payload.intent_id;
  if(typeof id!=='string'||!id)return blocked('JOURNAL_INTENT_ID_MISSING');
  let group=buckets.get(day);
  if(!group){group=new Map();buckets.set(day,group);}
  const l=lots as BnfLot;
  let stats=group.get(l);
  if(!stats){stats={intents:new Set(),entryFills:0,exitFills:0,closed:new Set()};group.set(l,stats);}
  if(event.kind==='ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED')stats.intents.add(id);
  if(event.kind==='ENTRY_FILL')stats.entryFills++;
  if(event.kind==='EXIT_FILL'){
   stats.exitFills++;
   if(trade?.state==='CLOSED')stats.closed.add(id);
  }
 }
 const savedDays=object(snapshot.days)||{};
 const rows=[...buckets.keys()].sort().reverse().slice(0,5).map(day=>{
  const group=buckets.get(day)!;
  const summaries=BNF_SHADOW_COMPARISON_LOTS.map(lots=>{
   const stats=group.get(lots);
   if(!stats)return {lots,verdict:'NOT_SIMULATED' as const,intents:null,entryFills:null,exitFills:null,closedTrades:null,estimatedNetPnlInr:null,stopLosses:null};
   const saved=object(savedDays[day]);
   return {lots,verdict:'PAPER_JOURNAL' as const,intents:stats.intents.size,entryFills:stats.entryFills,exitFills:stats.exitFills,closedTrades:stats.closed.size,
    estimatedNetPnlInr:stats.exitFills>0?money(saved?.realized_estimated):null,stopLosses:nonNegative(saved?.sl_count)};
  });
  return {date:day,scenarios:summaries};
 });
 return {...base,ok:true,days:rows,reason:rows.length?'JOURNAL_EVENTS_ONLY':'NO_VERIFIED_SHADOW_JOURNAL_EVENTS'};
}

/** Bounded, parameterized SELECTs only; reject ambiguous account scopes and truncated journals. */
export async function readBnfShadowDaywise(query:Query=dbQuerySafe):Promise<BnfDaywiseReport>{
 if(query===dbQuerySafe&&!dbIsConfigured())return blocked('DATABASE_NOT_CONFIGURED');
 const scopes=await query("SELECT scope, payload FROM bnf_shadow_scope_v1 WHERE scope ~ '^BNF_V1:[^:]+:SHADOW$' ORDER BY scope LIMIT 2");
 if(!scopes)return blocked('SHADOW_JOURNAL_UNAVAILABLE');
 if(scopes.rows.length===0)return {...base,ok:true,days:[],reason:'NO_VERIFIED_SHADOW_JOURNAL_EVENTS'};
 if(scopes.rows.length!==1)return blocked('AMBIGUOUS_SHADOW_ACCOUNT_SCOPE');
 const scope=scopes.rows[0].scope;
 if(typeof scope!=='string')return blocked('SHADOW_SCOPE_INVALID');
 const result=await query('SELECT occurred_at, kind, intent_id, payload FROM bnf_shadow_event_v1 WHERE scope=$1 ORDER BY occurred_at DESC LIMIT 1001',[scope]);
 if(!result)return blocked('SHADOW_EVENTS_UNAVAILABLE');
 if(result.rows.length>1000)return blocked('JOURNAL_ROW_LIMIT_REACHED');
 return summarizeBnfShadowDaywise(scopes.rows[0].payload,result.rows);
}
