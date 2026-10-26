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
 for(const [name,width,height] of [['mobile',390,844],['small-mobile',360,780],['short-mobile',390,667],['laptop',1024,768],['desktop',1440,900],['reference',1024,1536]] as const){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  try{
   const page=await context.newPage(),errors:string[]=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
   const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});
   assert.equal(response?.status(),200);
   await page.locator('#rd-shell').waitFor({state:'visible',timeout:15000});
   const screen=await page.evaluate(()=>{const page=document.getElementById('rd-page')!,viewport=document.getElementById('rd-viewport')!,p=page.getBoundingClientRect(),v=viewport.getBoundingClientRect();return {height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,page:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},viewport:{left:v.left,right:v.right,top:v.top,bottom:v.bottom},sections:document.querySelectorAll('#rd-page .rd-section').length,probability:/probability/i.test(page.textContent||'')};});
   assert.equal(screen.sections,7,name+' must show all seven full table sections');
   assert.equal(screen.probability,false,'the probability factor must be absent');
   assert(screen.scroll<=screen.height+2,name+' Fit page must not require document scrolling: '+JSON.stringify(screen));
   assert(screen.scrollWidth<=screen.width+2,name+' no horizontal document scroll');
   assert(screen.page.left>=screen.viewport.left-1&&screen.page.right<=screen.viewport.right+1&&screen.page.top>=screen.viewport.top-1&&screen.page.bottom<=screen.viewport.bottom+1,name+' the complete reference page must fit: '+JSON.stringify(screen));
   const clippedHeaders=await page.evaluate(()=>Array.from(document.querySelectorAll('#rd-page table')).filter(table=>{const last=table.querySelector('thead th:last-child');return last&&last.getBoundingClientRect().right>table.closest('.rd-section')!.getBoundingClientRect().right+1;}).length);
   assert.equal(clippedHeaders,0,name+' full table columns must remain visible');
   const premiumHeads=await page.locator('#rd-premium-table th').allTextContents();
   for(const h of ['Type','Strike','LTP','Chg','%','OI','OI Δ','Vol','Spread','IV','Delta','PDH','PDC','PDL','Trend','Note'])assert(premiumHeads.includes(h),'full premium column '+h);
   await page.screenshot({path:'pr800-mobile-ui-artifacts/'+name+'-reference-data-page.png',fullPage:false,timeout:15000});
   await page.locator('[data-rd-fit="ACTUAL"]').click();assert.equal(await page.locator('#rd-viewport').getAttribute('data-scale'),'1');
   await page.locator('[data-rd-fit="PAGE"]').click();
   const levels=await page.locator('#os-futures').elementHandle();
   await page.locator('[data-rd-open="os-futures"]').first().click();
   assert.equal(await page.locator('#os-screen-detail').evaluate((el:any)=>el.open),true);
   assert.equal(await page.locator('#os-screen-detail-body>#os-futures').count(),1);
   assert.equal(await levels?.evaluate((el:any)=>el===document.getElementById('os-futures')),true,'detail must preserve the same source DOM node');
   await page.locator('#os-screen-close').click();
   assert.equal(await page.locator('#os-dashboard #os-futures').count(),1,'closing restores the original source panel');
   await page.locator('[data-rd-open="os-walls"]').first().click();
   assert.equal(await page.locator('#os-screen-detail-body>#os-pcr-strip').count(),1,'PCR detail must preserve primary recorded/live PCR evidence');
   assert.equal(await page.locator('#os-screen-detail-body>#os-walls').count(),1);
   await page.locator('#os-screen-close').click();
   assert.equal(await page.locator('#os-dashboard #os-pcr-strip').count(),1);
   await page.locator('#op-research-open-data').click();
   assert.equal(await page.locator('#os-screen-detail-body>#mb-tools').count(),1);
   assert.equal(await page.locator('#recorded-replay').evaluate((el:any)=>el.open),true);
   await page.locator('#os-screen-close').click();
   assert.equal(await page.locator('#market-book>#mb-tools').count(),1);
   // Exercise source revocation without inventing market quotes or changing a source gate.
   await page.evaluate(()=>{const el=document.getElementById('os-future-response')!;(window as any).__screenOriginal=el.innerHTML;el.innerHTML='<table><tbody><tr><td>TEST_SOURCE_ROW</td><td>TEST_SOURCE_VALUE</td></tr></tbody></table>';});
   await page.waitForFunction(()=>document.getElementById('rd-levels-table')?.textContent?.includes('TEST_SOURCE_VALUE'));
   await page.evaluate(()=>{document.getElementById('os-future-response')!.innerHTML=(window as any).__screenOriginal;delete (window as any).__screenOriginal;});
   await page.waitForFunction(()=>!document.getElementById('rd-levels-table')?.textContent?.includes('TEST_SOURCE_VALUE'));
   await page.locator('#rd-source-tables').click();
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
