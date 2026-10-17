import test from 'node:test';
import assert from 'node:assert/strict';

/** Production smoke probe: reports truthfully; it never manufactures a successful data readback. */
const BASE='https://optionpilot-pro-v2-production.up.railway.app/rag-event-evidence';
const date='2026-10-16';
test('production RAG multi-DTE readback is explicit and fail-closed',async()=>{
 const params=new URLSearchParams({symbol:'NIFTY',date,expiry:'2026-10-20',strike:'25000',side:'PE',time:'09:36',kind:'SNAPSHOT',lookback:'3'});
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 let response:Response;
 try {response=await fetch(BASE+'?'+params,{signal:controller.signal,headers:{accept:'application/json'}});}
 finally {clearTimeout(timeout);}
 assert.ok([200,400,422,503].includes(response.status),'UNEXPECTED_HTTP_'+response.status);
 const body:any=await response.json();
 assert.equal(body.safety?.createsOrders,false);
 assert.equal(body.safety?.writesPerformed,false);
 if(response.status!==200){
   console.log('RAG_REAL_DATA_UNVERIFIED '+JSON.stringify({httpStatus:response.status,reason:body.reason}));
   assert.equal(body.ok,false);
   return;
 }
 assert.equal(body.ok,true);
 assert.equal(body.mode,'READ_ONLY_RAG_PREMIUM_SNAPSHOT_V1');
 assert.equal(body.identity.symbol,'NIFTY');
 assert.equal(body.identity.date,date);
 assert.equal(body.identity.strike,25000);
 assert.equal(body.identity.side,'PE');
 assert.equal(body.multiDte?.mode,'READ_ONLY_RAG_DTE_ALIGNMENT_V1');
 assert.ok(Array.isArray(body.multiDte.accepted));
 assert.equal(body.multiDte.coverage.verifiedExpiries,body.multiDte.accepted.length);
 for(const row of body.multiDte.accepted){
   assert.ok(Number.isFinite(row.price)&&row.price>0);
   assert.ok(Number.isFinite(row.previousPrice)&&row.previousPrice>0);
   assert.ok(Math.abs(row.changePercent-(row.price/row.previousPrice-1)*100)<1e-8);
 }
 console.log('RAG_REAL_DATA_OBSERVATION '+JSON.stringify({httpStatus:response.status,verifiedExpiries:body.multiDte.coverage.verifiedExpiries,observedExpiries:body.multiDte.coverage.observedExpiries,sourceStatus:body.multiDte.sourceStatus,blocked:body.multiDte.blocked?.map((x:any)=>({expiry:x.expiry,reason:x.reason}))}));
});
