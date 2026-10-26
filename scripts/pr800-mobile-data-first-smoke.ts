/** PR800 isolated real-Chromium mobile regression. No broker, DB or invented quotes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';

const html=renderBusinessDashboardV1Html({} as any);
assert(html.includes('id="os-market-radar"'));
const server=createServer((req,res)=>{
 if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;}
 res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
 res.end(JSON.stringify({ok:false,reason:'ISOLATED_UI_NO_MARKET_DATA'}));
});
let browser:any;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert(address&&typeof address!=='string');
 const base='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 await mkdir('pr800-mobile-ui-artifacts',{recursive:true});
 for(const [name,width,height] of [['mobile',390,844],['small-mobile',360,780],['desktop',1440,900],['reference',1024,1536]] as const){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  try{
   const page=await context.newPage(),errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
   const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
   assert.equal(response?.status(),200);
   await page.locator('#os-market-radar').waitFor({state:'visible',timeout:15000});
   const data=await page.evaluate(()=>{
    const rect=(id:string)=>{const n=document.getElementById(id);if(!n)throw Error('missing '+id);return n.getBoundingClientRect().top};
    return {radar:rect('os-market-radar'),pcr:rect('os-pcr-strip'),toolbar:rect('op-research-controls'),memory:rect('os-memory'),
      ladder:rect('os-premium'),advanced:rect('os-reference-settings'),scrollWidth:document.documentElement.scrollWidth,
      viewport:innerWidth,duplicateLogo:getComputedStyle(document.getElementById('op-workspace-nav')!,'::before').display,pcrSourceFont:parseFloat(getComputedStyle(document.querySelector('#os-pcr-strip small')!).fontSize),marketCols:getComputedStyle(document.querySelector('#os-market-radar')!).gridTemplateColumns,
      mobileHero:getComputedStyle(document.querySelector('#op-one-stop .os-hero>div:first-child')!).display};
   });
   assert(data.toolbar<data.radar&&data.radar<data.pcr&&data.pcr<data.ladder&&data.ladder<data.memory&&data.memory<data.advanced,
     name+' expected toolbar and seven primary sections before settings: '+JSON.stringify(data));
   assert.equal(data.duplicateLogo,'none',name+' must have one actual brand header');
   assert(data.pcrSourceFont<=11,name+' legacy mobile font rules must not inflate source labels: '+JSON.stringify(data));
   if(width===1024)await page.screenshot({path:'pr800-mobile-ui-artifacts/reference-no-market-data.png',fullPage:true,timeout:15000});
   if(width===1024)assert(data.memory<1536,'seven primary sections must fit the reference-height reading flow: '+JSON.stringify(data));
   assert(data.scrollWidth<=data.viewport+5,name+' page overflow: '+JSON.stringify(data));
   if(width<=600){
    assert.equal(data.mobileHero,'none','mobile hero must not displace market data');
    assert.equal(data.marketCols.trim().split(/\s+/).length,1,'each mobile index should be readable on one full-width row');
   }
   await page.screenshot({path:'pr800-mobile-ui-artifacts/'+name+'-no-market-data.png',fullPage:true,timeout:15000});
   assert.equal(await page.locator('#os-market-radar').isVisible(),true);
   await page.locator('#os-date-scope [data-os-scope=LAST5]').click();
   assert.equal(await page.locator('#os-date-picker').evaluate((el:any)=>el.open),true);
   await page.locator('#op-research-open-data').click({timeout:10000});
   assert.equal(await page.locator('#recorded-replay').evaluate((el:any)=>el.open),true);
   await page.locator('#mb-chapter').selectOption('0',{timeout:10000});
   assert.deepEqual(errors,[],name+' JS runtime errors');
   console.log('PR800_'+name.toUpperCase()+'_PASS '+JSON.stringify(data));
  }finally{await context.close();}
 }
}finally{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));}
