/** Synthetic browser acceptance only: fixtures below are not market evidence. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {renderRecordedDashboard} from '../recorded-dashboard-view.js';
const date='2026-11-04',at=(time:string)=>date+'T'+time+':00+05:30';
const compact=(rows:any[])=>{const columns=Object.keys(rows[0]||{});return {columns,rows:rows.map(r=>columns.map(k=>r[k]))};};
const server=createServer((req,res)=>{
 const u=new URL(req.url!,'http://localhost');res.setHeader('Content-Type','application/json');
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(renderRecordedDashboard());return;}
 if(u.pathname.endsWith('/dates')){res.end(JSON.stringify({ok:true,dates:['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>({symbol,tradeDate:date,markerCount:3}))}));return;}
 if(u.pathname.endsWith('/replay')){
  const symbol=u.searchParams.get('symbol'),from=u.searchParams.get('from')!,to=u.searchParams.get('to')!;
  const times=['09:15','09:16','09:17'].filter(t=>t>=from&&t<=to);
  const market=times.map(t=>({symbol,minute_bucket:at(t),snapshot_id:symbol+t,truth_verdict:'TRUE',backend_timestamp:date+'T'+t+':20+05:30',spot_ltp:23900}));
  const options=market.flatMap(m=>['2026-11-09','2026-11-16'].flatMap(expiry=>['CE','PE'].map(option_type=>({...m,expiry,strike:23900,option_type,ltp:option_type==='PE'?100:expiry==='2026-11-09'?(m.minute_bucket===at('09:15')?100:170):(m.minute_bucket===at('09:15')?200:180),quote_timestamp:m.minute_bucket}))));
  res.end(JSON.stringify({ok:true,market:compact(market),options:compact(options),chain:compact([])}));return;
 }
 res.statusCode=503;res.end(JSON.stringify({ok:false,reason:'SYNTHETIC_TEST_NO_EXTERNAL_DATA'}));
});
let browser:any;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();assert(addr&&typeof addr!=='string');const base='http://127.0.0.1:'+addr.port;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 await mkdir('pr800-mobile-ui-artifacts',{recursive:true});
 for(const width of [360,390]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
  try{
   const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   await page.goto(base);await page.waitForFunction(()=>document.getElementById('clock')?.textContent?.includes('SAVED'));
   assert.equal(await page.locator('#ar-premium-output svg').count(),4);
   assert((await page.locator('#ar-premium-output').innerText()).includes('09:15–15:40'));
   assert((await page.locator('#ar-premium-output').innerText()).includes('OHLC unavailable'));
   await page.locator('#ar-premium-interval').selectOption('5');
   assert((await page.locator('#ar-premium-output').innerText()).includes('5m sampled line'));
   await page.locator('#ar-premium-scope').selectOption('SELECTED');
   assert.equal(await page.locator('#ar-premium-output svg').count(),2);
   await page.locator('#ar-premium-scope').selectOption('ALL');
   await page.locator('#ar-reset').click();
   assert((await page.locator('#ar-premium-output').innerText()).includes('All 1 eligible'));
   assert(!(await page.locator('#ar-premium-output').innerText()).includes('09:16:00'));
   await page.locator('#ar-60-all').click();await page.waitForFunction(()=>document.getElementById('ar-60-status')?.textContent?.includes('Completed 1 / 1'));
   assert((await page.locator('#ar-60-results').innerText()).includes('₹70'));
   await page.locator('#ar-60-results summary').first().click();
   const detail=await page.locator('#ar-60-results details').first().innerText();
   for(const value of ['09:15 → 09:16','DTE 5','DTE 12','-20','ENDPOINTS_OBSERVED'])assert(detail.includes(value),value);
   await page.locator('#ar-60-side').selectOption('PE');assert((await page.locator('#ar-60-results').innerText()).includes('No verified'));
   await page.locator('#ar-60-side').selectOption('BOTH');
   await page.locator('#ar-60-index').selectOption('ALL');await page.locator('#ar-60-all').click();
   await page.waitForFunction(()=>document.getElementById('ar-60-status')?.textContent?.includes('Completed 3 / 3'));
   for(const symbol of ['NIFTY','SENSEX','BANKNIFTY'])assert((await page.locator('#ar-60-results').innerText()).includes(symbol));
   assert.equal(new URL(page.url()).pathname,'/');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal document overflow');
   await page.screenshot({path:'pr800-mobile-ui-artifacts/finder-'+width+'-synthetic.png',fullPage:true});assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 console.log('Finder-specific 360px/390px synthetic browser acceptance PASS');
}finally{await browser?.close();server.close();}
