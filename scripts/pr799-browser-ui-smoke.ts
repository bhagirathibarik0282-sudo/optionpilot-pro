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
   const watchEntry=page.getByRole('button',{name:'Watch · Live / Replay',exact:true});
   await watchEntry.click();
   const watchDialog=page.locator('#os-screen-detail');
   const directWatch=watchDialog.locator('#mb-live-watch');
   assert.equal(await directWatch.isVisible(),true);
   assert.equal(await directWatch.getByLabel('Source').inputValue(),'Live');
   const participation=directWatch.locator('#mb-watch-participation');
   assert.equal(await participation.isVisible(),false);
   // Exercise the production renderer with a local, deterministic quote event.
   await directWatch.getByLabel('Metrics').selectOption('spot');
   for(const [index,names] of [
    ['BANKNIFTY',['PSU Bank','HDFC Bank','ICICI Bank','Axis Bank','Kotak Bank','SBI']],
    ['NIFTY',['HDFC Bank','Reliance','Nifty IT','Smallcap 100','Midcap 100']],
    ['SENSEX',['HDFC Bank','Reliance','Nifty IT','Smallcap 100','Midcap 100']],
   ] as const){
    await directWatch.locator('#mb-watch-index').selectOption(index);
    assert.equal(await participation.isVisible(),true);
    const proof=await page.evaluate(()=>{
    const serverTime='2026-11-23T06:30:00.000Z';
    const quotes=[
     ['NIFTY PSU BANK','SECTOR',-8],['HDFCBANK','STOCK',-1],['ICICIBANK','STOCK',2],
     ['AXISBANK','STOCK',-3],['KOTAKBANK','STOCK',0],['SBIN','STOCK',4],
     ['RELIANCE','STOCK',8],['NIFTY IT','SECTOR',-2],['NIFTY SMLCAP 100','SECTOR',0],['NIFTY MIDCAP 100','SECTOR',1]
    ].map(([label,role,move])=>({identity:{label,role},price:100+Number(move),pdc:100,observedAt:serverTime,receivedAt:serverTime,state:'LIVE'}));
    const indices=['NIFTY','BANKNIFTY','SENSEX'].map(symbol=>({symbol,expiry:'2026-11-26',expiries:['2026-11-26']}));
    window.dispatchEvent(new CustomEvent('optionpilot:live-context',{detail:{
     connected:true,source:'KITE_WEBSOCKET_FULL',serverTime,snapshot:{runtimeId:'mobile-smoke',tradeDate:'2026-11-23',asOf:serverTime,indices,participation:quotes}
    }}));
    const panel=document.querySelector('#mb-watch-participation')!;
    const tiles=[...panel.querySelectorAll('.mb-watch-instrument')];
    const names=tiles.map(el=>el.querySelector('span')!.textContent);
    const values=tiles.map(el=>el.querySelector('strong')!);
    const fits=tiles.every((element,i)=>{
     const name=element.querySelector('span')!,value=values[i];
     const a=name.getBoundingClientRect(),b=value.getBoundingClientRect(),tile=element.getBoundingClientRect();
     return a.width>0&&b.width>0&&a.right<=b.left&&b.right<=tile.right+1&&tile.right<=window.innerWidth+1&&
      name.scrollWidth<=name.clientWidth+1&&value.scrollWidth<=value.clientWidth+1;
    });
    return {names,values:values.map(el=>el.textContent),text:panel.textContent??'',fits,
     colorCount:new Set(values.map(value=>getComputedStyle(value).color)).size};
   });
    assert.deepEqual(proof.names,[...names]);
    assert.equal(proof.values.filter(v=>v&&/^[+-]?[0-9]+\.[0-9]{2}%$/.test(v)).length,names.length,proof.text);
    assert.match(proof.text,/Mixed/);
    assert.equal(proof.fits,true,label+' '+index+': clipped label or percentage');
    assert.equal(proof.colorCount,3,label+' '+index+': positive, negative and flat colours');
   }
   await directWatch.locator('#mb-watch-index').selectOption('ALL');
   assert.equal(await participation.isVisible(),false);
   await directWatch.getByLabel('Source').selectOption('Replay');
   assert.equal(await directWatch.getByLabel('Recorded date').isVisible(),true);
   await watchDialog.locator('#os-screen-close').click();
   assert.equal(await watchDialog.isVisible(),false);
   assert.equal(await watchEntry.evaluate(el=>document.activeElement===el),true);
   await page.locator('#rd-source-tables').click();
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
   const watch=page.locator('#mb-live-watch');
   await watch.locator('summary').click();
   await watch.getByLabel('Metrics').selectOption('spot');
   assert.deepEqual(await watch.locator('thead th').allTextContents(),['IST','NIFTY','BANKNIFTY','SENSEX']);
   await watch.getByLabel('Metrics').selectOption('custom');
   await watch.getByLabel('Full CE OI',{exact:true}).check();
   assert.equal(await watch.getByLabel('Full CE OI',{exact:true}).isChecked(),true);
   assert.equal(await watch.getByLabel('Recorded date').isVisible(),true);
   await watch.getByLabel('Source').selectOption('Live');
   assert.equal(await watch.getByLabel('Recorded date').isVisible(),false);
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
