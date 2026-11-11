import type { DashboardLiveStore } from './dashboard-live-feed.js';
import type { DashboardPcrSampler } from './dashboard-pcr-sampler.js';

type WsAudit = ReturnType<DashboardLiveStore['auditOiBand']>;
type RestAudit = NonNullable<ReturnType<DashboardPcrSampler['readAudit']>>;
const istDate=(time:number)=>new Date(time+19_800_000).toISOString().slice(0,10);
const validTime=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;

/** Optional read-only REST OI evidence for a requested, exact 15-strike x CE/PE band.
 * This is NOT a replacement for WebSocket quotes, nor a qualified full-chain PCR.
 * Never fetches a broker quote, changes a cache, or populates a missing value with zero. */
export function deriveRestOiBandEvidence(ws:WsAudit|null,rest:RestAudit|null,now:number){
 if(!ws||ws.source!=='KITE_WEBSOCKET_FULL'||ws.rows.length!==30||ws.coverage.returned!==30||
   ws.anchorStrike===null||ws.state==='EDGE_BAND_INCOMPLETE'||ws.tradeDate!==istDate(now)||
   !Number.isFinite(now)||ws.scope!=='LISTED_ATM_PLUS_MINUS_7')return null;
 // At 09:15 the sampler may still be warming up: no pre-open, after-close,
 // or old WS audit is allowed to authorize an OI snapshot.
 const openAt=Date.parse(ws.tradeDate+'T09:15:00+05:30');
 const closeAt=Date.parse(ws.tradeDate+'T15:30:00+05:30');
 const wsCheckedAt=validTime(ws.checkedAt);
 if(now<openAt||now>=closeAt||!Number.isFinite(wsCheckedAt)||
   wsCheckedAt>now+5000||now-wsCheckedAt>5000)return null;
 const source='KITE_REST_FULL_EXPIRY_SNAPSHOT' as const;
 const legitimate=rest?.source===source&&rest.symbol===ws.symbol&&rest.expiry===ws.expiry&&
   rest.fetchState==='OK'&&['COMPLETE','INCOMPLETE'].includes(rest.freshnessState)&&
   rest.rows.length===rest.expected&&Number.isSafeInteger(rest.expected)&&rest.expected>=30;
 const checked=legitimate?validTime(rest!.checkedAt):NaN;
 const cycle=legitimate?validTime(rest!.cycleStartedAt):NaN;
 const cycleFresh=Number.isFinite(checked)&&checked<=now+5000&&now-checked>=0&&now-checked<=90_000&&
   Number.isFinite(cycle)&&cycle<=checked&&cycle<=now+5000&&istDate(cycle)===ws.tradeDate;
 const uniqueWsIds=new Set<string>(),uniqueWsTokens=new Set<number>(),uniqueStrikes=new Set<number>();
 let validWs=true,ceCount=0,peCount=0;
 for(const row of ws.rows){
  const id=row.strike+'|'+row.side;
  if(!Number.isFinite(row.strike)||row.strike<=0||!['CE','PE'].includes(row.side)||
   !Number.isSafeInteger(row.token)||(row.token??0)<=0||uniqueWsIds.has(id)||uniqueWsTokens.has(row.token!))validWs=false;
  uniqueWsIds.add(id);uniqueWsTokens.add(row.token!);uniqueStrikes.add(row.strike);
  if(row.side==='CE')ceCount++;else peCount++;
 }
 if(!validWs||uniqueWsIds.size!==30||uniqueWsTokens.size!==30||uniqueStrikes.size!==15||ceCount!==15||peCount!==15)return null;
 const restIds=new Map<string,RestAudit['rows']>();
 if(legitimate)for(const row of rest!.rows){
  const key=row.strike+'|'+row.side;
  const items=restIds.get(key)||[];items.push(row);restIds.set(key,items);
 }
 const open=Date.parse(ws.tradeDate+'T09:15:00+05:30');
 const rows=ws.rows.map(w=>{
  const candidates=restIds.get(w.strike+'|'+w.side)||[];
  const r=candidates.length===1?candidates[0]:null;
  const at=r?validTime(r.sourceAt):NaN;
  const good=Number.isFinite(at)&&at>=open&&istDate(at)===ws.tradeDate&&
   now-at>=-5000&&now-at<=30000;
  const reason=!legitimate?'NO_SAME_EXPIRY_REST_AUDIT':
   !cycleFresh?'REST_CYCLE_NOT_FRESH':
   candidates.length!==1?candidates.length?'DUPLICATE_REST_LEG':'MISSING_REST_LEG':
   r!.symbol!==ws.symbol||r!.expiry!==ws.expiry||r!.strike!==w.strike||r!.side!==w.side||
   r!.token!==w.token||r!.responseToken!==w.token?'REST_IDENTITY_MISMATCH':
   !Number.isSafeInteger(r!.oi)||(r!.oi??-1)<0?'INVALID_REST_OI':
   !good?'STALE_OR_WRONG_SESSION_REST_OI':'VERIFIED_REST_OI';
  const ok=reason==='VERIFIED_REST_OI';
  return {strike:w.strike,side:w.side,token:w.token,
   oi:ok?r!.oi:null,sourceAt:ok?r!.sourceAt:null,
   source:ok?source:null,reason,wsReason:w.reason};
 });
 const qualified=rows.filter(r=>r.reason==='VERIFIED_REST_OI');
 const sourceTimes=qualified.map(r=>validTime(r.sourceAt)),skew=sourceTimes.length?Math.max(...sourceTimes)-Math.min(...sourceTimes):null;
 const complete=qualified.length===30&&skew!==null&&skew<=30000;
 // Ranked walls are band-only snapshot observations: not a whole-expiry wall,
 // trading signal or migration claim. No ranking with partial/stale coverage.
 const bandWallRanks=complete?{
  scope:'EXACT_ATM_PLUS_MINUS_7_ONLY' as const,source,
  ce:rankSide('CE'),pe:rankSide('PE')
 }:null;
 function rankSide(side:'CE'|'PE'){
  const ranked=qualified.filter(r=>r.side===side&&r.oi!==null&&r.oi>0)
   .sort((a,b)=>b.oi!-a.oi!||a.strike-b.strike);
  return ranked.slice(0,3).map(r=>({
   rank:ranked.findIndex(q=>q.oi===r.oi)+1,
   strike:r.strike,oi:r.oi!,sourceAt:r.sourceAt!,
   tied:ranked.filter(q=>q.oi===r.oi).length>1
  }));
 }
 return {readOnly:true,source,observation:'QUALIFIED_REST_OI_SNAPSHOT_NOT_WEBSOCKET_TICK',
  symbol:ws.symbol,expiry:ws.expiry,anchorStrike:ws.anchorStrike,tradeDate:ws.tradeDate,
  checkedAt:cycleFresh?rest!.checkedAt:null,state:complete?'COMPLETE_BAND':'INCOMPLETE_BAND',
  coverage:{expected:30,verifiedRestOi:qualified.length,zeroOi:qualified.filter(r=>r.oi===0).length,
   complete,sourceSkewMs:skew},rows,bandWallRanks,
  fullPcr:null,createsOrders:false,affectsExecution:false,affectsSelector:false,affectsTelegram:false};
}
