/** Isolated PR799 Chromium smoke. No broker, database, or live quotes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';

const html=renderBusinessDashboardV1Html({} as any);
assert(html.includes('id="market-book"'));
const server=createServer((req,res)=>{
 if(req.url==='/'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(html);return;
 }
 res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
 res.end(JSON.stringify({ok:false,reason:'SMOKE_NO_MARKET_DATA'}));
});
let browser:any;
try {
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const addr=server.address();assert(addr&&typeof addr!=='string');
 const origin='http://127.0.0.1:'+addr.port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await mkdir('pr799-browser-smoke-artifacts',{recursive:true});
 for(const [label,width,height] of [['desktop',1440,900],['mobile',390,844]] as const){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  try {
   const page=await context.newPage(),errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort('blockedbyclient'));
   const response=await page.goto(origin,{waitUntil:'domcontentloaded',timeout:20000});
   assert.equal(response?.status(),200);
   await page.locator('#op-command-chapters [data-op-group]').first().waitFor({timeout:15000,state:'attached'});
   assert.equal(await page.locator('#op-command-chapters [data-op-group]').count(),6);
   assert.equal(await page.locator('#mb-chapter option').count(),6);
   await page.locator('#op-research-open-data').click({timeout:10000});
   assert.equal(await page.locator('#mb-tools').evaluate((n:any)=>n.open),true);
   assert.equal(await page.locator('#recorded-replay').evaluate((n:any)=>n.open),true);
   await page.locator('#os-reference-settings>summary').click();
   await page.locator('#op-research-settings').click({timeout:10000});
   assert.equal(await page.locator('#mb-settings').evaluate((n:any)=>n.open),true);
   // The numbered chapter panel is hidden in compact mode: exercise the
   // visible six-destination chapter selector instead of forcing hidden clicks.
   for(let n=0;n<6;n++){
    await page.locator('#mb-chapter').selectOption(String(n),{timeout:10000});
    assert.equal(await page.locator('#mb-chapter').inputValue(),String(n));
   }
   await page.locator('#mb-chapter').selectOption('0',{timeout:10000});
   await page.screenshot({path:'pr799-browser-smoke-artifacts/'+label+'-absence-only.png',fullPage:true,timeout:15000});
   const dimensions=await page.evaluate(()=>({viewport:innerWidth,root:document.documentElement.scrollWidth}));
   assert(dimensions.root<=dimensions.viewport+5,JSON.stringify(dimensions));
   assert.deepEqual(errors,[],label+': uncaught script errors');
   console.log('PR799_'+label.toUpperCase()+'_BROWSER_SMOKE_PASS '+JSON.stringify(dimensions));
  } finally {await context.close();}
 }
 console.log('PR799_ISOLATED_BROWSER_SMOKE_PASS_NO_DB_NO_PRODUCTION');
} finally {
 if(browser)await browser.close();
 await new Promise<void>(resolve=>server.close(()=>resolve()));
}
