import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { readDashboardLiveSnapshot, dashboardLiveRevision } from './dashboard-live-runtime.js';
import { LIVE_INDICES, type LiveIndex } from './dashboard-live-feed.js';

export const DASHBOARD_LIVE_FLUSH_MS=100;
export function mountDashboardLiveRoutes(app:Hono,read=readDashboardLiveSnapshot,revision=dashboardLiveRevision){
 let clients=0;
 const parse=(query:Record<string,string>)=>{
  const selection:Partial<Record<LiveIndex,{expiry?:string;strike?:number}>>={};
  for(const symbol of LIVE_INDICES){const expiry=query[symbol+'_expiry'],strike=query[symbol+'_strike'];
   if(expiry&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry))throw Error('INVALID_EXPIRY');
   if(strike&&(!/^\d+(?:\.\d+)?$/.test(strike)||!Number.isFinite(Number(strike))||Number(strike)<=0))throw Error('INVALID_STRIKE');
   selection[symbol]={...(expiry?{expiry}:{}),...(strike?{strike:Number(strike)}:{})};
  }return selection;
 };
 app.get('/dashboard-live',c=>{c.header('Cache-Control','no-store');try{return c.json(read(parse(c.req.query())));}catch{return c.json({ok:false,reason:'INVALID_LIVE_SELECTION'},400);}});
 app.get('/dashboard-live/stream',c=>{
  let selection;try{selection=parse(c.req.query());}catch{return c.json({ok:false,reason:'INVALID_LIVE_SELECTION'},400);}
  if(clients>=8)return c.json({ok:false,reason:'LIVE_VIEWER_LIMIT'},429);
  clients++;c.header('Cache-Control','no-store, no-transform');c.header('X-Accel-Buffering','no');
  return streamSSE(c,async stream=>{let closed=false;stream.onAbort(()=>{closed=true;});
   try{const deadline=Date.now()+15*60000;let previous:string|null=null,lastSent=0;while(!closed&&Date.now()<deadline){const current=revision(),now=Date.now();if(current!==previous||now-lastSent>=1000){const payload=JSON.stringify(read(selection));await stream.writeSSE({event:'snapshot',data:payload,retry:2000});previous=current;lastSent=Date.now();}await stream.sleep(DASHBOARD_LIVE_FLUSH_MS);}}
   finally{clients--;}
  });
 });
}
