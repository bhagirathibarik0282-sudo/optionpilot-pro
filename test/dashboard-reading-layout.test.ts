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

test('reading font decoration measures all unmarked text before writing style attributes',()=>{
 const log:string[]=[],attrs=new Map();const elements=[0,1,2].map(i=>({i,childNodes:[{nodeType:3,textContent:'Text'}],closest:()=>null,getAttribute:(name:string)=>attrs.get(i+name),setAttribute:(name:string,value:string)=>{log.push('write'+i);attrs.set(i+name,value);}}));
 const size:any={value:'comfortable'},tables:any={value:'cards'},body:any={dataset:{},closest:()=>null,querySelectorAll:(selector:string)=>selector==='table'?[]:elements};const ctx:any={document:{body,querySelectorAll:()=>[],getElementById:(id:string)=>id==='op-reading-size'?size:tables},window:{localStorage:{getItem:()=>null,setItem(){}},getComputedStyle:(el:any)=>{log.push('read'+el.i);return {fontSize:'12px'};}}};vm.createContext(ctx);const script=[...withDashboardReading('<html><head></head><body></body></html>').matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];vm.runInContext(script,ctx);assert.deepEqual(log,['read0','read1','read2','write0','write1','write2']);
 log.length=0;vm.runInContext(script,ctx);assert.deepEqual(log,[],'already marked text needs no repeated font read/write');
});

test('known live subtree uses explicit readable CSS and does not schedule font-measurement frames',()=>{
 let callback:any,queries=0;const frames:any[]=[];
 class El{isConnected=true;dataset:any={};constructor(readonly live=false){}closest(selector:string){return this.live&&selector==='#dashboard-live'?{}:null;}querySelectorAll(){queries++;return [];}contains(){return false;}}
 const body:any=new El(),size:any={value:'comfortable'},tables:any={value:'cards'};
 const ctx:any={Element:El,MutationObserver:class{constructor(fn:any){callback=fn;}observe(){}},document:{body,querySelectorAll:()=>[],getElementById:(id:string)=>id==='op-reading-size'?size:tables},window:{localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame:(fn:any)=>frames.push(fn)}};
 vm.createContext(ctx);const script=[...withDashboardReading('<html><head></head><body></body></html>').matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];vm.runInContext(script,ctx);queries=0;
 callback([{target:new El(true)}]);assert.equal(frames.length,0);assert.equal(queries,0);
 callback([{target:new El(false)},{target:new El(true)}]);assert.equal(frames.length,1);frames[0]();assert.equal(queries,2,'only the ordinary subtree is decorated');
});

test('notes default to hidden, toggle immediately, and restore across refresh including blocked storage',()=>{
 for(const saved of [null,'{"notes":"show"}','{"notes":"unexpected"}'])for(const blocked of [false,true]){
  const size:any={value:'comfortable'},tables:any={value:'cards'},notes:any={value:'hide'},body:any={dataset:{},querySelectorAll:()=>[],closest:()=>null};let stored:any=null;
  const ctx:any={window:{localStorage:{getItem:()=>saved,setItem:(_k:string,v:string)=>{if(blocked)throw Error('blocked');stored=JSON.parse(v);}}},document:{body,querySelectorAll:()=>[],getElementById:(id:string)=>({'op-reading-size':size,'op-reading-tables':tables,'op-reading-notes':notes}[id])}};
  vm.createContext(ctx);const html=withDashboardReading('<html><head></head><body><p role="status">STALE at 09:18</p><svg id="chart"></svg></body></html>');const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];vm.runInContext(script,ctx);
  assert.equal(body.dataset.opNotes,saved==='{"notes":"show"}'?'show':'hide');notes.value='show';notes.onchange();assert.equal(body.dataset.opNotes,'show');if(!blocked)assert.equal(stored.notes,'show');notes.value='hide';notes.onchange();assert.equal(body.dataset.opNotes,'hide');assert(html.includes('<p role="status">STALE at 09:18</p><svg id="chart"></svg>'));
 }
});
