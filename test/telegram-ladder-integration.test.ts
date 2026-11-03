import test from 'node:test';
import assert from 'node:assert/strict';
import {createLadderRecorderSource} from '../telegram-ladder-source.js';
import {createLadderTelegramTransport} from '../telegram-ladder-transport.js';
import {LADDER_PREFIX} from '../telegram-ladder-v4.js';
const range={date:'2026-10-29',from:'2026-10-29T03:45:00Z',to:'2026-10-29T03:48:00Z'};
const row=(symbol:string)=>({symbol,minute_bucket:range.from,backend_timestamp:range.from,spot_ltp:100,pdh:110,pdl:90});
const replay=async(request:any):Promise<any>=>({ok:true,request,market:[row(request.symbol)],options:[],chain:[]});
test('bounded source reads all three FULL scopes and joins participation without upgrading archive quality',async()=>{
  const calls:any[]=[];
  const read=createLadderRecorderSource({replay:async r=>{calls.push(r);return replay(r);},participation:async()=>[{minuteBucket:range.from,rows:[{role:'STOCK',token:1,label:'A',price:10,state:'LIVE',changePct:1}]}]});
  const out=await read(range);assert.deepEqual(out.failures,[]);assert.equal(out.frames.length,1);
  assert.equal(out.frames[0].indices.length,3);assert.equal(out.frames[0].participation.length,1);
  assert.ok(calls.every(c=>c.scope==='FULL'&&c.fromTime==='09:15'&&c.toTime==='09:18'));
  assert.equal(out.frames[0].indices[0].spot.quality,'UNVERIFIED');
});
test('source failure retains healthy indices and participation and does not fill missing minutes',async()=>{
  const read=createLadderRecorderSource({replay:async r=>{if(r.symbol==='SENSEX')throw Error('offline');return replay(r);},participation:async()=>[]});
  const out=await read(range);assert.deepEqual(out.failures,['SENSEX_SOURCE_UNAVAILABLE']);
  assert.equal(out.frames.length,1);assert.equal(out.frames[0].indices.length,2);
});
test('one transient source failure retries the same range without rereading healthy indices',async()=>{
  const calls:Record<string,number>={};let participationCalls=0;
  const read=createLadderRecorderSource({replay:async request=>{
    calls[request.symbol]=(calls[request.symbol]??0)+1;
    if(request.symbol==='NIFTY'&&calls.NIFTY===1)throw Error('temporary read failure');
    return replay(request);
  },participation:async()=>{if(++participationCalls===1)throw Error('temporary participation failure');return [];} });
  const out=await read(range);
  assert.deepEqual(out.failures,[]);assert.equal(out.frames[0].indices.length,3);
  assert.deepEqual(calls,{NIFTY:2,SENSEX:1,BANKNIFTY:1});assert.equal(participationCalls,2);
});
test('persistent read failure stops after one retry and preserves healthy values',async()=>{
  let attempts=0,participationCalls=0;
  const read=createLadderRecorderSource({replay:async request=>{
    if(request.symbol==='SENSEX'){attempts++;return {ok:false,request} as any;}
    return replay(request);
  },participation:async()=>{participationCalls++;throw Error('offline');}});
  const out=await read(range);
  assert.equal(attempts,2);assert.equal(participationCalls,2);
  assert.deepEqual(out.failures,['SENSEX_SOURCE_UNAVAILABLE','PARTICIPATION_SOURCE_UNAVAILABLE']);
  assert.equal(out.frames[0].indices.length,2);
});
test('missing market row preserves existing exact premiums and chain values as unverified',async()=>{
  const read=createLadderRecorderSource({replay:async request=>({ok:true,request,market:[],options:request.symbol==='NIFTY'?[{symbol:'NIFTY',minute_bucket:range.from,expiry:'2026-11-03',strike:23000,option_type:'CE',ltp:123}]:[],chain:request.symbol==='NIFTY'?[{symbol:'NIFTY',minute_bucket:range.from,expiry:'2026-11-03',full_chain_oi_pcr:1.2}]:[]}) as any,participation:async()=>[]});
  const out=await read(range),nifty=out.frames[0].indices[0];
  assert.deepEqual(out.failures,[]);assert.equal(nifty.spot.quality,'MISSING');
  assert.equal(nifty.expiries[0].contracts[0].ltp.value,123);assert.equal(nifty.expiries[0].contracts[0].ltp.quality,'UNVERIFIED');
  assert.equal(nifty.expiries[0].pcr.full.value,1.2);
});
test('wrong identity and out of range records are isolated before merging',async()=>{
  for(const bad of ['symbol','time','request']) {
    const read=createLadderRecorderSource({replay:async r=>{const x=await replay(r);if(r.symbol==='NIFTY'){if(bad==='symbol')x.market[0].symbol='SENSEX';if(bad==='time')x.market[0].minute_bucket='2026-10-29T04:00:00Z';if(bad==='request')x.request={...r,scope:'CORE'};}return x;},participation:async()=>[]});
    const out=await read(range);assert.deepEqual(out.failures,['NIFTY_SOURCE_UNAVAILABLE']);assert.equal(out.frames[0].indices.length,2);
  }
});
test('full-session scans, invalid dates, unzoned clocks and preopen ranges are rejected before reads',async()=>{
  let calls=0;const read=createLadderRecorderSource({replay:async r=>{calls++;return replay(r);},participation:async()=>[]});
  for(const r of [{...range,to:'2026-10-29T10:00:00Z'},{...range,date:'2026-02-30'}, {...range,from:'2026-10-29T03:45:00'}, {...range,from:'2026-10-29T03:44:00Z'}])await assert.rejects(read(r));
  assert.equal(calls,0);
});
const config={token:'12345:TEST_ONLY',chatId:'-12345'};
const response=(status:number,data:any)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
test('transport requires concrete destination and makes no request on creation or invalid payload',async()=>{
  let calls=0;const transport=createLadderTelegramTransport({...config,fetch:(async()=>{calls++;throw Error();}) as any});
  assert.equal(calls,0);await assert.rejects(transport.send('legacy'));assert.equal(calls,0);
  assert.throws(()=>createLadderTelegramTransport({...config,chatId:'@unresolved'}));
});
test('text and document retain every byte and ACK only a matching destination and real message id',async()=>{
  const requests:any[]=[];const transport=createLadderTelegramTransport({...config,fetch:(async(url:any,init:any)=>{requests.push({url,init});return response(200,{ok:true,result:{message_id:23,chat:{id:-12345}}});}) as any});
  assert.deepEqual(await transport.send(LADDER_PREFIX+'test'),{status:'ACKED',receipt:'23'});
  const content='ଓଡ଼ିଆ 🟢\n'.repeat(1000);
  assert.deepEqual(await transport.send({kind:'DOCUMENT',filename:'ladder.txt',content,caption:LADDER_PREFIX+'report'}),{status:'ACKED',receipt:'23'});
  assert.ok(requests[0].url.endsWith('/sendMessage'));assert.equal(requests[0].init.body.get('text'),LADDER_PREFIX+'test');
  assert.ok(requests[1].url.endsWith('/sendDocument'));assert.equal(await requests[1].init.body.get('document').text(),content);
});
test('timeouts, malformed responses, missing receipts and wrong chats are UNKNOWN',async()=>{
  for(const fn of [async()=>{throw Error('timeout');},async()=>new Response('proxy failure',{status:502}),async()=>response(200,{ok:true,result:{chat:{id:-12345}}}),async()=>response(200,{ok:true,result:{message_id:3,chat:{id:-999}}}),async()=>response(500,{ok:false,error_code:500})]) {
    const transport=createLadderTelegramTransport({...config,fetch:fn as any});assert.deepEqual(await transport.send(LADDER_PREFIX+'test'),{status:'UNKNOWN'});
  }
});
test('Telegram retry_after pauses network calls until its deadline',async()=>{
  let now=1000,calls=0;const transport=createLadderTelegramTransport({...config,now:()=>now,fetch:(async()=>{calls++;return response(429,{ok:false,error_code:429,parameters:{retry_after:7}});}) as any});
  assert.deepEqual(await transport.send(LADDER_PREFIX+'test'),{status:'RETRYABLE'});assert.equal(transport.blockedUntil,8000);
  await transport.send(LADDER_PREFIX+'test');assert.equal(calls,1);now=8000;await transport.send(LADDER_PREFIX+'test');assert.equal(calls,2);
});
