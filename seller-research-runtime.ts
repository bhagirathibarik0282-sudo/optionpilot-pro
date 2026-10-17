import { createHash, randomUUID } from 'node:crypto';
import { resolveKiteAuthoritySession } from './kite-session-authority.js';
import { createSellerKiteBasketMarginReader, type SellerMarginRequest } from './seller-kite-basket-margin-reader.js';
import { readDashboardSellerContext } from './dashboard-live-runtime.js';
import { buildSellerResearchCard } from './seller-research-evidence-bridge-v1.js';
import { isIndianEquityMarketOpenAt } from './market-session-calendar.js';

export type SellerCardRequest = Omit<SellerMarginRequest,'snapshotId'> & {estimatedRoundTripCosts:number};
export type SellerViewer = {accessToken:string;userId:string};
const SAFE={role:'OPTION_SELLER',researchOnly:true,affectsSelector:false,affectsTelegram:false,affectsExecution:false,createsOrders:false,executionReady:false} as const;
const AGE=5000,SKEW=1000;
const fail=(reason:string,source='KITE_LIVE_RESEARCH')=>({status:'BLOCKED' as const,blockers:[reason],source,...SAFE});
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
export function parseSellerCardRequest(input:unknown):SellerCardRequest|null{
 if(!record(input)||typeof input.symbol!=='string'||!['NIFTY','SENSEX'].includes(input.symbol)||typeof input.product!=='string'||!['NRML','MIS'].includes(input.product)||
  ![input.shortToken,input.longToken,input.quantity].every(x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0)||
  input.shortToken===input.longToken||typeof input.estimatedRoundTripCosts!=='number'||!Number.isFinite(input.estimatedRoundTripCosts)||input.estimatedRoundTripCosts<0)return null;
 return {symbol:input.symbol as SellerCardRequest['symbol'],product:input.product as SellerCardRequest['product'],
  shortToken:Number(input.shortToken),longToken:Number(input.longToken),quantity:Number(input.quantity),estimatedRoundTripCosts:input.estimatedRoundTripCosts};
}
const defaultMargin=createSellerKiteBasketMarginReader();
interface Dependencies {
 now:()=>number; marketOpen:(at:Date)=>boolean; authority:typeof resolveKiteAuthoritySession;
 context:typeof readDashboardSellerContext; margin:typeof defaultMargin;
 funds:(session:SellerViewer)=>Promise<number|null>;
}
async function readCapital(session:SellerViewer):Promise<number|null>{
 const key=process.env.KITE_API_KEY?.trim();if(!key)return null;
 const response=await fetch('https://api.kite.trade/user/margins/equity',{headers:{'X-Kite-Version':'3',Authorization:`token ${key}:${session.accessToken}`},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)return null;const body=await response.json() as any;
 return body?.status==='success'&&body.data?.enabled===true&&typeof body.data.net==='number'&&Number.isFinite(body.data.net)&&body.data.net>=0?body.data.net:null;
}
/** One submitted pair only. No candidate ranking, broker orders or periodic broker polling. */
export function createSellerResearchRunner(overrides:Partial<Dependencies>={}){
 const testOnly=Object.keys(overrides).length>0,source=testOnly?'TEST_ONLY':'KITE_LIVE_RESEARCH';
 const deps:Dependencies={now:Date.now,marketOpen:isIndianEquityMarketOpenAt,authority:resolveKiteAuthoritySession,
  context:readDashboardSellerContext,margin:defaultMargin,funds:readCapital,...overrides};
 return async(viewer:SellerViewer,input:unknown)=>{
  const request=parseSellerCardRequest(input);if(!request)return fail('SELLER_REQUEST_INVALID',source);
  try{
   const started=deps.now();if(!deps.marketOpen(new Date(started)))return fail('MARKET_CLOSED',source);
   const auth=await deps.authority(started),session=auth.session;
   if(!auth.status.active||!session||session.accessToken!==viewer.accessToken||session.userId!==viewer.userId||session.expiresAt<=started)return fail('KITE_ACCOUNT_SESSION_MISMATCH',source);
   const context=()=>deps.context(request.shortToken,request.longToken,request.quantity);
   const validate=(ctx:ReturnType<typeof context>,now:number):string|null=>{
    if(!ctx.connected||ctx.sessionToken!==session.accessToken||!ctx.runtimeId)return 'LIVE_FEED_SESSION_MISMATCH';
    if(!ctx.short||!ctx.long)return 'EXACT_TWO_LEG_DEPTH_MISSING';
    const s=ctx.short,l=ctx.long;
    if(s.entry.token!==request.shortToken||l.entry.token!==request.longToken||
     [s,l].some(x=>x.entry.symbol!==request.symbol||x.depth.symbol!==request.symbol||
      x.entry.role!=='OPTION'||!Number.isSafeInteger(x.entry.lotSize)||Number(x.entry.lotSize)<=0||request.quantity%Number(x.entry.lotSize)!==0)||
     s.entry.lotSize!==l.entry.lotSize||s.entry.expiry!==l.entry.expiry||s.entry.side!==l.entry.side||
     (s.entry.side==='CE'?Number(l.entry.strike)<=Number(s.entry.strike):Number(l.entry.strike)>=Number(s.entry.strike)))return 'SELLER_PAIR_IDENTITY_MISMATCH';
    const times=[s.depth,l.depth].map(x=>[Date.parse(x.observedAt),Date.parse(x.receivedAt)]);
    if(times.some(([o,r])=>!Number.isFinite(o)||!Number.isFinite(r)||o>r||r>now||now-o>AGE||now-r>AGE))return 'SELLER_DEPTH_STALE_OR_FUTURE';
    if(Math.abs(times[0][0]-times[1][0])>SKEW||Math.abs(times[0][1]-times[1][1])>SKEW)return 'SELLER_LEG_TIME_SKEW';
    if(s.depth.bidQty<request.quantity||l.depth.askQty<request.quantity)return 'SELLER_DEPTH_QUANTITY_INSUFFICIENT';
    return null;
   };
   const before=context(),pre=validate(before,started);if(pre)return fail(pre,source);
   const snapshotId=randomUUID();
   const margin=await deps.margin({...request,snapshotId});
   if(margin.status!=='PARTIAL')return fail(margin.blockers[0]||'BROKER_MARGIN_UNAVAILABLE',source);
   if(!testOnly&&(margin.source!=='KITE_HTTPS'||!margin.brokerProvenanceVerified))return fail('BROKER_MARGIN_NOT_AUTHENTICATED',source);
   const accountBinding=createHash('sha256').update(JSON.stringify([session.userId,session.sessionIdFingerprint])).digest('hex');
   if(margin.accountBinding!==accountBinding||margin.snapshotId!==snapshotId)return fail('MARGIN_ACCOUNT_OR_SNAPSHOT_MISMATCH',source);
   const capital=await deps.funds(viewer);
   let now=deps.now(),after=context();const post=validate(after,now);
   if(!deps.marketOpen(new Date(now)))return fail('MARKET_CLOSED',source);
   if(after.runtimeId!==before.runtimeId)return fail('LIVE_FEED_RESTARTED',source);
   if(post)return fail(post,source);
   const current=await deps.authority(now);
   if(!current.status.active||!current.session||current.session.accessToken!==session.accessToken||current.session.userId!==session.userId||current.session.sessionIdFingerprint!==session.sessionIdFingerprint||current.session.expiresAt<=now)return fail('KITE_SESSION_CHANGED',source);
   now=deps.now();after=context();
   const finalDepth=validate(after,now);if(finalDepth)return fail(finalDepth,source);
   if(after.runtimeId!==before.runtimeId)return fail('LIVE_FEED_RESTARTED',source);
   if(!deps.marketOpen(new Date(now))||current.session.expiresAt<=now)return fail('MARKET_OR_SESSION_EXPIRED',source);
   if(now<started||now<margin.checkedAtMs||now<margin.receivedAtMs||now-margin.requestedAtMs>10000)return fail('MARGIN_RESPONSE_STALE',source);
   const s=after.short!,l=after.long!;
   const match=(a:typeof margin.shortLeg,b:typeof s,side:string)=>a.instrumentToken===b.entry.token&&a.tradingSymbol===b.entry.label&&a.exchange===b.entry.exchange&&a.expiry===b.entry.expiry&&a.strike===b.entry.strike&&a.optionType===b.entry.side&&a.transactionType===side&&a.quantity===request.quantity;
   if(!match(margin.shortLeg,s,'SELL')||!match(margin.longLeg,l,'BUY')||margin.basket.some(x=>x.product!==request.product||x.quantity!==request.quantity))return fail('MARGIN_EXACT_PAIR_MISMATCH',source);
   if(capital===null||!Number.isFinite(capital)||capital<0)return fail('BROKER_AVAILABLE_CAPITAL_MISSING',source);
   const shortId=`${s.entry.exchange}:${s.entry.label}:${s.entry.token}`,longId=`${l.entry.exchange}:${l.entry.label}:${l.entry.token}`;
   const card=buildSellerResearchCard({source:'LIVE',snapshotId,shortContractId:shortId,longContractId:longId,
    shortExpiry:s.depth.expiryDate,longExpiry:l.depth.expiryDate,shortQuoteSnapshotId:snapshotId,longQuoteSnapshotId:snapshotId,
    shortQuoteContractId:shortId,longQuoteContractId:longId,quoteSource:'BROKER_BID_ASK',marginSnapshotId:snapshotId,marginSource:'BROKER_MARGIN',maxLegSkewMs:SKEW,
    quote:{symbol:request.symbol,expiry:s.depth.expiryDate,side:s.depth.side,shortStrike:s.depth.strike,longStrike:l.depth.strike,
     shortBid:s.depth.bid,longAsk:l.depth.ask,lotSize:s.entry.lotSize!,lots:request.quantity/s.entry.lotSize!,
     shortObservedAtMs:Date.parse(s.depth.observedAt),longObservedAtMs:Date.parse(l.depth.observedAt),asOfMs:now,maxQuoteAgeMs:AGE,
     estimatedRoundTripCosts:request.estimatedRoundTripCosts,availableCapital:capital,brokerMarginRequired:margin.conservativeMargin}});
   if(card.status==='BLOCKED')return {...fail(card.blockers[0],source),blockers:card.blockers};
   return {status:'PARTIAL' as const,source,...SAFE,card,asOfMs:now,
    validUntilMs:Math.min(Date.parse(s.depth.observedAt)+AGE,Date.parse(l.depth.observedAt)+AGE,
     Date.parse(s.depth.receivedAt)+AGE,Date.parse(l.depth.receivedAt)+AGE,margin.requestedAtMs+10000,session.expiresAt),
    pair:{symbol:request.symbol,product:request.product,quantity:request.quantity,short:s.entry,long:l.entry},
    quotes:{shortBid:s.depth.bid,longAsk:l.depth.ask,shortBidQty:s.depth.bidQty,longAskQty:l.depth.askQty,
     shortObservedAt:s.depth.observedAt,longObservedAt:l.depth.observedAt},
    margin:{initial:margin.initialMargin,final:margin.finalMargin,conservative:margin.conservativeMargin,receivedAtMs:margin.receivedAtMs},
    availableCapital:capital,estimatedRoundTripCosts:request.estimatedRoundTripCosts,
    proof:{localRequestId:margin.localRequestId,requestBinding:margin.requestBinding,responseBinding:margin.responseBinding}};
  }catch{return fail('SELLER_RESEARCH_UNAVAILABLE',source);}
 };
}
