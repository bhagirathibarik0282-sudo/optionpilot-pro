import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE='op_runtime_admin', SESSION_MS=12*60*60_000;
function equal(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
function signature(secret,payload){return createHmac('sha256',secret).update('optionpilot-ops-v1:'+payload).digest('base64url');}
function session(secret,at){
  const payload=String(at+SESSION_MS)+'.'+randomBytes(16).toString('base64url');
  return payload+'.'+signature(secret,payload);
}
function validSession(secret,request,at){
  if(!secret)return false;
  const raw=(request.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
  const parts=(raw?raw.slice(COOKIE.length+1):'').split('.');
  if(parts.length!==3||! /^\d{13}$/.test(parts[0])||! /^[a-zA-Z0-9_-]{22}$/.test(parts[1]))return false;
  const expiry=Number(parts[0]);
  if(!Number.isSafeInteger(expiry)||expiry<=at||expiry>at+SESSION_MS)return false;
  return equal(parts[2],signature(secret,parts[0]+'.'+parts[1]));
}
function cookie(token,age){return COOKIE+'='+token+'; Path=/ops; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;}

const HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OptionPilot · Start / Stop</title><style>
:root{font-family:system-ui,sans-serif;color-scheme:dark;background:#0b131a;color:#edf6fc}*{box-sizing:border-box}body{margin:0;padding:20px 12px}main{max-width:480px;margin:auto;background:#14232d;border:1px solid #40505c;border-radius:17px;padding:18px}h1{font-size:24px;margin:3px 0 10px}p,small{color:#bfd0da;line-height:1.5}p{font-size:14px}small{font-size:12px}.state{background:#0c1c26;border-radius:12px;padding:14px;margin:15px 0}.state strong{display:block;font-size:20px}#detail{display:block;margin-top:5px}.row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1}button,a{padding:13px 8px;min-height:48px;border:0;border-radius:10px;font:inherit;font-weight:600;text-align:center;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.start{background:#00ac7d;color:#061911}.stop{background:#d7515c;color:white}.neutral{background:#34505f;color:white}a{display:block;background:#233e4b;color:white;text-decoration:none}input{display:block;width:100%;padding:13px;border:1px solid #668494;border-radius:10px;background:#0c1c26;color:white;font:inherit;margin:7px 0 10px}.hidden{display:none}label{font-size:13px;color:#b8c9d3}.space{height:12px}#message{display:block;min-height:24px;margin:12px 0;color:#f4c981;font-size:13px}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #65d9fc;outline-offset:2px}
</style></head><body><main><h1>OptionPilot · Start / Stop</h1><p>Manual dashboard startup outside market hours. The normal 08:45–16:15 IST market-day schedule continues automatically.</p><div class="state"><strong id="state">Checking status…</strong><small id="detail"></small></div><section id="login"><label for="token">One-time admin login · RESEARCH_ADMIN_TOKEN</label><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste token from Railway Variables"><button id="sign-in" class="neutral">Unlock controls</button><p>Token is sent only to this site over HTTPS and not saved in browser storage. The signed session lasts up to 12 hours.</p></section><section id="controls" class="hidden"><label>Manual runtime duration</label><div class="row"><button class="start" data-minutes="15">▶ 15 min</button><button class="start" data-minutes="30">▶ 30 min</button><button class="start" data-minutes="60">▶ 60 min</button></div><div class="space"></div><div class="row"><button class="stop" id="stop">■ Stop manual run</button><button class="neutral" id="logout">Lock</button></div><p>Stop safely drains only an off-hours manual run; it cannot interrupt the automatic market schedule.</p></section><output role="status" aria-live="polite" id="message"></output><div class="row"><a href="/">Dashboard</a><a href="/recorded-dashboard">Recorded replay</a></div><p><small>Read-only controls; no trades or orders are created.</small></p></main>
<script>
'use strict';
const el=id=>document.getElementById(id),log=m=>el('message').textContent=m;
async function api(path,data){const options={credentials:'same-origin',cache:'no-store',headers:{'X-OptionPilot-Control':'1'}};if(data!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}const response=await fetch('/ops/control/'+path,options),result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result;}
async function refresh(){try{const r=await api('session'),s=r.runtime;el('login').classList.toggle('hidden',r.authorized);el('controls').classList.toggle('hidden',!r.authorized);el('state').textContent=s.ready?'● LIVE':s.draining?'◌ STOPPING':s.shouldRun?'◌ STARTING':'○ STOPPED';el('detail').textContent=(s.scheduled?'Automatic market hours':s.maintenance?'Manual session':'Outside operating hours')+' · '+(s.maintenanceUntil||s.hoursIST+' IST');document.querySelectorAll('[data-minutes]').forEach(b=>b.disabled=!r.authorized||s.scheduled||s.draining);el('stop').disabled=!r.authorized||s.scheduled||!s.maintenance;}catch(e){log('Status error: '+e.message);}}
async function action(path,data,success){try{const r=await api(path,data);log(r.until?'Running until '+new Date(r.until).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):success);await refresh();}catch(e){log(e.message);}}
el('sign-in').onclick=()=>{const token=el('token').value;el('token').value='';void action('login',{token},'Controls unlocked');};
document.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=()=>void action('start',{minutes:Number(b.dataset.minutes)},'Starting…'));
el('stop').onclick=()=>void action('stop',{},'Stopping safely…');
el('logout').onclick=()=>void action('logout',{},'Controls locked');
refresh();setInterval(refresh,5000);
</script></body></html>`;

/** An off-hours-only control; the parent supervisor owns child lifecycle and persistent override. */
export function createRuntimeControlPanel({env,now,status,start,stop}){
 function send(res,code,body,extra={}){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});
  res.end(JSON.stringify(body));return true;
 }
 function csrfOkay(req){
  if(req.headers['x-optionpilot-control']!=='1')return false;
  const origin=req.headers.origin;
  if(!origin)return true;
  const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';
  return origin===proto+'://'+req.headers.host;
 }
 async function body(req){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('BODY_TOO_LARGE');}
  return JSON.parse(raw);
 }
 return async(req,res)=>{
  const path=new URL(req.url||'/','http://localhost').pathname;
  if(path!=='/ops/control'&&!path.startsWith('/ops/control/'))return false;
  const secret=env.RESEARCH_ADMIN_TOKEN;
  if(path==='/ops/control'){
   if(req.method!=='GET')return send(res,405,{error:'GET_REQUIRED'});
   const nonce=randomBytes(16).toString('base64');
   const policy="default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':policy});
   res.end(HTML.replace('<style>','<style nonce="'+nonce+'">').replace('<script>','<script nonce="'+nonce+'">'));return true;
  }
  if(path==='/ops/control/session'){
   if(req.method!=='GET')return send(res,405,{error:'GET_REQUIRED'});
   return send(res,200,{authorized:validSession(secret,req,now().getTime()),runtime:status()});
  }
  if(req.method!=='POST')return send(res,405,{error:'POST_REQUIRED'});
  if(!csrfOkay(req))return send(res,403,{error:'INVALID_REQUEST_OR_ORIGIN'});
  if(path==='/ops/control/login'){
   let value;try{value=await body(req);}catch{return send(res,400,{error:'INVALID_REQUEST'});}
   if(!secret||!equal(value?.token,secret))return send(res,401,{error:'INVALID_ADMIN_TOKEN'});
   return send(res,200,{ok:true,runtime:status()},{'Set-Cookie':cookie(session(secret,now().getTime()),SESSION_MS/1000)});
  }
  if(path==='/ops/control/logout')return send(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
  if(!validSession(secret,req,now().getTime()))return send(res,401,{error:'SIGN_IN_REQUIRED'});
  if(path==='/ops/control/start'){
   let value;try{value=await body(req);}catch{return send(res,400,{error:'INVALID_REQUEST'});}
   if(![15,30,60].includes(value?.minutes))return send(res,400,{error:'CHOOSE_15_30_OR_60_MINUTES'});
   if(status().scheduled)return send(res,409,{error:'ALREADY_SCHEDULED_TO_RUN'});
   const result=await start(value.minutes);
   return send(res,result.ok?200:503,result);
  }
  if(path==='/ops/control/stop'){
   if(status().scheduled)return send(res,409,{error:'AUTOMATIC_MARKET_SCHEDULE_ACTIVE'});
   const result=await stop();
   return send(res,result.ok?200:503,result);
  }
  return send(res,404,{error:'NOT_FOUND'});
 };
}
