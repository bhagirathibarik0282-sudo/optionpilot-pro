/** Offline Chromium acceptance: deterministic test observations, no broker or DB. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
const dates=['2026-10-28','2026-10-29','2026-10-30'];
function replay(symbol:string,date:string){const market=[0,3,6].map(n=>({symbol,minute_bucket:new Date(Date.parse(date+'T03:45:00Z')+n*60000).toISOString(),truth_verdict:'TRUE',spot_ltp:23000+n,future_ltp:23100+n,future_basis:100,india_vix:12,pdh:23010,pdl:22990,spot_prev_close:22995}));return {ok:true,market,options:market.flatMap(r=>['CE','PE'].map(option_type=>({...r,expiry:'2026-11-03',strike:23000,option_type,ltp:100+(option_type==='CE'?1:-1)*(r.spot_ltp-23000),oi:1000,pdh:110,pdl:90}))),chain:market.map(r=>({...r,expiry:'2026-11-03',calculation_version:'STORAGE_V3_PHASE1',full_chain_oi_pcr:1.2+(r.spot_ltp-23000)/1000,full_pcr_source:'Exact archived full-chain source'})),canonical:[]};}
const html=renderBusinessDashboardV1Html({});
const server=createServer((req,res)=>{const u=new URL(req.url||'/','http://localhost');res.setHeader('Cache-Control','no-store');if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}res.setHeader('Content-Type','application/json');if(u.pathname==='/api/research/h1-theory-dates'){res.end(JSON.stringify({ok:true,dates:dates.map(tradeDate=>({tradeDate}))}));return;}if(u.pathname==='/api/research/h1-replay'){res.end(JSON.stringify(replay(u.searchParams.get('symbol')!,u.searchParams.get('date')!)));return;}res.statusCode=503;res.end(JSON.stringify({ok:false,error:'OFFLINE_TEST_SOURCE_UNAVAILABLE'}));});
let browser:any;try{server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
for(const width of [390,1440]){const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage(),errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.stack||e.message));await page.route('**/*',(r:any)=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:'+port);await page.waitForFunction(()=>document.getElementById('dr-date')?.querySelectorAll('option').length===3);await page.waitForFunction(()=>!document.getElementById('mb-load-status')?.textContent?.includes('Loading saved records'));
await page.locator('#rd-replay-link').click();await page.waitForFunction(()=>document.getElementById('dr-status')?.textContent?.includes('09:15:00'));assert(await page.locator('#dr-play').isVisible(),'controls stay in main dashboard');assert.equal(new URL(page.url()).pathname,'/');assert((await page.locator('#rd-levels-table').innerText()).includes('23,000'));assert(!(await page.locator('#rd-levels-table').innerText()).includes('23,006'));assert((await page.locator('#rd-pcr-table').innerText()).includes('1.2000'));assert(!(await page.locator('#rd-pcr-table').innerText()).includes('1.2060'));
await page.locator('#dr-next').click();await page.waitForFunction(()=>document.getElementById('rd-levels-table')?.textContent?.includes('23,003'));assert((await page.locator('#rd-pcr-table').innerText()).includes('1.2030'));await page.locator('#dr-prev').click();await page.waitForFunction(()=>!document.getElementById('rd-levels-table')?.textContent?.includes('23,003'));
await page.locator('#dr-3').click();await page.waitForFunction(()=>document.getElementById('dr-status')?.textContent?.includes('2026-10-28')&&document.getElementById('dr-status')?.textContent?.includes('Playing'));await page.locator('#dr-speed').selectOption('10');await page.waitForFunction(()=>document.getElementById('dr-status')?.textContent?.includes('day 3 / 3')&&document.getElementById('dr-status')?.textContent?.includes('Paused'));assert((await page.locator('#rd-levels-table').innerText()).includes('23,006'));
await page.locator('#dr-reset').click();await page.waitForFunction(()=>document.getElementById('dr-status')?.textContent?.includes('2026-10-28')&&document.getElementById('dr-status')?.textContent?.includes('09:15:00'));
await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#op-chapter-links [data-op-group="1"]')!.click());
await page.waitForFunction(()=>!document.getElementById('op-premium-workspace')?.hidden);
assert((await page.locator('#pw-status').innerText()).includes('RECORDED'));
await page.locator('#dr-next').click();await page.waitForFunction(()=>document.getElementById('pw-status')?.textContent?.includes('09:18:00'));
await page.locator('#pw-time-prev').click();await page.waitForFunction(()=>document.getElementById('dr-status')?.textContent?.includes('09:15:00'));
await page.locator('#pw-time-next').click();await page.waitForFunction(()=>document.getElementById('dr-status')?.textContent?.includes('09:18:00'));
await page.evaluate(()=>window.dispatchEvent(new CustomEvent('optionpilot:live-context',{detail:{connected:false,connectionState:'CLOSED'}})));
assert((await page.locator('#pw-status').innerText()).includes('RECORDED'));
await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#op-chapter-links [data-op-group="3"]')!.click());
assert((await page.locator('#dr-status').innerText()).includes('09:18:00'),'OI chapter must preserve shared cursor');
assert(await page.locator('#ows-replay-panel').isVisible());
await page.evaluate(()=>document.querySelector<HTMLButtonElement>('#op-chapter-links [data-op-group="0"]')!.click());
await page.waitForFunction(()=>document.body.dataset.opScreen==='reference');
assert((await page.locator('#rd-levels-table').innerText()).includes('23,003'));
await page.locator('#dashboard-replay summary').click();
await page.screenshot({path:'/tmp/unified-replay-'+width+'.png'});assert.deepEqual(errors,[],'no browser errors: '+errors.join('\n'));console.log('PASS main-dashboard replay, '+width+'px, dates/seek/back/reset/3-day playback');await context.close();}
}finally{await browser?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
