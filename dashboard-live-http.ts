import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { readDashboardLiveSnapshot, dashboardLiveRevision, readDashboardPremiumSnapshot } from './dashboard-live-runtime.js';
import { LIVE_INDICES, type LiveSelection, type PremiumWatchFilter } from './dashboard-live-feed.js';

export const DASHBOARD_LIVE_FLUSH_MS=100;
export function mountDashboardLiveRoutes(app:Hono,read=readDashboardLiveSnapshot,revision=dashboardLiveRevision){
 let clients=0;
 const parse=(query:Record<string,string>)=>{
  const selection:LiveSelection={};
  for(const symbol of LIVE_INDICES){const expiry=query[symbol+'_expiry'],strike=query[symbol+'_strike'];
   if(expiry&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry))throw Error('INVALID_EXPIRY');
   if(strike&&(!/^\d+(?:\.\d+)?$/.test(strike)||!Number.isFinite(Number(strike))||Number(strike)<=0))throw Error('INVALID_STRIKE');
   selection[symbol]={...(expiry?{expiry}:{}),...(strike?{strike:Number(strike)}:{})};
   for(const field of ['ceStrike','peStrike'] as const){const value=query[symbol+'_'+field];if(value!==undefined){if(!/^\d+(?:\.\d+)?$/.test(value)||!Number.isFinite(Number(value))||Number(value)<=0)throw Error('INVALID_STRIKE');selection[symbol]![field]=Number(value);}}
  }return selection;
 };

 app.get('/dashboard-live/premiums',c=>{
  c.header('Cache-Control','no-store');
  try{
   const q=c.req.query(),filter:PremiumWatchFilter={};
   if(q.view!==undefined){if(q.view!=='ladder')throw Error();filter.view='ladder';}
   if(q.modelDelta!==undefined){if(q.modelDelta!=='1'||filter.view!=='ladder')throw Error();filter.modelDelta=true;}
   if(q.nearby){if(!['1','2','3','7'].includes(q.nearby))throw Error();filter.nearby=Number(q.nearby);}
   if(q.symbol&&q.symbol!=='ALL'){if(!(LIVE_INDICES as readonly string[]).includes(q.symbol))throw Error();filter.symbol=q.symbol as LiveIndex;}
   if(q.side&&q.side!=='BOTH'){if(!['CE','PE'].includes(q.side))throw Error();filter.side=q.side as 'CE'|'PE';}
   if(q.expiries){const xs=q.expiries.split(',');if(xs.length>4||xs.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)))throw Error();filter.expiries=xs;}
   for(const key of ['ceStrike','peStrike','minDte','maxDte','offset','limit'] as const)if(q[key]!==undefined){const v=Number(q[key]);if(!/^\d+(?:\.\d+)?$/.test(q[key])||!Number.isFinite(v)||v<0||(['ceStrike','peStrike','limit'].includes(key)&&v===0)||(!['ceStrike','peStrike'].includes(key)&&!Number.isInteger(v)))throw Error();filter[key]=v;}
   if(filter.view==='ladder'&&(filter.offset||0)!==0)throw Error();
   if((filter.limit||0)>120||(filter.offset||0)>20000||(filter.maxDte!==undefined&&filter.minDte!==undefined&&filter.minDte>filter.maxDte))throw Error();
   return c.json(readDashboardPremiumSnapshot(filter));
  }catch{return c.json({ok:false,reason:'INVALID_PREMIUM_FILTER'},400);}
 });
 app.get('/dashboard-live',c=>{c.header('Cache-Control','no-store');try{return c.json(read(parse(c.req.query())));}catch{return c.json({ok:false,reason:'INVALID_LIVE_SELECTION'},400);}});
 app.get('/dashboard-live/stream',c=>{
  let selection;try{selection=parse(c.req.query());}catch{return c.json({ok:false,reason:'INVALID_LIVE_SELECTION'},400);}
  if(clients>=8)return c.json({ok:false,reason:'LIVE_VIEWER_LIMIT'},429);
  clients++;c.header('Cache-Control','no-store, no-transform');c.header('X-Accel-Buffering','no');
  return streamSSE(c,async stream=>{let closed=false;stream.onAbort(()=>{closed=true;});
   try{const deadline=Date.now()+15*60000,chainCycles=new Map<string,string>();let previous:string|null=null,lastSent=0;while(!closed&&Date.now()<deadline){const current=revision(),now=Date.now();if(current!==previous||now-lastSent>=1000){const data=read(selection);
    // Send exact chain rows once per OI cycle, not again on every price tick.
    // Clone the envelope: never mutate the sampler's shared immutable result.
    if(Array.isArray(data.snapshot?.indices))for(const index of data.snapshot!.indices){const q=(index as any).pcrSnapshot,key=index.symbol+'|'+index.expiry,cycle=q?.cycleStartedAt+'|'+q?.checkedAt;if(q?.state==='COMPLETE'&&Array.isArray(q.strikeRows)){if(chainCycles.get(key)===cycle)(index as any).pcrSnapshot={...q,strikeRows:undefined,strikeRowsUnchanged:true};else chainCycles.set(key,cycle);}else chainCycles.delete(key);}
    const payload=JSON.stringify(data);await stream.writeSSE({event:'snapshot',data:payload,retry:2000});previous=current;lastSent=Date.now();}await stream.sleep(DASHBOARD_LIVE_FLUSH_MS);}}
   finally{clients--;}
  });
 });
}
