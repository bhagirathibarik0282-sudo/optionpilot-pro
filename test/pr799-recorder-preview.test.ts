import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPr799RecorderPreview,PR799_PREVIEW_SELECTION} from '../pr799-recorder-preview.js';
const password='test-only-preview-password-32-characters';
const authorization='Basic '+Buffer.from('preview:'+password).toString('base64');
const fixture=()=>({password,state:{date:'2026-10-19',recordedDates:[],current:{},baseline:{},history:{}},
 evidence:{identity:{...PR799_PREVIEW_SELECTION,strike:23150},event:{timeIst:'10:45'}}});
test('all preview pages require credentials; mutations and unrelated endpoints stay unavailable',async()=>{
 const app=createPr799RecorderPreview(fixture());
 for(const path of ['/','/api/research/business-dashboard/view','/api/research/rag-event-context-ladder/view']){
   const response=await app.request(path);assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.equal((await app.request('/',{headers:{authorization:'Basic '+Buffer.from('preview:wrong').toString('base64')}})).status,401);
 assert.equal((await app.request('/',{method:'POST',headers:{authorization}})).status,405);
 assert.equal((await app.request('/api/research/background-quotes',{headers:{authorization}})).status,404);
});
test('bounded expiry applies to recorder and ladder, credentials and TTL must be configured',async()=>{
 assert.throws(()=>createPr799RecorderPreview({...fixture(),password:'short'}));
 assert.throws(()=>createPr799RecorderPreview({...fixture(),ttlMs:600001}));
 let now=0;const app=createPr799RecorderPreview({...fixture(),now:()=>now,ttlMs:10});now=10;
 assert.equal((await app.request('/',{headers:{authorization}})).status,410);
 assert.equal((await app.request('/api/research/rag-event-context-ladder/view',{headers:{authorization}})).status,410);
});
test('fixed route rejects another contract, extra fields and duplicate query parameters before projection',async()=>{
 const app=createPr799RecorderPreview(fixture()),q=new URLSearchParams(PR799_PREVIEW_SELECTION);
 for(const query of [q.toString().replace('side=PE','side=CE'),q+'&extra=1',q+'&side=PE'])
   assert.equal((await app.request('/api/research/rag-event-context-ladder/view?'+query,{headers:{authorization}})).status,422);
 // Matching identity does not bypass the original evidence-admission guards.
 assert.equal((await app.request('/api/research/rag-event-context-ladder/view?'+q,{headers:{authorization}})).status,422);
});
test('preview uses real Recorder code, escaped owned state and a nonce; bootstrap parses as browser JavaScript',async()=>{
 const input=fixture();input.state.history={NIFTY:[{note:'</script><script>bad()</script>'}]} as any;
 const app=createPr799RecorderPreview(input);input.state.date='2099-01-01';
 const response=await app.request('/',{headers:{authorization}});assert.equal(response.status,200);
 const html=await response.text();assert.match(html,/id="rr-rag-ladder"/);assert.match(html,/width=device-width/);
 assert(!html.includes('</script><script>bad()'));assert(!html.includes('2099-01-01'));assert(!html.includes(password));
 const script=html.match(/<script nonce="([^"]+)">([\s\S]*)<\/script>/)!;
 assert(response.headers.get('content-security-policy')?.includes("'nonce-"+script[1]+"'"));
 new vm.Script(script[2]);
});
test('actual serialized Recorder bootstrap opens only its selected exact sample on click',async()=>{
 const input=fixture();const at='2026-10-19T05:15:00.000Z';
 input.state.current={NIFTY:{market:[{symbol:'NIFTY',minute_bucket:at,truth_verdict:'TRUE',spot_ltp:23150}],
   options:[{symbol:'NIFTY',minute_bucket:at,truth_verdict:'TRUE',expiry:'2026-10-19',strike:23150,option_type:'PE',ltp:137.1}],chain:[]}};
 const html=await (await createPr799RecorderPreview(input).request('/',{headers:{authorization}})).text();
 const nodes=new Map<string,any>();for(const m of html.matchAll(/\bid="([^"]+)"/g))nodes.set(m[1],{value:'',innerHTML:'',open:true});
 nodes.get('rr-mode').value='LINE';nodes.get('rr-speed').value='1';
 const navigations:string[]=[];
 const context={URLSearchParams,document:{getElementById:(id:string)=>nodes.get(id),addEventListener:()=>{}},
   window:{location:{assign:(url:string)=>navigations.push(url)}},
   setTimeout:()=>{throw new Error('no timer expected without Play');},clearTimeout:()=>{}};
 vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)![1],context);
 assert.equal(navigations.length,0);assert.equal(nodes.get('rr-rag-ladder').disabled,false);
 nodes.get('rr-rag-ladder').onclick();assert.equal(navigations.length,1);
 const url=new URL(navigations[0],'https://preview.invalid');assert.deepEqual(Object.fromEntries(url.searchParams),PR799_PREVIEW_SELECTION);
 nodes.get('rr-rag-side').value='CE';nodes.get('rr-rag-side').onchange();
 assert.equal(nodes.get('rr-rag-ladder').disabled,true);nodes.get('rr-rag-ladder').onclick();assert.equal(navigations.length,1);
});
