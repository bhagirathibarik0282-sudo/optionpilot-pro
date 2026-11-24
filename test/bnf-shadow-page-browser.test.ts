import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {renderBnfShadowPage} from '../bnf-shadow-page.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';

// Synthetic journal values only. This is presentation acceptance, not a live trade claim.
test('dedicated mobile page explains estimated profit and never puts another date P&L under a missing day',async()=>{
 const lots=[1,2,4,6],date='2026-11-20';
 const day={date,scenarios:lots.map(l=>({lots:l,verdict:l===2?'PAPER_JOURNAL':'NOT_SIMULATED',
  estimatedNetPnlInr:l===2?3712.5:null,intents:3,entryFills:2,exitFills:3,closedTrades:2}))};
 const server=createServer((req,res)=>{
  const u=new URL(req.url||'/','http://local');
  if(u.pathname==='/ops/runtime-status'){res.writeHead(200,{'content-type':'application/json'});res.end('{"shouldRun":false}');return;}
  if(u.pathname.endsWith('/bnf-shadow-daywise')){
   const selected=u.searchParams.get('date');
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({ok:true,mode:'BNF_SHADOW_DAYWISE_READ_ONLY_V1',lots,brokerOrders:0,latestJournalDate:date,days:[day],
    selectedDay:{date:selected,status:selected===date?'PAPER_EVENTS_RECORDED':'NO_JOURNAL_EVENTS',explanation:selected===date?'Recorded paper receipts only.':'No paper journal events found. This does not prove zero trades.',workerEvidence:null}}));return;
  }
  res.writeHead(200,{'content-type':'text/html'});res.end(renderBnfShadowPage());
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');let browser:any;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  for(const width of [360,390]){
   const page=await browser.newPage({viewport:{width,height:844}}),errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/banknifty-shadow');
   await page.waitForFunction(()=>document.querySelector('[data-bnf-daywise-status]')?.textContent?.includes('Latest journal date'));
   const select=async(value:string)=>{
    await page.locator('[data-bnf-daywise-date]').fill(value);await page.locator('[data-bnf-daywise-refresh]').click();
    await page.waitForFunction((d:string)=>document.querySelector('[data-bnf-daywise-status]')?.textContent?.startsWith(d+' ·'),value);
   };
   await select(date);
   assert.match(await page.locator('[data-bnf-daywise-table]').innerText(),/₹3,712\.50 estimated paper profit/);
   assert.equal(await page.locator('td[data-label="2 Lots"]').count(),1);
   assert.match(await page.locator('body').innerText(),/not money earned or lost in your broker account/);
   await select('2026-11-19');
   assert.equal(await page.locator('[data-bnf-daywise-table] tbody tr').count(),0);
   assert.ok(!(await page.locator('[data-bnf-daywise-table]').innerText()).includes('3,712'));
   assert.match(await page.locator('#bnf-page-worker').innerText(),/OFF HOURS/);
   assert.equal(await page.locator('a[href="/api/research/business-dashboard/view"]').count(),1);
   const size=await page.evaluate(()=>({view:innerWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(size.scroll<=size.view,'dedicated page should not overflow a '+width+'px phone');
   assert.deepEqual(errors,[]);await page.close();
  }
  const main=renderBusinessDashboardV1Html({} as any).split('<script>')[0];
  assert.ok(!main.includes('class="op-bnf-daywise"'));assert.ok(!main.includes('id="bnf-shadow-timeline"'));
  assert.ok(main.includes('href="/banknifty-shadow"'));
 }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
