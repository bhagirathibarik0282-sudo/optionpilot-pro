import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {withDashboardReading} from '../dashboard-reading-layout.js';
test('reading decoration preserves recorded values and existing controls, and is idempotent',()=>{
 const body='<table><thead><tr><th>PCR</th></tr></thead><tbody><tr><td>1.023456</td></tr></tbody></table><button id="refresh">Refresh</button><script>const actual="UNCHANGED";</script>';
 const html='<html><head><title>Dashboard</title></head><body>'+body+'</body></html>',result=withDashboardReading(html);
 assert(result.includes(body));assert.equal(withDashboardReading(result),result);assert.equal((result.match(/id="op-reading-tools"/g)||[]).length,1);
 assert.equal(withDashboardReading('{"spot":22433.7}'),'{"spot":22433.7}');
});
test('serialized installer restores supported preferences and works when device storage is blocked',()=>{
 for(const blocked of [false,true]){
  const size:any={value:'comfortable'},tables:any={value:'cards'},body:any={dataset:{},querySelectorAll:()=>[],closest:()=>null};
  const ctx:any={window:{localStorage:{getItem:()=>'{"size":"large","tables":"wide"}',setItem:()=>{if(blocked)throw Error('blocked');}}},document:{body,querySelectorAll:()=>[],getElementById:(id:string)=>id==='op-reading-size'?size:tables}};
  vm.createContext(ctx);const html=withDashboardReading('<html><head></head><body></body></html>');const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];vm.runInContext(script,ctx);
  assert.equal(body.dataset.opReading,'large');assert.equal(body.dataset.opTables,'wide');size.value='comfortable';tables.value='cards';size.onchange();assert.equal(body.dataset.opReading,'comfortable');assert.equal(body.dataset.opTables,'cards');
 }
});
test('failed news/holiday HTTP responses cannot replace lists with error objects or break rendering',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 for(const [fn,variable]of [['loadNews','newsData'],['loadHolidays','holidaysData']]){
  const code=source.match(new RegExp('async function '+fn+'\\(\\) \\{[\\s\\S]*?\\n    \\}'))![0];let good=false,updates=0;
  const ctx:any={console:{error(){}},fetch:async()=>({ok:good,json:async()=>good?[]:{error:'unavailable'}}),updateUI:()=>updates++};vm.createContext(ctx);
  vm.runInContext('let '+variable+'=[{prior:true}];'+code+';globalThis.run='+fn+';globalThis.read=()=>'+variable,ctx);
  await ctx.run();assert.equal(ctx.read().length,1);assert.equal(ctx.read()[0].prior,true);assert.equal(updates,0);
  good=true;await ctx.run();assert.equal(ctx.read().length,0);assert.equal(updates,1);
 }
});
