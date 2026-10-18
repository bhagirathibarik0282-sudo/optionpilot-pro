import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Hono} from 'hono';
import {parseRagQuestion} from '../rag-question.js';
import {RAG_CARD_SCRIPT,RAG_CARD_HTML,renderRagEvidencePage,renderPremiumResponseEvidence} from '../rag-evidence-card.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {researchRouter} from '../research-router.js';
import {renderSameDteHistory} from '../rag-same-dte-history-view.js';
const question='NIFTY 22300 PE date 2026-10-13 expiry 2026-10-13 time 09:36ରେ କଣ ହେଲା?';
test('extracts exact English identity without expanding expiry or side',()=>{
 const p=parseRagQuestion(question);assert.equal(p.complete,true);assert.deepEqual(p.fields,{symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:'22300',side:'PE',time:'09:36'});
 assert.equal(parseRagQuestion(question.replace('22300','22,300')).fields.strike,'22300');
 assert.equal(parseRagQuestion(question.replace('22300','22,3000')).fields.strike,undefined);
});
test('Odia labels/digits and explicit 12-hour times normalize correctly',()=>{
 const p=parseRagQuestion('SENSEX 71800 PE ତାରିଖ ୧୩/୧୦/୨୦୨୬ ମିଆଦ ୧୫/୧୦/୨୦୨୬ ସମୟ ୧୩:୧୨');
 assert.equal(p.complete,true);assert.equal(p.fields.expiry,'2026-10-15');assert.equal(p.fields.date,'2026-10-13');assert.equal(p.fields.time,'13:12');
 assert.equal(parseRagQuestion('BANK NIFTY 54800 call date 13/10/2026 expiry 27/10/2026 at 2:03 PM').fields.time,'14:03');
});
test('missing and ambiguous fields never silently choose an index, date or side',()=>{
 const missing=parseRagQuestion('What happened today NIFTY?');assert.equal(missing.complete,false);assert.ok(missing.missing.includes('date'));assert.ok(missing.missing.includes('expiry'));
 const both=parseRagQuestion(question+' SENSEX CE');assert.equal(both.complete,false);assert.equal(both.fields.symbol,undefined);assert.equal(both.fields.side,undefined);assert.equal(both.issues.length,2);
 const dates=parseRagQuestion('NIFTY 22300 PE 2026-10-12 2026-10-13 time 09:36');assert.equal(dates.fields.date,undefined);assert.ok(dates.issues.length);
});
function browser(fetcher:(url:string)=>Promise<any>) {
 const nodes=new Map<string,any>();
 for(const id of ['form','kind','lookback','question','symbol','date','expiry','strike','side','time','asof','outcomes','search','extract','example','clear','status','result']){
  nodes.set('rag-'+id,{value:'',checked:false,disabled:false,innerHTML:'',textContent:'',listeners:{} as any,
    addEventListener(type:string,fn:Function){this.listeners[type]=fn;},reset(){for(const n of nodes.values()){n.value='';n.checked=false;}}});
 }
 const events:Record<string,Function>={};nodes.get('rag-form').requestSubmit=()=>nodes.get('rag-form').onsubmit({preventDefault(){}});const requests:string[]=[];const context=vm.createContext({URLSearchParams,AbortController,setTimeout,clearTimeout,window:{addEventListener:(type:string,fn:Function)=>{events[type]=fn;}},document:{getElementById:(id:string)=>nodes.get(id)},fetch:async(url:string)=>{requests.push(url);return fetcher(url);}});
 vm.runInContext(RAG_CARD_SCRIPT,context);const node=(id:string)=>nodes.get('rag-'+id);
 const submit=()=>node('form').onsubmit({preventDefault(){}});
 return {node,requests,submit,events};
}
const success=()=>({ok:true,status:200,json:async()=>({ok:true,identity:{symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:22300,side:'PE',dte:0},
 reference:{sourceDate:'2026-10-12',pdh:73.85,pdl:11.6},event:{availableAt:'2026-10-13T04:06:24Z'},answer:'PE <script>alert(1)</script> PDL loss',
 beforeAndAt:[null,{offset:0,timeIst:'09:36',receiptAt:'2026-10-13T04:06:24Z',pair:{ce:{price:210.65,quoteAt:'2026-10-13T04:06:24Z'},pe:{price:11.2,quoteAt:'2026-10-13T04:06:24Z'}},context:{spot:22486.05,fullPcr:null,vix:14.71,ceWall:22600,peWall:22300}}],
 outcomes:[],cutoff:null,provenance:{selectedEvidenceSha256:'a'.repeat(64)}})});
test('serialized card starts with no request; explicit search uses exact GET and escapes source text',async()=>{
 const b=browser(async()=>success());assert.equal(b.requests.length,0);
 b.node('example').onclick();assert.equal(b.requests.length,0);assert.equal(b.node('expiry').value,'2026-10-13');
 await b.submit();assert.equal(b.requests.length,1);const url=new URL(b.requests[0],'https://example.test');assert.equal(url.pathname,'/api/research/rag-event-evidence');assert.equal(url.searchParams.get('time'),'09:36');assert.equal(url.searchParams.has('includeOutcomes'),false);
 assert.match(b.node('result').innerHTML,/210\.65/);assert.match(b.node('result').innerHTML,/ଅନୁପଲବ୍ଧ/);assert.doesNotMatch(b.node('result').innerHTML,/<script>alert/);assert.match(b.node('result').innerHTML,/&lt;script&gt;/);
 assert.match(b.node('status').textContent,/2026-10-13/);assert.equal(b.node('search').disabled,false);
});
test('missing fields block fetch; extraction clears stale contract fields',async()=>{
 const b=browser(async()=>success());await b.submit();assert.equal(b.requests.length,0);
 b.node('example').onclick();b.node('asof').value='2026-10-13T09:39';b.node('outcomes').checked=true;b.node('question').value='SENSEX PE';b.node('extract').onclick();assert.equal(b.node('strike').value,'');assert.equal(b.node('date').value,'');assert.equal(b.node('asof').value,'');assert.equal(b.node('outcomes').checked,false);assert.match(b.node('status').textContent,/ଆହୁରି/);
 await b.submit();assert.equal(b.requests.length,0);
});
test('changing selection while a request runs suppresses its old answer',async()=>{
 let resolve!:(v:any)=>void;const b=browser(()=>new Promise(r=>resolve=r));b.node('example').onclick();const pending=b.submit();assert.equal(b.node('search').disabled,true);
 b.node('strike').value='22400';b.node('form').listeners.input();resolve(success());await pending;
 assert.equal(b.node('result').innerHTML,'');assert.match(b.node('status').textContent,/Selection ବଦଳିଛି/);assert.equal(b.node('search').disabled,false);
});
test('cutoff/outcomes are explicit; backend blocking and network errors stay visible',async()=>{
 const b=browser(async()=>({ok:false,status:422,json:async()=>({ok:false,reason:'NO_RECONCILED_LEVEL_CROSSING'})}));b.node('example').onclick();b.node('asof').value='2026-10-13T09:39:59';b.node('outcomes').checked=true;
 await b.submit();const params=new URL(b.requests[0],'https://example.test').searchParams;assert.equal(params.get('includeOutcomes'),'true');assert.equal(params.get('asOf'),'2026-10-13T09:39:59');assert.match(b.node('status').textContent,/crossing ମିଳିଲା ନାହିଁ/);assert.equal(b.node('result').innerHTML,'');
 const fail=browser(async()=>{throw Error('connection');});fail.node('example').onclick();await fail.submit();assert.match(fail.node('status').textContent,/Response ପଢ଼ିହେଲା ନାହିଁ/);
});
test('card is in production book and standalone route, without introducing an automatic fetch',async()=>{
 const html=renderBusinessDashboardV1Html({} as any);assert.match(html,/id="rag-evidence-card"/);assert.match(html,/RAG evidence search/);assert.ok(html.includes(RAG_CARD_SCRIPT));
 assert.equal((html.match(/id="rag-evidence-card"/g)||[]).length,1);assert.ok(renderRagEvidencePage().includes('<details open id="rag-evidence-card"'));
 const app=new Hono();app.route('/api/research',researchRouter);const r=await app.request('/api/research/rag-event-evidence/view');assert.equal(r.status,200);assert.match(await r.text(),/id="rag-question"/);
 assert.ok(RAG_CARD_HTML.includes('step="180"'));
});

test('card Ask RAG submits snapshot identity once and invalidation removes old evidence',async()=>{
 const b=browser(async()=>{const res=success();const data=await res.json();return {...res,json:async()=>({...data,reference:null,mode:'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1'})};});
 b.events['optionpilot:rag-selection']({detail:{symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:'22300',side:'PE',time:'09:36',lookback:'15'}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(b.requests.length,1);const p=new URL(b.requests[0],'https://example.test').searchParams;assert.equal(p.get('kind'),'SNAPSHOT');assert.equal(p.get('lookback'),'15');assert.equal(p.get('time'),'09:36');assert.equal(b.node('outcomes').checked,false);
 assert.match(b.node('result').innerHTML,/reference ଅନୁପଲବ୍ଧ/);b.events['optionpilot:rag-invalidate']({});assert.equal(b.node('result').innerHTML,'');
});
test('a new explicit card question supersedes an in-flight answer without a stale-result race',async()=>{
 const resolves:Function[]=[];const b=browser(()=>new Promise(r=>resolves.push(r)));const detail={symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:'22300',side:'PE',time:'09:36'};
 b.events['optionpilot:rag-selection']({detail});b.events['optionpilot:rag-selection']({detail:{...detail,time:'09:39'}});assert.equal(b.requests.length,2);
 resolves[0](success());await new Promise(resolve=>setImmediate(resolve));assert.equal(b.node('result').innerHTML,'');assert.equal(b.node('search').disabled,true);
 resolves[1](success());await new Promise(resolve=>setImmediate(resolve));assert.match(b.node('result').innerHTML,/210.65/);assert.equal(b.node('search').disabled,false);
});

function historySuccess(){
 const point={quoteAt:'2026-09-15T04:06:20Z',receiptAt:'2026-09-15T04:06:24Z',snapshotId:'safe',bucketAt:'2026-09-15T04:06:00Z',price:10};
 const anchor={date:'2026-09-15',expiry:'2026-09-15',strike:23450,side:'CE',calendarDte:0,before:point,at:{...point,price:8.3},premiumChange:-1.7,spotChange:-4,clock:{closeIst:'15:40',rule:'MODEL'}};
 return {ok:true,status:200,json:async()=>({ok:true,anchor,matches:[{...anchor,date:'2026-09-08',expiry:'2026-09-08',strike:23700,premiumChange:3.7,moneynessDifferenceBps:5.6854}],cutoff:'2026-09-15T04:06:24Z',retrieval:{requestedDays:['2026-09-08'],readFailures:[]},provenance:{selectedEvidenceSha256:'b'.repeat(64)},blocked:[]})};
}
test('same-DTE selection uses historical endpoint with explicit cutoff and no future outcomes',async()=>{
 const b=browser(async()=>historySuccess());b.node('example').onclick();b.node('kind').value='HISTORY';b.node('kind').listeners.change();
 assert.equal(b.node('lookback').disabled,true);assert.equal(b.node('outcomes').disabled,true);
 b.node('outcomes').checked=true;b.node('asof').value='2026-10-13T09:36:30';await b.submit();
 const u=new URL(b.requests[0],'https://example.test');assert.equal(u.pathname,'/api/research/rag-same-dte-history');assert.equal(u.searchParams.has('includeOutcomes'),false);assert.equal(u.searchParams.get('lookback'),'3');assert.equal(u.searchParams.get('asOf'),'2026-10-13T09:36:30');
 assert.match(b.node('result').innerHTML,/23700/);assert.match(b.node('result').innerHTML,/09:36 IST/);assert.match(b.node('result').innerHTML,/5\.69 bps/);assert.match(b.node('result').innerHTML,/↓ -1\.70/);assert.match(b.node('result').innerHTML,/↑ \+3\.70/);
 assert.match(b.node('result').innerHTML,/<details><summary>Context/);assert.doesNotMatch(b.node('result').innerHTML,/<details open/);
});
test('switching back from history and Ask RAG restore normal controls',async()=>{
 const b=browser(async()=>success());b.node('kind').value='HISTORY';b.node('kind').listeners.change();
 b.events['optionpilot:rag-selection']({detail:{symbol:'NIFTY',date:'2026-10-13',expiry:'2026-10-13',strike:'22300',side:'PE',time:'09:36',lookback:15}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(b.node('lookback').disabled,false);assert.equal(b.node('outcomes').disabled,false);assert.equal(b.node('lookback').value,'15');
 assert.match(b.requests[0],/rag-event-evidence/);
});
test('historical renderer escapes provenance and keeps unavailable differences missing',async()=>{
 const d:any=await historySuccess().json();d.matches[0].date='<img src=x onerror=alert(1)>';d.matches[0].moneynessDifferenceBps=null;d.matches[0].spotChange=null;d.anchor.at.snapshotId='<script>bad</script>';
 const html=renderSameDteHistory(d);assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/ଅନୁପଲବ୍ଧ/);
});
test('no matching days and read failures remain visible without invented historical rows',async()=>{
 const d:any=await historySuccess().json();d.matches=[];d.retrieval.readFailures=['2026-09-08'];d.blocked=[{date:'2026-09-07',reason:'NO_VERIFIED_SAME_DTE_CLOCK_PAIR'}];
 const html=renderSameDteHistory(d);assert.match(html,/pair ମିଳିଲା ନାହିଁ/);assert.match(html,/Source read failed: 2026-09-08/);assert.equal((html.match(/<tbody><tr>/g)||[]).length,1);assert.doesNotMatch(html,/23700/);
});
test('editing history selection discards an in-flight historical answer',async()=>{
 let resolve!:(v:any)=>void;const b=browser(()=>new Promise(r=>resolve=r));b.node('example').onclick();b.node('kind').value='HISTORY';const pending=b.submit();
 b.node('strike').value='22400';b.node('form').listeners.input();resolve(historySuccess());await pending;assert.equal(b.node('result').innerHTML,'');assert.equal(b.node('search').disabled,false);
});

test('source-backed response is rendered by the actual serialized card, with unknowns and escaped source text',async()=>{
 const b=browser(async()=>{const res=success(),data=await res.json();return {...res,json:async()=>({...data,premiumResponse:{lookbackMinutes:3,status:'PARTIAL',reason:'<img src=x onerror=alert(1)>',clock:{calendarDte:0},before:null,current:{price:11.2,spot:22486.05,bucketAt:'2026-10-13T04:06:00Z'},change:null,evidenceSha256:'b'.repeat(64)}})};});
 b.node('example').onclick();await b.submit();const html=b.node('result').innerHTML;
 assert.match(html,/Recorded premium response/);assert.match(html,/Calendar DTE 0/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/theoretical Delta/);assert.match(html,/11\.20/);assert.match(html,/expiry timestamp/);
 assert.equal(renderPremiumResponseEvidence(null),'');
});
