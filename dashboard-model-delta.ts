import { mapKiteFullPacketToH1ExactPriceGreek } from './h1-kite-exact-price-greek-adapter.js';
import { KiteImmediateTokenRegistry } from './kite-immediate-token-registry.js';
import type { LiveEntry } from './dashboard-live-feed.js';
import type { KiteDecodedPacket } from './kite-websocket-binary-decoder.js';

// Display-only assumptions explicitly approved for Model Delta, not broker Greeks.
export const DASHBOARD_DELTA_POLICY=Object.freeze({annualRiskFreeRate:.05,annualDividendYield:0,maxAgeMs:5000,maxUnderlyingSkewMs:2000});
export function deriveDashboardModelDelta(entry:LiveEntry,packet:KiteDecodedPacket,receivedAt:string,spotEntry:LiveEntry,spot:KiteDecodedPacket,spotReceivedAt:string,now:number){
 const policy=DASHBOARD_DELTA_POLICY,at=Date.parse(packet?.exchangeTimestamp||''),spotAt=Date.parse(spot?.exchangeTimestamp||'');
 if(entry?.role!=='OPTION'||!['NIFTY','SENSEX','BANKNIFTY'].includes(entry.symbol||'')||!['CE','PE'].includes(entry.side||'')||!Number.isInteger(entry.token)||entry.token<=0||!entry.label?.trim()||!Number.isFinite(entry.strike)||entry.strike!<=0||!entry.expiry||packet?.instrumentToken!==entry.token||spotEntry?.role!=='SPOT'||spotEntry.symbol!==entry.symbol||spot?.instrumentToken!==spotEntry.token||spot.mode!=='full'||!spot.isIndex||!Number.isFinite(spot.lastPrice)||spot.lastPrice<=0||!Number.isFinite(now))return null;
 if([at,spotAt,Date.parse(receivedAt),Date.parse(spotReceivedAt)].some(t=>!Number.isFinite(t)||now-t<0||now-t>policy.maxAgeMs))return null;
 const registry=new KiteImmediateTokenRegistry([{instrumentToken:entry.token,symbol:entry.symbol!,role:'OPTION',instrumentLabel:entry.label,expiry:entry.expiry,strike:entry.strike,optionSide:entry.side}]);
 const calculatedAt=new Date(now).toISOString();
 const result=mapKiteFullPacketToH1ExactPriceGreek(packet,registry,{source:'LIVE_RUNTIME_EXACT',symbol:entry.symbol!,observedAt:spot.exchangeTimestamp!,receivedAt:spotReceivedAt,price:spot.lastPrice},calculatedAt,policy);
 if(!result)return null;
 return {source:'BLACK_SCHOLES_MODEL',delta:result.delta,token:entry.token,symbol:entry.symbol,expiry:entry.expiry,strike:entry.strike,side:entry.side,premium:packet.lastPrice,premiumAt:packet.exchangeTimestamp,spot:spot.lastPrice,spotAt:spot.exchangeTimestamp,calculatedAt,annualRiskFreeRate:policy.annualRiskFreeRate,annualDividendYield:policy.annualDividendYield};
}
