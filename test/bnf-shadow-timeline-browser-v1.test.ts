import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {BNF_SHADOW_TIMELINE_HTML,BNF_SHADOW_TIMELINE_CSS,installBnfShadowTimeline} from '../bnf-shadow-trade-timeline-view-v1.js';

test('Chromium: owner-gated paper timeline draws synthetic 2-intent / 3-exit receipts without token leakage',async()=>{
 const d='2026-11-18',secret='SYNTHETIC-ADMIN-KEY';
 const report={
  ok:true,mode:'BNF_SHADOW_TIMELINE_READ_ONLY_V1',date:d,source:'DURABLE_SHADOW_PAPER_JOURNAL',
  brokerOrders:0,actualBrokerFills:false,telegramDeliveryVerified:false,counts:{intents:2,entryFills:2,exitFills:3},
  dailyEstimatedNetInr:-3093,reconciliation:'MATCHES_DURABLE_DAILY_ESTIMATE',
  trades:[{number:1,side:'PE',strike:55200,expiry:'2026-11-24',tradingsymbol:'SYNTHETIC-55200PE',
   lots:2,requestedQty:60,filledQty:60,exitedQty:60,signalIst:d+'T10:09:00+05:30',
   intentIst:d+'T10:10:00+05:30',entryIst:d+'T10:11:00+05:30',
   exitRequestedIst:d+'T10:18:00+05:30',closedIst:d+'T10:19:00+05:30',
   modeledNetInr:-1275,estimatedCostInr:75,lastReason:'STOP_LOSS',paperReconciled:true,issues:[],
   events:[{atIst:d+'T10:10:00+05:30',kind:'ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED',qty:null,price:null},
    {atIst:d+'T10:11:00+05:30',kind:'ENTRY_FILL',qty:60,price:100,priceRole:'SIMULATED_ASK'},
    {atIst:d+'T10:19:00+05:30',kind:'EXIT_FILL',qty:60,price:80,priceRole:'SIMULATED_BID'}]},
   {number:2,side:'CE',strike:55100,expiry:'2026-11-24',tradingsymbol:'SYNTHETIC-55100CE',
    lots:2,requestedQty:60,filledQty:60,exitedQty:60,signalIst:d+'T11:04:00+05:30',
    intentIst:d+'T11:05:00+05:30',entryIst:d+'T11:06:00+05:30',
    exitRequestedIst:d+'T11:14:00+05:30',closedIst:d+'T11:16:00+05:30',
    modeledNetInr:-1818,estimatedCostInr:75,lastReason:'STOP_LOSS',paperReconciled:true,issues:[],
    events:[{atIst:d+'T11:05:00+05:30',kind:'ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED',qty:null,price:null},
     {atIst:d+'T11:06:00+05:30',kind:'ENTRY_FILL',qty:60,price:150,priceRole:'SIMULATED_ASK'},
     {atIst:d+'T11:15:00+05:30',kind:'EXIT_FILL',qty:30,price:120,priceRole:'SIMULATED_BID'},
     {atIst:d+'T11:16:00+05:30',kind:'EXIT_FILL',qty:30,price:121.9,priceRole:'SIMULATED_BID'}]}]
 };
 const script='const __name=(fn,_name)=>fn;('+installBnfShadowTimeline.toString()+')();';
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+BNF_SHADOW_TIMELINE_CSS+
  '</style></head><body>'+BNF_SHADOW_TIMELINE_HTML+'<script>'+script+'</script></body></html>';
 const requests:{url:string;auth:string}[]=[];
 const server=createServer((req,res)=>{
  requests.push({url:req.url||'',auth:String(req.headers.authorization||'')});
  if(req.url?.startsWith('/api/research/recorded-dashboard/bnf-shadow-timeline?')){
   if(req.headers.authorization!=='Bearer '+secret){
    res.writeHead(401,{'content-type':'application/json'});res.end('{"ok":false,"error":"ADMIN_AUTH_REQUIRED"}');return;
   }
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify(report));return;
  }
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser:any;
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('NO_LOCAL_PORT');
  const origin='http://127.0.0.1:'+address.port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const page=await browser.newPage();
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{if(!request.url().startsWith(origin))errors.push('EXTERNAL_REQUEST');});
  await page.goto(origin);
  await page.locator('#bnf-shadow-timeline summary').click();
  await page.locator('#bnf-shadow-timeline-date').fill(d);
  await page.locator('#bnf-shadow-timeline-key').fill('WRONG-KEY');
  await page.locator('#bnf-shadow-timeline-load').click();
  await page.waitForFunction(()=>document.querySelector('#bnf-shadow-timeline-state')?.textContent?.includes('Admin key rejected'));
  assert.equal(await page.locator('#bnf-shadow-timeline article').count(),0);
  assert.equal(await page.locator('#bnf-shadow-timeline-key').inputValue(),'');
  await page.locator('#bnf-shadow-timeline-key').fill(secret);
  await page.locator('#bnf-shadow-timeline-load').click();
  await page.waitForFunction(()=>document.querySelector('#bnf-shadow-timeline-state')?.textContent?.includes('Loaded read-only'));
  assert.equal(await page.locator('#bnf-shadow-timeline article').count(),2);
  const body=await page.locator('#bnf-shadow-timeline-data').innerText();
  assert.match(body,/3/);
  assert.match(body,/3,093\.00/);
  assert.match(body,/10:19:00/);
  assert.match(body,/STOP_LOSS/);
  assert.match(body,/SIMULATED|bid/);
  assert.match(body,/NOT LINKED/);
  assert.equal(await page.locator('#bnf-shadow-timeline-key').inputValue(),'');
  assert.deepEqual(errors,[]);
  assert.equal(requests.filter(x=>x.url.includes('bnf-shadow-timeline')).length,2);
  assert.ok(requests.every(x=>!x.url.includes(secret)));
  const state=await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}));
  assert.deepEqual(state,{local:0,session:0});
 }finally{
  await browser?.close();
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
});
