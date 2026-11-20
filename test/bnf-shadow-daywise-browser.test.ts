import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {BNF_SHADOW_DAYWISE_HTML,BNF_SHADOW_DAYWISE_CSS,installBnfShadowDaywise} from '../bnf-shadow-daywise-view.js';

test('mobile SHADOW date refresh distinguishes missing records, past P&L and failed worker checkpoints',async()=>{
 const lots=[1,2,4,6];
 const requests:string[]=[];
 const report=(date:string)=>({ok:true,mode:'BNF_SHADOW_DAYWISE_READ_ONLY_V1',lots,brokerOrders:0,
  latestJournalDate:'2026-11-18',days:[{date:'2026-11-18',scenarios:lots.map(l=>({lots:l,verdict:l===2?'PAPER_JOURNAL':'NOT_SIMULATED',
   estimatedNetPnlInr:l===2?-3093:null,intents:l===2?2:null,entryFills:l===2?2:null,exitFills:l===2?3:null}))}],
  selectedDay:{date,status:date==='2026-11-18'?'PAPER_EVENTS_RECORDED':'NO_JOURNAL_EVENTS',
   explanation:date==='2026-11-18'?'Recorded paper receipts only.':'No journal events. This does not prove zero trades.',
   workerEvidence:date==='2026-11-20'?{phase:'BLOCKED',reason:'WORKER_EXITED_NO_AUTO_RETRY',
    updatedAt:date+'T04:00:00Z',lastReportAt:date+'T03:59:00Z',lastExitAt:date+'T04:00:00Z',exitCode:1,
    lastReportedCounts:{observations:12,signals:0,rejected:3},failureStage:'SESSION_CHECK',failureReason:'SESSION_CHECK_FAILED'}:null}});
 const html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+BNF_SHADOW_DAYWISE_CSS+
  '</style></head><body>'+BNF_SHADOW_DAYWISE_HTML+'<script>const __name=(fn,_name)=>fn;('+installBnfShadowDaywise.toString()+')();</script></body></html>';
 const server=createServer((req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  if(url.pathname.includes('bnf-shadow-daywise')){
   requests.push(url.searchParams.get('date')||'');res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify(report(url.searchParams.get('date')||'')));return;
  }
  res.writeHead(200,{'content-type':'text/html'});res.end(html);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');let browser:any;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+(server.address() as any).port);
  await page.waitForFunction(()=>document.querySelector('[data-bnf-daywise-status]')?.textContent?.includes('Latest journal date'));
  const select=async(date:string)=>{
   await page.locator('[data-bnf-daywise-date]').fill(date);await page.locator('[data-bnf-daywise-refresh]').click();
   await page.waitForFunction((d:string)=>document.querySelector('[data-bnf-daywise-status]')?.textContent?.startsWith(d+' ·'),date);
  };
  await select('2026-11-19');
  assert.match(await page.locator('[data-bnf-daywise-status]').innerText(),/NO JOURNAL EVENTS.*does not prove zero trades/);
  assert.match(await page.locator('[data-bnf-daywise-worker]').innerText(),/No saved worker diagnostics/);
  assert.equal(await page.locator('tbody tr').count(),1);
  assert.equal(await page.locator('tbody tr td').first().innerText(),'2026-11-18');
  assert.equal(await page.locator('tbody tr td').nth(2).innerText(),'₹-3093.00 est · intents 2 · entry/exit receipts 2/3');
  assert.equal(await page.locator('tbody tr td').nth(3).innerText(),'NOT SIMULATED');
  await select('2026-11-20');
  const worker=await page.locator('[data-bnf-daywise-worker]').innerText();
  assert.match(worker,/BLOCKED.*WORKER_EXITED_NO_AUTO_RETRY/);assert.match(worker,/SESSION_CHECK_FAILED/);
  assert.match(worker,/full session coverage is unverified/);
  const widths=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(widths.scroll<=widths.width,'table must scroll inside its own container on mobile');
  assert.deepEqual(errors,[]);assert.equal(requests.length,3);
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
