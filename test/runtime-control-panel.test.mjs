import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRuntimeControlPanel } from '../scripts/runtime-control-panel.mjs';

async function harness(t) {
 let at=Date.parse('2026-10-31T00:00:00Z'),scheduled=false,maintenance=false,ready=false,starts=0,stops=0;
 const status=()=>({scheduled,maintenance,shouldRun:scheduled||maintenance,running:ready,ready,draining:false,hoursIST:'08:45–16:15'});
 const handle=createRuntimeControlPanel({env:{RESEARCH_ADMIN_TOKEN:'very-long-random-test-token'},now:()=>new Date(at),status,
  start:async minutes=>{starts++;maintenance=true;ready=true;return {ok:true,until:new Date(at+minutes*60000).toISOString(),...status()};},
  stop:async()=>{stops++;maintenance=false;ready=false;return {ok:true,...status()};}});
 const server=http.createServer((req,res)=>{void handle(req,res);});server.listen(0);await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {url:'http://127.0.0.1:'+server.address().port,change:o=>{if('scheduled'in o)scheduled=o.scheduled;if('at'in o)at=o.at;},counts:()=>({starts,stops})};
}
const post=(cookie='',body={},origin='')=>({method:'POST',headers:{'Content-Type':'application/json','X-OptionPilot-Control':'1',...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});

test('off-hours control is visible; unauthorized users cannot start',async t=>{
 const h=await harness(t),page=await fetch(h.url+'/ops/control');
 assert.equal(page.status,200);assert.match(await page.text(),/Unlock controls/);
 assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal((await (await fetch(h.url+'/ops/control/session')).json()).authorized,false);
 assert.equal((await fetch(h.url+'/ops/control/start',post('',{minutes:30}))).status,401);
 assert.equal((await fetch(h.url+'/ops/control/login',post('',{token:'wrong'}))).status,401);
 assert.deepEqual(h.counts(),{starts:0,stops:0});
});

test('valid login unlocks start, stop and logout; cookie is HttpOnly',async t=>{
 const h=await harness(t),login=await fetch(h.url+'/ops/control/login',post('',{token:'very-long-random-test-token'}));
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 const auth=cookie.split(';')[0];
 assert.equal((await (await fetch(h.url+'/ops/control/session',{headers:{Cookie:auth}})).json()).authorized,true);
 assert.equal((await fetch(h.url+'/ops/control/start',post(auth,{minutes:40}))).status,400);
 const start=await fetch(h.url+'/ops/control/start',post(auth,{minutes:30}));
 assert.equal(start.status,200);assert.equal((await start.json()).maintenance,true);
 const stop=await fetch(h.url+'/ops/control/stop',post(auth));
 assert.equal(stop.status,200);assert.equal((await stop.json()).running,false);
 const logout=await fetch(h.url+'/ops/control/logout',post(auth));
 assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.deepEqual(h.counts(),{starts:1,stops:1});
});

test('automatic market schedule protected; cross-site requests blocked; sessions expire',async t=>{
 const h=await harness(t),login=await fetch(h.url+'/ops/control/login',post('',{token:'very-long-random-test-token'})),auth=login.headers.get('set-cookie').split(';')[0];
 h.change({scheduled:true});
 assert.equal((await fetch(h.url+'/ops/control/start',post(auth,{minutes:15}))).status,409);
 assert.equal((await fetch(h.url+'/ops/control/stop',post(auth))).status,409);
 h.change({scheduled:false});
 assert.equal((await fetch(h.url+'/ops/control/start',post(auth,{minutes:15},'https://attack.example'))).status,403);
 assert.equal((await fetch(h.url+'/ops/control/start',{method:'POST',headers:{Cookie:auth},body:'{}'})).status,403);
 h.change({at:Date.parse('2026-10-31T13:00:01Z')});
 assert.equal((await (await fetch(h.url+'/ops/control/session',{headers:{Cookie:auth}})).json()).authorized,false);
 assert.deepEqual(h.counts(),{starts:0,stops:0});
});
