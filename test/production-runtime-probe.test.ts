import test from 'node:test';
import assert from 'node:assert/strict';
import { productionVerificationPending as productionPending, PRODUCTION_ORIGIN } from './helpers/production-runtime.js';
// Fixture checks must not write a production-readiness summary.
const pending: typeof productionPending = (response,t,fetcher,clock) => productionPending(response,t,fetcher,clock,()=>{});
const closed = { tradingDate:'2026-10-28', supervisor:true, timezone:'Asia/Kolkata', hoursIST:'08:45–16:15',
  scheduled:false, maintenance:false, shouldRun:false, running:false, ready:false, draining:false };
const clock = () => new Date('2026-10-28T14:00:00Z');
const response = (body:any,status=503,origin=PRODUCTION_ORIGIN) => {
 const r=Response.json(body,{status});Object.defineProperty(r,'url',{value:origin+'/api/research/probe'});return r;
};
function harness(status:any=closed) {
 const skips:string[]=[],diagnostics:string[]=[];let requests=0;
 return {skips,diagnostics,requests:()=>requests,t:{skip:(s:string)=>skips.push(s),diagnostic:(s:string)=>diagnostics.push(s)},
  fetch:(async()=>{requests++;return Response.json(status);}) as typeof fetch};
}
test('verified closure skips as pending while preserving the original response body',async()=>{
 const h=harness(),r=response({...closed,error:'OUTSIDE_OPERATING_HOURS'});
 assert.equal(await pending(r,h.t,h.fetch,clock),true);assert.equal(h.skips.length,1);
 assert.match(h.skips[0],/readiness is unverified/);assert.equal(h.requests(),1);
 assert.equal((await r.json()).error,'OUTSIDE_OPERATING_HOURS');
});
test('generic errors and ordinary success never skip or add status requests',async()=>{
 for(const [body,status] of [[{error:'OUTSIDE_OPERATING_HOURS'},503],[{...closed,error:'RUNTIME_STARTING'},503],[closed,500],[closed,200]] as const){
  const h=harness();assert.equal(await pending(response(body,status),h.t,h.fetch,clock),false);assert.equal(h.skips.length,0);assert.equal(h.requests(),0);
 }
});
test('missing flags, stale dates, maintenance, running and malformed clocks fail closed',async()=>{
 for(const patch of [{tradingDate:'2026-10-27'},{maintenance:true},{running:true},{ready:true},{draining:true},{shouldRun:true},{scheduled:true},{supervisor:false},{timezone:'UTC'},{hoursIST:'all day'},{running:undefined}]){
  const h=harness();assert.equal(await pending(response({...closed,...patch,error:'OUTSIDE_OPERATING_HOURS'}),h.t,h.fetch,clock),false);assert.equal(h.skips.length,0);
 }
});
test('active operating hours cannot skip even when the server claims closure',async()=>{
 const h=harness();assert.equal(await pending(response({...closed,error:'OUTSIDE_OPERATING_HOURS'}),h.t,h.fetch,()=>new Date('2026-10-28T05:00:00Z')),false);assert.equal(h.skips.length,0);
});
test('independent runtime status must confirm closure, and network failures remain failures',async()=>{
 for(const status of [{...closed,running:true},{...closed,maintenance:true},{...closed,tradingDate:'2026-10-27'},{}]){
  const h=harness(status);assert.equal(await pending(response({...closed,error:'OUTSIDE_OPERATING_HOURS'}),h.t,h.fetch,clock),false);assert.equal(h.skips.length,0);
 }
 const h=harness();await assert.rejects(pending(response({...closed,error:'OUTSIDE_OPERATING_HOURS'}),h.t,(async()=>{throw Error('NETWORK_FAILURE');}) as typeof fetch,clock),/NETWORK_FAILURE/);assert.equal(h.skips.length,0);
});
test('unrelated origins, non-JSON errors and a window opening during verification cannot skip',async()=>{
 const h=harness();assert.equal(await pending(response({...closed,error:'OUTSIDE_OPERATING_HOURS'},503,'https://example.com'),h.t,h.fetch,clock),false);
 const r=new Response('<html>Unavailable</html>',{status:503});Object.defineProperty(r,'url',{value:PRODUCTION_ORIGIN});
 assert.equal(await pending(r,h.t,h.fetch,clock),false);
 let calls=0;const opening=()=>new Date(calls++?'2026-10-28T05:00:00Z':'2026-10-28T14:00:00Z');
 assert.equal(await pending(response({...closed,error:'OUTSIDE_OPERATING_HOURS'}),h.t,h.fetch,opening),false);assert.equal(h.skips.length,0);
});
