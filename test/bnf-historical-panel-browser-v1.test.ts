/**
 * Isolated Chromium interaction smoke. Synthetic data ONLY: do not commit
 * the user's original ledger or source report to a public repository.
 * Run in CI after installing playwright (dev-only) and using runner Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {BNF_HISTORY_PANEL_HTML,BNF_HISTORY_PANEL_CSS,
 deriveBnfHistoricalReview,attachBnfHistoricalSourceAudit,installBnfHistoricalPanel} from '../bnf-historical-evidence-panel-v1.js';

test('real Chromium: local historical JSON import, all dates, source audit, no external requests',async()=>{
 const day='2026-09-01',at=(clock:string)=>day+' '+clock+':00+05:30';
 const dates=Array.from({length:35},(_,i)=>new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10));
 const fixture={
  project:'SYNTHETIC_TEST_ONLY',strategy_id:'BROWSER_FIXTURE',
  parameters:{symbol:'BANKNIFTY',quantity:60,transaction_cost_per_trade_rs:75,max_hold_sec:1200},
  summary_metrics:{total_days:35,active_days:1,total_trades:2,total_net_profit_rs:450},
  daily_ledger:dates.map((d,i)=>({trade_date:d,trades:i?0:2,wins:i?0:1,net_2lot_rs:i?0:450,feed_type:'Partial'})),
  trade_by_trade_log:[
   {trade_id:1,trade_date:day,strike:55000,option_type:'PE',signal_ts_ist:at('09:20'),entry_ts_ist:at('09:22'),
    exit_ts_ist:at('09:30'),signal_ltp:110,entry_ltp:100,exit_ltp:132,pnl_pts:32,net_2lot_rs:1845},
   {trade_id:2,trade_date:day,strike:55100,option_type:'PE',signal_ts_ist:at('09:20'),entry_ts_ist:at('09:22'),
    exit_ts_ist:at('09:33'),signal_ltp:130,entry_ltp:120,exit_ltp:98,pnl_pts:-22,net_2lot_rs:-1395}
  ]};
 const original=Buffer.from(JSON.stringify(fixture));
 const audit={
  schema:'OPTIONPILOT_BNF_35DAY_DRIVE_AUDIT_COMPARISON_V1',
  source_ledger_sha256:createHash('sha256').update(original).digest('hex'),
  counts:{exit_price_match:1,exit_price_mismatch:1},
  per_traded_day:[{date:day,trades_in_report:2,source_option_minute_count:177,
    minute_denominator:375,all_three_match_common_expiry_count:1}],
  per_trade:[
   {trade_id:1,date:day,strike:55000,option_type:'PE',reported_exit_ltp:132,archived_exit_ltp:132,
    exit_price_status:'MATCH',signal_and_entry_match_codes:'M / M',inferred_expiry_from_source_match:'2026-09-29'},
   {trade_id:2,date:day,strike:55100,option_type:'PE',reported_exit_ltp:98,archived_exit_ltp:97.5,
    exit_price_status:'PRICE_MISMATCH',signal_and_entry_match_codes:'M / M',inferred_expiry_from_source_match:'2026-09-29'}
  ]};
 const script='const __name=(fn,_name)=>fn;\n'+'const deriveBnfHistoricalReview='+deriveBnfHistoricalReview.toString()+';\n'+
  'const attachBnfHistoricalSourceAudit='+attachBnfHistoricalSourceAudit.toString()+';\n'+
  '('+installBnfHistoricalPanel.toString()+')();';
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+BNF_HISTORY_PANEL_CSS+
  '</style></head><body>'+BNF_HISTORY_PANEL_HTML+'<script>'+script+'</script></body></html>';
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser:any;
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('LOCAL_TEST_ADDRESS_INVALID');
  const base='http://127.0.0.1:'+address.port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const page=await browser.newPage();
  const unexpected:string[]=[];
  page.on('request',r=>{if(!r.url().startsWith(base))unexpected.push(r.url());});
  page.on('pageerror',e=>unexpected.push('JS_ERROR:'+e.message));
  await page.goto(base,{waitUntil:'load'});
  assert.equal(await page.locator('#bnf-historical-evidence').count(),1);
  await page.locator('#bnf-historical-evidence > summary').click(); // Expand the actual user-visible panel before checking innerText.
  await page.locator('#bnf-history-file').setInputFiles({name:'synthetic-ledger.json',mimeType:'application/json',buffer:original});
  try{
   await page.waitForFunction(()=>document.querySelector('#bnf-history-status')?.textContent?.includes('HISTORICAL BACKTEST'),null,{timeout:8000});
  }catch(error){
   const current=await page.locator('#bnf-history-status').innerText();
   throw Error('HISTORICAL_IMPORT_FAILED: status='+current+'; page errors='+unexpected.join(' | ')+'; cause='+String(error));
  }
  assert.match(await page.locator('#bnf-history-summary').innerText(),/₹450/);
  assert.match(await page.locator('#bnf-history-summary').innerText(),/35 selected dates/);
  assert.equal(await page.locator('#bnf-history-days tbody tr').count(),35);
  assert.match(await page.locator('#bnf-history-trades').innerText(),/Source-matched exit LTP/);
  await page.locator('#bnf-history-audit-file').setInputFiles({
   name:'synthetic-source-audit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(audit))});
  await page.waitForFunction(()=>document.querySelector('#bnf-history-status')?.textContent?.includes('Local historical audit matched'));
  const after=await page.locator('#bnf-history-trades').innerText();
  assert.match(after,/PRICE_MISMATCH/);
  assert.match(after,/97\.5/);
  assert.match(await page.locator('#bnf-history-summary').innerText(),/1 matching \/ 1 mismatched/);
  // Reject unrelated audit hashes without replacing the existing rendered evidence.
  const tampered=structuredClone(audit);tampered.source_ledger_sha256='000000';
  await page.locator('#bnf-history-audit-file').setInputFiles({
   name:'wrong-hash.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(tampered))});
  await page.waitForFunction(()=>document.querySelector('#bnf-history-status')?.textContent?.includes('Audit rejected'));
  assert.match(await page.locator('#bnf-history-trades').innerText(),/PRICE_MISMATCH/);
  assert.deepEqual(unexpected,[],'panel made an external request or threw JS errors');
 }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});