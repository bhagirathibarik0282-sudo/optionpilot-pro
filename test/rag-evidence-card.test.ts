import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Hono} from 'hono';
import {parseRagQuestion} from '../rag-question.js';
import {RAG_CARD_SCRIPT,RAG_CARD_HTML,renderRagEvidencePage} from '../rag-evidence-card.js';
import {renderBusinessDashboardV1Html} from '../business-dashboard-v1-view.js';
import {researchRouter} from '../research-router.js';
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
 for(const id of ['form','question','symbol','date','expiry','strike','side','time','asof','outcomes','search','extract','example','clear','status','result']){
  nodes.set('rag-'+id,{value:'',checked:false,disabled:false,innerHTML:'',textContent:'',listeners:{} as any,
    addEventListener(type:string,fn:Function){this.listeners[type]=fn;},reset(){for(const n of nodes.values()){n.value='';n.checked=false;}}});
 }
 const requests:string[]=[];const context=vm.createContext({URLSearchParams,AbortController,setTimeout,clearTimeout,document:{getElementById:(id:string)=>nodes.get(id)},fetch:async(url:string)=>{requests.push(url);return fetcher(url);}});
 vm.runInContext(RAG_CARD_SCRIPT,context);const node=(id:string)=>nodes.get('rag-'+id);
 const submit=()=>node('form').onsubmit({preventDefault(){}});
 return {node,requests,submit};
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
