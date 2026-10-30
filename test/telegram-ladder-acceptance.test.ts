import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {mountLadderAcceptanceRoutes} from '../telegram-ladder-acceptance.js';
const path='/api/telegram/ladder-acceptance',now=1793336400000,key='a'.repeat(40),run=now+'-abcdef12';
function harness({wrongChat=false,badDocument=false,disabled=false}={}) {
  const env:any={TELEGRAM_LADDER_ACCEPTANCE_ENABLED:disabled?'false':'true',TELEGRAM_LADDER_ACCEPTANCE_KEY:key,TELEGRAM_LADDER_ACCEPTANCE_RUN_ID:run,TELEGRAM_BOT_TOKEN:'12345:TEST_ONLY',TELEGRAM_CHAT_ID_NIFTY:'-12345'};
  const jobs=new Map<string,any>();let sends=0,reads=0,writes=0,bytes:Uint8Array=new Uint8Array();
  const store:any={
    putIfAbsent:async(job:any)=>{if(jobs.has(job.id))return false;writes++;jobs.set(job.id,{...job,states:job.parts.map(()=>({status:'PENDING'}))});return true;},
    pending:async()=>[],claim:async(id:string,part:number)=>{const j=jobs.get(id);if(!['PENDING','RETRYABLE'].includes(j.states[part].status))return false;j.states[part]={status:'SENDING'};return true;},
    settle:async(id:string,part:number,status:string,receipt:string)=>{jobs.get(id).states[part]={status,receipt};},
  };
  const pool={connect:async()=>({release(){},query:async(_sql:string,args:any[])=>({rows:jobs.has(args[1])?[{payload:structuredClone(jobs.get(args[1]))}]:[]})})};
  const response=(result:any)=>new Response(JSON.stringify({ok:true,result}),{headers:{'Content-Type':'application/json'}});
  const http:typeof fetch=async(url:any,init:any)=>{
    if(String(url).endsWith('/getChat')){reads++;return response({id:wrongChat?-999:-12345,type:'supergroup',title:'OptionPilot Nifty'});}
    if(String(url).endsWith('/sendMessage')){sends++;assert.equal(init.body.get('chat_id'),'-12345');assert.ok(!init.body.get('text').includes('BANKNIFTY'));return response({message_id:101,chat:{id:-12345}});}
    if(String(url).endsWith('/sendDocument')){sends++;const file=init.body.get('document');bytes=new Uint8Array(await file.arrayBuffer());return response({message_id:102,chat:{id:-12345},document:badDocument?undefined:{file_id:'accepted',file_name:file.name,file_size:bytes.length}});}
    if(String(url).endsWith('/getFile'))return response({file_path:'documents/accepted.txt'});
    if(String(url).includes('/file/bot'))return new Response(bytes);
    throw Error('Unexpected network request');
  };
  const app=new Hono();let clock=now;
  mountLadderAcceptanceRoutes(app,{env:()=>env,now:()=>clock,http,pool:()=>pool,outbox:()=>store,pause:async()=>{}});
  const request=(method='GET',body:any=undefined,secret=key)=>app.request(path,{method,headers:{'x-ladder-acceptance-key':secret,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {request,env,counts:()=>({sends,reads,writes}),expire:()=>{clock=now+15*60_000+1;}};
}
const body={expectedChatId:'-12345',runId:run};
test('disabled, unauthenticated and expired requests do no network work or database writes',async()=>{
  for(const mode of ['disabled','key','expired']){const h=harness({disabled:mode==='disabled'});if(mode==='expired')h.expire();const r=await h.request('POST',body,mode==='key'?'wrong':key);assert.equal(r.status,403);assert.deepEqual(h.counts(),{sends:0,reads:0,writes:0});}
});
test('preflight verifies the exact configured NIFTY chat without sends or secret disclosure',async()=>{
  const h=harness(),r=await h.request(),value=await r.json();assert.equal(r.status,200);assert.equal(value.title,'OptionPilot Nifty');assert.equal(value.chatId,'-12345');assert.equal(value.sendsTelegram,false);
  assert.ok(!JSON.stringify(value).includes(key));assert.ok(!JSON.stringify(value).includes('TEST_ONLY'));assert.deepEqual(h.counts(),{sends:0,reads:1,writes:0});
});
test('wrong destination or run is rejected before sends and outbox writes',async()=>{
  for(const b of [{...body,expectedChatId:'-999'},{...body,runId:run+'x'}]){const h=harness(),r=await h.request('POST',b);assert.equal(r.status,409);assert.equal(h.counts().sends,0);assert.equal(h.counts().writes,0);}
  const h=harness({wrongChat:true});assert.equal((await h.request('POST',body)).status,503);assert.equal(h.counts().sends,0);assert.equal(h.counts().writes,0);
});
test('text and UTF-8 TXT receive durable receipts and byte-for-byte document verification',async()=>{
  const h=harness(),r=await h.request('POST',body),value=await r.json();
  assert.equal(value.delivery,'ACKED');assert.equal(value.newMessagesAcknowledged,2);assert.equal(value.receipts[0].messageId,'101');assert.equal(value.receipts[1].messageId,'102');assert.equal(value.receipts[1].documentVerified,true);assert.ok(value.receipts[1].bytes>0);assert.equal(value.createsOrders,false);
  const again=await(await h.request('POST',body)).json();assert.equal(again.delivery,'ACKED');assert.equal(again.newMessagesAcknowledged,0);assert.equal(h.counts().sends,2);assert.equal(h.counts().writes,1);
});
test('unverified document response becomes UNKNOWN and is never automatically resent',async()=>{
  const h=harness({badDocument:true}),first=await(await h.request('POST',body)).json();assert.equal(first.delivery,'UNKNOWN');
  const second=await(await h.request('POST',body)).json();assert.equal(second.delivery,'UNKNOWN');assert.equal(second.newMessagesAcknowledged,0);assert.equal(h.counts().sends,2);
});
