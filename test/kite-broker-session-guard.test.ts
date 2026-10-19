import test from 'node:test';
import assert from 'node:assert/strict';
import { KiteBrokerSessionGuard } from '../kite-broker-session-guard.js';

const session={accessToken:'fixture-token',userId:'fixture-user'};
test('profile proof is account-bound, cached and single-flight; rotation revalidates',async()=>{
 let now=100000,calls=0,release:()=>void=()=>{};const wait=new Promise<void>(r=>release=r);
 const guard=new KiteBrokerSessionGuard({now:()=>now,fetch:(async(url,init)=>{calls++;assert.equal(url,'https://api.kite.trade/user/profile');assert.equal((init?.headers as any).Authorization,'token fixture-key:'+session.accessToken);await wait;return Response.json({status:'success',data:{user_id:'fixture-user'}});}) as typeof fetch});
 const a=guard.verify('fixture-key',session),b=guard.verify('fixture-key',session);assert.equal(calls,1);release();
 assert.equal((await a).code,'VERIFIED');assert.equal((await b).verified,true);await guard.verify('fixture-key',session);assert.equal(calls,1);
 now+=60001;await guard.verify('fixture-key',session);assert.equal(calls,2);
 assert(!JSON.stringify(guard.read()).includes('fixture-token'));
});
test('403 is sticky and never retried until an explicit session reset or token rotation',async()=>{
 let now=100000,calls=0;const guard=new KiteBrokerSessionGuard({now:()=>now,fetch:(async()=>{calls++;return new Response('',{status:403});}) as typeof fetch});
 assert.equal((await guard.verify('key',session)).code,'RECONNECT_REQUIRED');now+=3600000;
 await guard.verify('key',session);assert.equal(calls,1);
 await guard.verify('key',{...session,accessToken:'rotated'});assert.equal(calls,2);
 guard.reset();await guard.verify('key',session);assert.equal(calls,3);
});
test('wrong account and unavailable broker fail closed; transient failures have a bounded retry',async()=>{
 let now=100000,calls=0,wrong=true;const guard=new KiteBrokerSessionGuard({now:()=>now,fetch:(async()=>{calls++;return wrong?Response.json({status:'success',data:{user_id:'other'}}):new Response('',{status:503});}) as typeof fetch});
 assert.equal((await guard.verify('key',session)).code,'ACCOUNT_MISMATCH');assert.equal(guard.read().verified,false);
 guard.reset();wrong=false;assert.equal((await guard.verify('key',session)).code,'BROKER_UNAVAILABLE');
 await guard.verify('key',session);assert.equal(calls,2);now+=15001;await guard.verify('key',session);assert.equal(calls,3);
});
test('quote rejection wins over an in-flight successful profile and cannot revive a rejected token',async()=>{
 let release:()=>void=()=>{};const wait=new Promise<void>(r=>release=r);let calls=0;
 const guard=new KiteBrokerSessionGuard({now:()=>100000,fetch:(async()=>{calls++;await wait;return Response.json({status:'success',data:{user_id:'fixture-user'}});}) as typeof fetch});
 const pending=guard.verify('key',session);guard.reject('key',session.accessToken);release();
 assert.equal((await pending).verified,false);assert.equal((await guard.verify('key',session)).code,'RECONNECT_REQUIRED');assert.equal(calls,1);
});
test('old browser-token rejection does not evict the verified current account session',async()=>{
 let calls=0;const guard=new KiteBrokerSessionGuard({now:()=>100000,fetch:(async()=>{calls++;return Response.json({status:'success',data:{user_id:'fixture-user'}});}) as typeof fetch});
 await guard.verify('key',session);guard.reject('key','old-browser-token');
 assert.equal(guard.read().code,'VERIFIED');assert(guard.isRejected('key','old-browser-token'));
 assert.equal((await guard.verify('key',session)).verified,true);assert.equal(calls,1);
 assert.equal((await guard.verify('key',{...session,accessToken:'old-browser-token'})).verified,false);assert.equal(calls,1);
});
