import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {mountLadderAcceptanceRoutes} from '../telegram-ladder-acceptance.js';
import {SYMBOLS,value,missing,type SymbolName} from '../telegram-ladder-v4.js';
const path='/api/telegram/ladder-acceptance',now=1793336400000,key='a'.repeat(40),run=now+'-abcdef12';
function harness({wrongChat=false,badDocument=false,disabled=false,recorded=false,symbol='NIFTY' as SymbolName}={}) {
  const chatIds={NIFTY:'-12345',SENSEX:'-23456',BANKNIFTY:'-34567'},chatId=chatIds[symbol];
  const env:any={TELEGRAM_LADDER_ACCEPTANCE_ENABLED:disabled?'false':'true',TELEGRAM_LADDER_ACCEPTANCE_KEY:key,TELEGRAM_LADDER_ACCEPTANCE_RUN_ID:run,TELEGRAM_BOT_TOKEN:'12345:TEST_ONLY',TELEGRAM_CHAT_ID_NIFTY:chatIds.NIFTY,TELEGRAM_CHAT_ID_SENSEX:chatIds.SENSEX,TELEGRAM_CHAT_ID_BANKNIFTY:chatIds.BANKNIFTY};
  if(recorded)env.TELEGRAM_LADDER_ACCEPTANCE_WINDOW='2026-10-30|09:15|09:18';
  const jobs=new Map<string,any>();let sends=0,reads=0,writes=0,sourceReads=0,bytes:Uint8Array=new Uint8Array();
  const store:any={
    putIfAbsent:async(job:any)=>{if(jobs.has(job.id))return false;writes++;jobs.set(job.id,{...job,states:job.parts.map(()=>({status:'PENDING'}))});return true;},
    pending:async()=>[],claim:async(id:string,part:number)=>{const j=jobs.get(id);if(!['PENDING','RETRYABLE'].includes(j.states[part].status))return false;j.states[part]={status:'SENDING'};return true;},
    settle:async(id:string,part:number,status:string,receipt:string)=>{jobs.get(id).states[part]={status,receipt};},
  };
  const pool={connect:async()=>({release(){},query:async(_sql:string,args:any[])=>({rows:jobs.has(args[1])?[{payload:structuredClone(jobs.get(args[1]))}]:[]})})};
  const response=(result:any)=>new Response(JSON.stringify({ok:true,result}),{headers:{'Content-Type':'application/json'}});
  const http:typeof fetch=async(url:any,init:any)=>{
    if(String(url).endsWith('/getChat')){reads++;return response({id:wrongChat?-999:Number(chatId),type:'supergroup',title:symbol==='NIFTY'?'OptionPilot Nifty':'OptionPilot '+symbol});}
    if(String(url).endsWith('/sendMessage')){sends++;assert.equal(init.body.get('chat_id'),chatId);if(symbol==='NIFTY')assert.ok(!init.body.get('text').includes('BANKNIFTY'));return response({message_id:101,chat:{id:Number(chatId)}});}
    if(String(url).endsWith('/sendDocument')){sends++;assert.equal(init.body.get('chat_id'),chatId);const file=init.body.get('document');bytes=new Uint8Array(await file.arrayBuffer());return response({message_id:102,chat:{id:Number(chatId)},document:badDocument?undefined:{file_id:'accepted',file_name:file.name,file_size:bytes.length}});}
    if(String(url).endsWith('/getFile'))return response({file_path:'documents/accepted.txt'});
    if(String(url).includes('/file/bot'))return new Response(bytes);
    throw Error('Unexpected network request');
  };
  const app=new Hono();let clock=now;
  mountLadderAcceptanceRoutes(app,{env:()=>env,now:()=>clock,http,pool:()=>pool,outbox:()=>store,pause:async()=>{},read:async()=>{
    sourceReads++;const v=(n:number)=>value(n,'UNVERIFIED','TEST_RECORDED');
    return {failures:[],frames:[0,3].map(m=>({minute:new Date(Date.parse('2026-10-30T03:45:00Z')+m*60_000).toISOString(),participation:[],indices:SYMBOLS.map((s,n)=>({symbol:s,spot:v(1000+n),pdh:missing(),pdl:missing(),expiries:[{expiry:'2026-11-03',pcr:{full:v(1.2),band7:v(1.1),volume:v(.9)},volumeScope:'TEST',ceWall:{strike:null,oi:missing()},peWall:{strike:null,oi:missing()},contracts:[{strike:100+n*100,side:'CE' as const,ltp:v(10),pdh:missing(),pdl:missing()}]}]}))}))};
  }});
  const request=(method='GET',body:any=undefined,secret=key)=>app.request(path+'?symbol='+symbol,{method,headers:{'x-ladder-acceptance-key':secret,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {request,env,counts:()=>({sends,reads,writes}),sourceReads:()=>sourceReads,chatId,expire:()=>{clock=now+15*60_000+1;}};
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
test('recorded report hashes bind each index to its own group and immutable saved content',async()=>{
  for(const [n,symbol] of SYMBOLS.entries()) {
    const h=harness({recorded:true,symbol}),preview=await(await h.request()).json(),report=preview.recordedReport;
    assert.ok(report.summary.includes('RECORDED SAMPLE'));assert.ok(report.content.includes(`Strike ${100+n*100} CE`));
    for(let other=0;other<3;other++)if(other!==n)assert.ok(!report.content.includes(`Strike ${100+other*100} CE`));
    const body={expectedChatId:h.chatId,runId:run,expectedReportSha256:report.sha256};
    assert.equal((await h.request('POST',{...body,expectedReportSha256:'wrong'})).status,409);assert.equal(h.counts().writes,0);
    const sent=await(await h.request('POST',body)).json();assert.equal(sent.delivery,'ACKED');assert.equal(sent.receipts[1].documentVerified,true);
    const reads=h.sourceReads();const repeated=await(await h.request('POST',body)).json();
    assert.equal(repeated.newMessagesAcknowledged,0);assert.equal(h.sourceReads(),reads);assert.equal(h.counts().sends,2);
  }
});
