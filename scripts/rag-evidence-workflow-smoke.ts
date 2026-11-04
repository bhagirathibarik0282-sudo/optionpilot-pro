/** Real mobile browser over a frozen production projection, never a live-data claim. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {Hono} from 'hono';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {renderRecordedDashboard} from '../recorded-dashboard-view.js';
import {mountRagEventEvidenceRoute,buildRagPremiumSnapshot} from '../rag-event-evidence.js';
import {mountSameDteHistoryRoute,readSameDteHistory} from '../rag-same-dte-history-http.js';

const fixture=JSON.parse(await readFile(new URL('../test/fixtures/rag-minute-access-production-20261104.json',import.meta.url),'utf8')).replay;
const unavailable:any={ok:false,request:null};
const requests:string[]=[];
const app=new Hono();
mountRagEventEvidenceRoute(app,async r=>buildRagPremiumSnapshot(r,fixture,unavailable));
mountSameDteHistoryRoute(app,q=>readSameDteHistory(q,async()=>fixture,async()=>({ok:true,dates:[]} as any)));
const compact=(rows:any[])=>{const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];return {columns,rows:rows.map(r=>columns.map(k=>r[k]??null))};};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url!,'http://local');
  if(url.pathname==='/front'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(renderBusinessDashboardV1Html({} as any));return;}
  if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(renderRecordedDashboard());return;}
  if(url.pathname==='/api/research/recorded-dashboard/dates'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,dates:[{symbol:'NIFTY',tradeDate:'2026-11-04',markerCount:4}]}));return;}
  if(url.pathname==='/api/research/recorded-dashboard/replay'){
   const from=url.searchParams.get('from')!,to=url.searchParams.get('to')!;
   const filter=(rows:any[])=>rows.filter(r=>{const time=new Date(Date.parse(r.minute_bucket)+19800000).toISOString().slice(11,16);return time>=from&&time<=to;});
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,market:compact(filter(fixture.market)),options:compact(filter(fixture.options)),chain:compact([])}));return;
  }
  if(url.pathname.startsWith('/api/research/rag-')){requests.push(req.url!);const result=await app.request(req.url!.replace('/api/research',''));res.writeHead(result.status,{'Content-Type':'application/json'});res.end(await result.text());return;}
  res.writeHead(404);res.end();
 }catch(error){res.writeHead(500);res.end(String(error));}
});
let browser:any;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();assert(addr&&typeof addr!=='string');
 const base='http://127.0.0.1:'+addr.port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 await mkdir('pr800-mobile-ui-artifacts',{recursive:true});
 for(const width of [360,390]){
  const page=await browser.newPage({viewport:{width,height:844},serviceWorkers:'block'});const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message));
  await page.route('**/*',(r:any)=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('clock')?.textContent?.includes('14:31:00'));
  const before=requests.length;await page.locator('[data-ar-evidence="23900|CE"]').click();
  await page.waitForFunction(()=>document.getElementById('rag-result')?.textContent?.includes('162.65'));
  assert.equal(requests.length,before+1);assert.equal(await page.locator('#rag-time').inputValue(),'14:31');assert.equal(await page.locator('#rag-expiry').inputValue(),'2026-11-09');
  assert.equal(await page.locator('#rag-selection-details').getAttribute('open'),null);assert.match(await page.locator('#rag-result').innerText(),/-10.20/);
  assert.match(await page.locator('#rag-selection-summary').innerText(),/23900 CE/);assert.equal(new URL(page.url()).pathname,'/');
  await page.locator('#rag-after').click();await page.waitForFunction(()=>document.getElementById('rag-status')?.textContent?.includes('2026-11-04'));
  assert.equal(new URL(requests.at(-1)!,base).searchParams.get('includeOutcomes'),'true');
  await page.locator('#rag-history').click();await page.waitForFunction(()=>document.getElementById('rag-status')?.textContent?.includes('historical comparison'));
  assert.match(requests.at(-1)!,/rag-same-dte-history/);assert.equal(new URL(requests.at(-1)!,base).searchParams.get('time'),'14:31');
  const count=requests.length;await page.locator('#ar-prev').click();assert.equal(await page.locator('#rag-result').innerText(),'');assert.equal(await page.locator('#rag-strike').inputValue(),'');
  await page.locator('#rag-now').click();assert.equal(requests.length,count,'cursor invalidation cannot reuse the old identity');
  await page.locator('[data-ar-evidence="23900|PE"]').click();await page.waitForFunction(()=>document.getElementById('rag-result')?.textContent?.includes('160.30'));
  assert.equal(await page.locator('#rag-time').inputValue(),'14:30');assert.equal(await page.locator('#rag-side').inputValue(),'PE');
  assert.equal(new URL(requests.at(-1)!,base).searchParams.has('includeOutcomes'),false);
  await page.locator('#rag-selection-details > summary').click();await page.locator('#rag-time').fill('15:40');await page.locator('#rag-selection-details > summary').click();
  const invalidCount=requests.length;await page.locator('#rag-now').click();assert.equal(requests.length,invalidCount);assert.equal(await page.locator('#rag-selection-details').getAttribute('open'),'');assert.match(await page.locator('#rag-status').innerText(),/09:15–15:30/);
  await page.locator('#rag-time').fill('09:15');await page.locator('#rag-selection-details > summary').click();await page.locator('#rag-history').click();assert.equal(requests.length,invalidCount);assert.equal(await page.locator('#rag-selection-details').getAttribute('open'),'');
  await page.goto(base+'/front',{waitUntil:'domcontentloaded'});await page.locator('#rd-shell').waitFor({state:'visible'});
  await page.locator('#rd-source-tabs [data-rd-source="RECORDED"]').click();
  await page.evaluate(()=>{
   const target=document.getElementById('os-premium-table')!;
   const heads=['Type','Strike','Expiry','LTP ₹','Status','Evidence'];const tr=document.createElement('tr');
   for(const value of ['CE','23900','2026-11-09','162.65','RECORDED','']){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}
   const button=document.createElement('button');button.textContent='Evidence';button.dataset.osEvidence=JSON.stringify({symbol:'NIFTY',date:'2026-11-04',expiry:'2026-11-09',strike:23900,side:'CE',time:'14:31',lookback:3});tr.lastElementChild!.appendChild(button);
   const table=document.createElement('table');const header=document.createElement('thead');const row=document.createElement('tr');for(const h of heads){const th=document.createElement('th');th.textContent=h;row.appendChild(th);}header.appendChild(row);table.appendChild(header);const body=document.createElement('tbody');body.appendChild(tr);table.appendChild(body);target.replaceChildren(table);
  });
  await page.locator('#rd-hub-tabs [data-rd-hub="PREMIUM"]').click();
  const frontCount=requests.length;await page.locator('#rd-premium-table [data-os-evidence]').click();
  await page.waitForFunction(()=>document.getElementById('rag-result')?.textContent?.includes('162.65'));
  assert.equal(requests.length,frontCount+1);assert.equal(await page.locator('#os-screen-detail').getAttribute('open'),'');assert.equal(new URL(page.url()).pathname,'/front');
  assert.match(await page.locator('#rag-selection-summary').innerText(),/23900 CE/);
  assert.deepEqual(errors,[]);await page.screenshot({path:`pr800-mobile-ui-artifacts/rag-recorded-workflow-${width}.png`,fullPage:true});await page.close();
 }
 console.log('RAG_RECORDED_WORKFLOW_360_390_PASS: frozen production projection; same-page row/response/actions/cursor invalidation');
}finally{await browser?.close();server.close();await once(server,'close');}
