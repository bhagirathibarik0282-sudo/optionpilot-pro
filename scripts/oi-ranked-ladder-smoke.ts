/** Isolated synthetic UI acceptance. No live broker/database/API credentials. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {measurePcrSnapshot} from '../dashboard-pcr-sampler.js';
import {deriveOiStudioSnapshot,installOiWallStudio,OI_WALL_STUDIO_HTML,OI_WALL_STUDIO_CSS} from '../oi-wall-studio.js';
import {deriveOiRankedLadder,renderOiRankedLadder} from '../oi-ranked-ladder.js';
import {renderMarketBookLiveContext} from '../market-book-reading-guide.js';
import {renderRecordedDashboard} from '../recorded-dashboard-view.js';
const today=new Date(Date.now()+19800000).toISOString().slice(0,10),now=Date.parse(today+'T12:30:00+05:30');
function packet(time:number,bump=0){
 const date=new Date(time+19800000).toISOString().slice(0,10),iso=new Date(time).toISOString(),expiry=new Date(now+7*86400000).toISOString().slice(0,10);
 const entries:any[]=Array.from({length:15},(_,i)=>['CE','PE'].map((side,j)=>({token:i*2+j+1,exchange:'NFO',label:'SYNTHETIC'+i+side,role:'OPTION',symbol:'NIFTY',expiry,strike:23650+i*50,side}))).flat();
 const quotes=Object.fromEntries(entries.map((e,i)=>['NFO:'+e.label,{instrument_token:e.token,oi:5000+i*100+bump*(i%3===0?-1:1)*(i+1),timestamp:iso,last_price:100+i+bump/10,last_trade_time:iso}]));
 const spot={identity:{role:'SPOT',symbol:'NIFTY'},price:24000,state:'LIVE',observedAt:iso,receivedAt:iso};
 const oiQuotes=entries.map(e=>({identity:e,state:'LIVE',price:quotes['NFO:'+e.label].last_price,oi:quotes['NFO:'+e.label].oi,observedAt:iso,receivedAt:iso}));
 return {connected:true,source:'KITE_WEBSOCKET_FULL',connectionState:'OPEN',serverTime:iso,snapshot:{runtimeId:'synthetic-browser',tradeDate:date,asOf:iso,indices:[{symbol:'NIFTY',expiry,expiries:[expiry],strikes:[...new Set(entries.map(e=>e.strike))],strike:24000,ceStrike:24000,peStrike:24000,spot,oiQuotes,studioCE:oiQuotes.find(q=>q.identity.strike===24000&&q.identity.side==='CE'),studioPE:oiQuotes.find(q=>q.identity.strike===24000&&q.identity.side==='PE'),pcrSnapshot:measurePcrSnapshot(entries,quotes,date,time,time,spot)}]}};
}
const before=packet(now-180000),current=packet(now,10);
const live='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic OI ladder acceptance</title><style>body{margin:0;padding:8px;background:#f3f6f3;font:15px system-ui}*{box-sizing:border-box}'+OI_WALL_STUDIO_CSS+'</style></head><body>'+OI_WALL_STUDIO_HTML+'<script>const __name=f=>f;const renderMarketBookLiveContext='+renderMarketBookLiveContext.toString()+';const deriveOiStudioSnapshot='+deriveOiStudioSnapshot.toString()+';const deriveOiRankedLadder='+deriveOiRankedLadder.toString()+';const renderOiRankedLadder='+renderOiRankedLadder.toString()+';const installOiWallStudio='+installOiWallStudio.toString()+';window.studio=installOiWallStudio();studio.setPage(5);studio.update('+JSON.stringify(before)+');studio.update('+JSON.stringify(current)+');window.__rankTick=setInterval(()=>studio.update('+JSON.stringify(current)+'),1000);</script></body></html>';
const compact=(rows:any[])=>{const columns=Object.keys(rows[0]||{});return {columns,rows:rows.map(r=>columns.map(k=>r[k]))};};
const date='2026-11-04';
const server=createServer((req,res)=>{
 const u=new URL(req.url!,'http://localhost');res.setHeader('Content-Type','application/json');
 if(u.pathname==='/live'||u.pathname==='/archive'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(u.pathname==='/live'?live:renderRecordedDashboard());return;}
 if(u.pathname.endsWith('/dates')){res.end(JSON.stringify({ok:true,dates:[{symbol:'NIFTY',tradeDate:date,markerCount:3}]}));return;}
 if(u.pathname.endsWith('/replay')){
  const from=u.searchParams.get('from')!,to=u.searchParams.get('to')!;
  const market=['09:15','09:18','15:40'].filter(t=>t>=from&&t<=to).map(t=>({symbol:'NIFTY',minute_bucket:date+'T'+t+':00+05:30',snapshot_id:t,truth_verdict:'TRUE',backend_timestamp:date+'T'+t+':00+05:30',spot_ltp:24000}));
  const options=market.flatMap(m=>Array.from({length:15},(_,i)=>['CE','PE'].map(side=>({...m,expiry,strike:23650+i*50,option_type:side,ltp:100+i,oi:5000+i*100+(m.snapshot_id==='09:15'?0:side==='CE'?100:-100),pdh:130,pdl:90,quote_timestamp:m.minute_bucket}))).flat());
  res.end(JSON.stringify({ok:true,market:compact(market),options:compact(options),chain:compact([])}));return;
 }
 res.statusCode=503;res.end(JSON.stringify({ok:false,reason:'SYNTHETIC_NO_EXTERNAL_SOURCE'}));
});
let browser:any;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();assert(addr&&typeof addr!=='string');const base='http://127.0.0.1:'+addr.port;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 await mkdir('oi-ranked-ladder-artifacts',{recursive:true});
 for(const width of [360,390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  try{
   await page.goto(base+'/live');await page.locator('#ows-chart .oir-table').waitFor();
   assert.equal(await page.locator('#ows-chart tbody tr').count(),15);
   await page.locator('#ows-rank-band').selectOption('3');assert.equal(await page.locator('#ows-chart tbody tr').count(),7);
   await page.locator('#ows-rank-focus').selectOption('ADD');assert((await page.locator('#ows-chart').innerText()).includes('Top additions'));
   await page.locator('#ows-chart [data-oir-strike]').first().click();assert.equal(new URL(page.url()).pathname,'/live');
   await page.locator('#ows-rank-atm').click();assert((await page.locator('#ows-chart .oir-atm').innerText()).includes('24,000'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'live document overflow');
   await page.screenshot({path:'oi-ranked-ladder-artifacts/live-'+width+'-synthetic.png',fullPage:true});
   await page.evaluate(()=>{clearInterval((window as any).__rankTick);(window as any).studio.update(null);});assert.equal(await page.locator('#ows-chart .oir-table').count(),0);
   await page.goto(base+'/archive');await page.locator('#ar-oi-output .oir-table').waitFor();
   await page.locator('#ar-oi-window').selectOption('OPEN');await page.locator('#ar-oi-focus').selectOption('SHED');
   assert((await page.locator('#ar-oi-output').innerText()).includes('Top shedding'));
   assert((await page.locator('#ar-oi-output').innerText()).includes('publication time unavailable'));
   await page.locator('#ar-oi-band').selectOption('3');assert.equal(await page.locator('#ar-oi-output tbody tr').count(),7);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'recorded document overflow');
   await page.screenshot({path:'oi-ranked-ladder-artifacts/recorded-'+width+'-synthetic.png',fullPage:true});
   await page.locator('#ar-reset').click();assert(!(await page.locator('#ar-oi-output').innerText()).includes('15:40:00'));
   assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 console.log('OI ranked ladder LIVE + RECORDED synthetic 360/390/1280 browser acceptance PASS');
}finally{await browser?.close();server.close();}
