/**
 * BANKNIFTY SHADOW historical paper event evidence, never broker execution.
 * Bounded, parameterized SELECT-only reader. It does not contact Telegram or
 * expose broker credentials, account scope, tokens, or raw snapshot payloads.
 *
 * SECURITY: The HTTP handler MUST require an admin Bearer token before calling.
 */
import {dbIsConfigured,dbQuerySafe} from './db.js';

type Query=(sql:string,params?:unknown[])=>Promise<{rows:any[]}|null>;
type Row={occurred_at:unknown;event_id:unknown;intent_id:unknown;kind:unknown;payload:unknown};
const MODE='BNF_SHADOW_TIMELINE_READ_ONLY_V1' as const;
const clean=(v:unknown):Record<string,any>|null=>{
 try{const x=typeof v==='string'?JSON.parse(v):v;return x&&typeof x==='object'&&!Array.isArray(x)?x:null;}
 catch{return null;}
};
const fin=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const qty=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const isoIst=(v:unknown,date:string):v is string=>typeof v==='string'&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+05:30$/.test(v)&&v.startsWith(date)&&Number.isFinite(Date.parse(v));
export const validBnfTimelineDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const base=(date:string)=>({mode:MODE,date,source:'DURABLE_SHADOW_PAPER_JOURNAL' as const,
 brokerOrders:0 as const,actualBrokerFills:false as const,telegramDeliveryVerified:false as const,rawTickReplayAvailable:false as const});
const blocked=(date:string,reason:string)=>({...base(date),ok:false,reason,trades:[],counts:null,dailyEstimatedNetInr:null,reconciliation:'NOT_VERIFIED' as const});

export function summarizeBnfShadowTimeline(
 date:string,
 scopePayload:unknown,
 events:Row[]
){
 if(!validBnfTimelineDate(date))return blocked(String(date),'INVALID_DATE');
 const snapshot=clean(scopePayload);
 if(!snapshot||!Array.isArray(events)||events.length>500)return blocked(date,'JOURNAL_INVALID_OR_TRUNCATED');
 const day=clean(clean(snapshot.days)?.[date]);
 const dailyEstimatedNetInr=fin(day?.realized_estimated)?round(day.realized_estimated):null;
 const groups=new Map<string,{id:string;events:any[];identity:string;contract:any;last:any;signalAccepted:boolean;entryCount:number;exitCount:number;prevEntryQty:number;prevEntryNotional:number;prevExitQty:number;prevExitNotional:number;issues:string[]}>();
 const kindCounts={accepted:0,entryFills:0,exitFills:0,exitRequests:0,restartRecovery:0};
 const order=[...events].sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at))||String(a.event_id).localeCompare(String(b.event_id)));
 for(const row of order){
  if(!isoIst(row.occurred_at,date)||typeof row.event_id!=='string'||!row.event_id||typeof row.intent_id!=='string'||!row.intent_id||
    typeof row.kind!=='string')return blocked(date,'JOURNAL_EVENT_IDENTITY_OR_IST_INVALID');
  const payload=clean(row.payload),trade=clean(payload?.trade),contract=clean(trade?.contract);
  if(!payload||!trade||payload.intent_id!==row.intent_id||!contract||trade.mode!=='SHADOW'||
    contract.symbol!=='BANKNIFTY'||contract.exchange!=='NFO'||!['CE','PE'].includes(contract.option_type)||
    !fin(contract.strike)||contract.strike<=0||!validBnfTimelineDate(contract.expiry_date)||
    typeof contract.tradingsymbol!=='string'||contract.tradingsymbol.length>80||
    !qty(contract.contract_lot_size)||contract.contract_lot_size<=0||
    !qty(trade.requested_qty)||trade.requested_qty<=0||trade.requested_qty%contract.contract_lot_size!==0||
    !qty(trade.filled_qty)||!qty(trade.exited_qty)||trade.exited_qty>trade.filled_qty||
    trade.filled_qty>trade.requested_qty||!fin(trade.entry_notional)||!fin(trade.exit_notional)||
    trade.entry_notional<0||trade.exit_notional<0)return blocked(date,'UNTRUSTED_SHADOW_EVENT_PAYLOAD');
  const identity=contract.tradingsymbol+'|'+contract.expiry_date+'|'+contract.strike+'|'+contract.option_type+'|'+trade.requested_qty;
  let g=groups.get(row.intent_id);
  if(!g){g={id:row.intent_id,events:[],identity,contract,last:trade,signalAccepted:false,entryCount:0,exitCount:0,
   prevEntryQty:0,prevEntryNotional:0,prevExitQty:0,prevExitNotional:0,issues:[]};groups.set(row.intent_id,g);}
  if(identity!==g.identity)return blocked(date,'CONTRACT_CHANGED_WITHIN_INTENT');
  const details=clean(payload.details)||{};
  const event:any={atIst:row.occurred_at,kind:row.kind,
   state:typeof trade.state==='string'?trade.state:'UNKNOWN',
   reason:typeof trade.reason==='string'?trade.reason.slice(0,55):null,
   exchangeQuoteIst:typeof trade.last_quote_ts==='string'?trade.last_quote_ts:null,
   receiveQuoteIst:typeof trade.last_receive_ts==='string'?trade.last_receive_ts:null,
   qty:null,price:null,priceRole:null,paperOnly:true};
  if(row.kind==='ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED'){
   if(g.signalAccepted)return blocked(date,'DUPLICATE_ACCEPTED_INTENT');
   g.signalAccepted=true;kindCounts.accepted++;
  }
  if(row.kind==='ENTRY_FILL'){
   kindCounts.entryFills++;g.entryCount++;
   const deltaQty=trade.filled_qty-g.prevEntryQty;
   const deltaValue=trade.entry_notional-g.prevEntryNotional;
   if(!qty(deltaQty)||deltaQty===0||deltaQty%contract.contract_lot_size!==0||!fin(deltaValue)||deltaValue<=0)
    return blocked(date,'ENTRY_NOTIONAL_DELTA_INVALID');
   event.qty=deltaQty;event.price=round(deltaValue/deltaQty);event.priceRole='SIMULATED_ASK';
  }
  if(row.kind==='EXIT_FILL'){
   kindCounts.exitFills++;g.exitCount++;
   const deltaQty=trade.exited_qty-g.prevExitQty;
   const deltaValue=trade.exit_notional-g.prevExitNotional;
   if(!qty(deltaQty)||deltaQty===0||deltaQty%contract.contract_lot_size!==0||!fin(deltaValue)||deltaValue<=0||
      !qty(details.qty)||details.qty!==deltaQty||!fin(details.price)||
      Math.abs(details.price*deltaQty-deltaValue)>0.011)return blocked(date,'EXIT_BID_RECEIPT_MISMATCH');
   event.qty=deltaQty;event.price=details.price;event.priceRole='SIMULATED_BID';
  }
  if(row.kind==='EXIT_REQUESTED'||row.kind==='RECOVERY_EXIT_REQUESTED')kindCounts.exitRequests++;
  if(row.kind==='RESTART_RECOVERY')kindCounts.restartRecovery++;
  if(trade.filled_qty<g.prevEntryQty||trade.entry_notional+0.011<g.prevEntryNotional||
     trade.exited_qty<g.prevExitQty||trade.exit_notional+0.011<g.prevExitNotional)
   return blocked(date,'NON_MONOTONIC_PAPER_FILL_STATE');
  g.prevEntryQty=trade.filled_qty;g.prevEntryNotional=trade.entry_notional;
  g.prevExitQty=trade.exited_qty;g.prevExitNotional=trade.exit_notional;
  g.last=trade;g.events.push(event);
 }
 const trades=[...groups.values()].map((g,i)=>{
  const t=g.last;
  if(!g.signalAccepted)g.issues.push('ACCEPTED_SIGNAL_NOT_IN_SELECTED_DAY');
  if(g.entryCount&&g.exitCount&&!g.signalAccepted)g.issues.push('INCOMPLETE_INTENT_CHAIN');
  const fullClose=t.state==='CLOSED'&&t.filled_qty===t.exited_qty&&g.entryCount>0&&g.exitCount>0;
  if(t.filled_qty>t.exited_qty)g.issues.push('OPEN_OR_UNRESOLVED_PAPER_EXPOSURE');
  const completedNet=fullClose&&fin(t.net_pnl_inr_estimated)?round(t.net_pnl_inr_estimated):null;
  const computedNet=fullClose&&fin(t.estimated_cost_inr)?round(t.exit_notional-t.entry_notional-t.estimated_cost_inr):null;
  const tradeArithmeticOk=computedNet!==null&&completedNet!==null&&Math.abs(computedNet-completedNet)<=0.011;
  if(fullClose&&!tradeArithmeticOk)g.issues.push('TRADE_PNL_ARITHMETIC_NOT_RECONCILED');
  if(!fullClose)g.issues.push('TRADE_NOT_FULLY_CLOSED_ON_SELECTED_DAY');
  return {number:i+1,intentId:g.id,signalId:typeof t.signal_id==='string'?t.signal_id:null,
   side:g.contract.option_type,strike:g.contract.strike,expiry:g.contract.expiry_date,
   tradingsymbol:g.contract.tradingsymbol,lots:t.requested_qty/g.contract.contract_lot_size,
   requestedQty:t.requested_qty,filledQty:t.filled_qty,exitedQty:t.exited_qty,
   signalIst:typeof t.signal_ts==='string'?t.signal_ts:null,
   intentIst:g.events.find(e=>e.kind==='ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED')?.atIst??null,
   entryIst:typeof t.entry_ts==='string'?t.entry_ts:null,
   exitRequestedIst:typeof t.exit_requested_ts==='string'?t.exit_requested_ts:null,
   closedIst:typeof t.closed_at==='string'?t.closed_at:null,
   lastReason:typeof t.reason==='string'?t.reason:null,
   entryNotionalInr:round(t.entry_notional),exitNotionalInr:round(t.exit_notional),
   modeledNetInr:completedNet,estimatedCostInr:fin(t.estimated_cost_inr)?t.estimated_cost_inr:null,
   paperReconciled:fullClose&&tradeArithmeticOk&&g.signalAccepted,
   events:g.events,issues:g.issues};
 });
 const computed=trades.every(t=>t.paperReconciled)?round(trades.reduce((n,t)=>n+(t.modeledNetInr??0),0)):null;
 const reconciled=computed!==null&&dailyEstimatedNetInr!==null&&Math.abs(computed-dailyEstimatedNetInr)<=0.011;
 return {...base(date),ok:true,reason:trades.length?'PAPER_EVENTS_FOUND':'NO_PAPER_EVENTS_ON_DATE',
  counts:{intents:kindCounts.accepted,entryFills:kindCounts.entryFills,exitFills:kindCounts.exitFills,
   exitRequests:kindCounts.exitRequests,restartRecovery:kindCounts.restartRecovery,uniqueIntents:groups.size},
  trades,dailyEstimatedNetInr,sumClosedModeledNetInr:computed,
  reconciliation:reconciled?'MATCHES_DURABLE_DAILY_ESTIMATE':'NOT_VERIFIED',
  telegram:'NOT_LINKED_TO_JOURNAL'};
}

export async function readBnfShadowTimeline(date:string,query:Query=dbQuerySafe){
 if(!validBnfTimelineDate(date))return blocked(String(date),'INVALID_DATE');
 if(query===dbQuerySafe&&!dbIsConfigured())return blocked(date,'DATABASE_NOT_CONFIGURED');
 const scopes=await query("SELECT scope,payload FROM bnf_shadow_scope_v1 WHERE scope ~ '^BNF_V1:[^:]+:SHADOW$' ORDER BY scope LIMIT 2");
 if(!scopes)return blocked(date,'SHADOW_JOURNAL_UNAVAILABLE');
 if(scopes.rows.length!==1)return blocked(date,scopes.rows.length?'AMBIGUOUS_ACCOUNT_SCOPE':'NO_SHADOW_ACCOUNT_SCOPE');
 const scope=scopes.rows[0].scope;
 if(typeof scope!=='string')return blocked(date,'SHADOW_SCOPE_INVALID');
 const rows=await query('SELECT occurred_at,event_id,intent_id,kind,payload FROM bnf_shadow_event_v1 WHERE scope=$1 AND left(occurred_at,10)=$2 ORDER BY occurred_at ASC,event_id ASC LIMIT 501',[scope,date]);
 if(!rows)return blocked(date,'SHADOW_EVENTS_UNAVAILABLE');
 if(rows.rows.length>500)return blocked(date,'JOURNAL_DAY_EVENT_CAP_REACHED');
 return summarizeBnfShadowTimeline(date,scopes.rows[0].payload,rows.rows);
}
