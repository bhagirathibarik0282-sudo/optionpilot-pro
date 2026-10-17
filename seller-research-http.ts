import type { Context, Hono } from 'hono';
import { createSellerResearchRunner, parseSellerCardRequest, type SellerViewer } from './seller-research-runtime.js';
import { readDashboardSellerOptions } from './dashboard-live-runtime.js';

/** Cookie-authenticated account surface, never mounted on the public research router. */
export function mountSellerResearchRoutes(app:Hono,viewer:(c:Context)=>SellerViewer|null,
 run=createSellerResearchRunner(),options=readDashboardSellerOptions,now=Date.now){
 let busy=false,lastAttempt:number|null=null;
 app.get('/api/account/kite/seller/options',c=>{
  c.header('Cache-Control','no-store');if(!viewer(c))return c.json({status:'BLOCKED',blockers:['KITE_LOGIN_REQUIRED']},401);
  return c.json(options());
 });
 app.post('/api/account/kite/seller/research',async c=>{
  c.header('Cache-Control','no-store');
  const session=viewer(c);if(!session)return c.json({status:'BLOCKED',blockers:['KITE_LOGIN_REQUIRED']},401);
  // No cross-site account-triggered broker reads, including requests with absent Origin.
  const origin=c.req.header('origin');
  if(!origin||origin!==new URL(c.req.url).origin)return c.json({status:'BLOCKED',blockers:['SAME_ORIGIN_REQUIRED']},403);
  if(!(c.req.header('content-type')||'').startsWith('application/json'))return c.json({status:'BLOCKED',blockers:['JSON_REQUIRED']},415);
  const raw=await c.req.text();if(raw.length>4096)return c.json({status:'BLOCKED',blockers:['REQUEST_TOO_LARGE']},413);
  let input:unknown;try{input=JSON.parse(raw);}catch{return c.json({status:'BLOCKED',blockers:['SELLER_REQUEST_INVALID']},400);}
  const request=parseSellerCardRequest(input);if(!request)return c.json({status:'BLOCKED',blockers:['SELLER_REQUEST_INVALID']},400);
  if(busy||lastAttempt!==null&&now()-lastAttempt<8000)return c.json({status:'BLOCKED',blockers:['SELLER_CHECK_BUSY_OR_COOLDOWN']},429);
  busy=true;lastAttempt=now();
  try{return c.json(await run(session,request));}
  catch{return c.json({status:'BLOCKED',blockers:['SELLER_RESEARCH_UNAVAILABLE']},503);}
  finally{busy=false;}
 });
}
