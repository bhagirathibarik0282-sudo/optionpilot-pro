import test from 'node:test';import assert from 'node:assert/strict';
import {checkDriveFilePermission} from '../drive-permission-check.js';
import {readFileSync} from 'node:fs';
test('Drive consent is accepted only after a valid read-only files response, with safe failures',async()=>{
 for(const [status,body,ready,state] of [[200,{files:[]},true,'VERIFIED'],[200,{error:'bad'},false,'CHECK_FAILED'],[403,{error:{message:'private secret'}},false,'RECONNECT_REQUIRED'],[401,{},false,'RECONNECT_REQUIRED'],[500,{},false,'CHECK_FAILED']] as const){
  let calls=0;const r=await checkDriveFilePermission('test-only',async(url,init)=>{calls++;assert.equal(String(url),'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)');assert.equal(init?.method,undefined);return new Response(JSON.stringify(body),{status});});
  assert.equal(calls,1);assert.equal(r.ready,ready);assert.equal(r.state,state);assert(!JSON.stringify(r).includes('private'));assert(!JSON.stringify(r).includes('test-only'));
 }
 assert.equal((await checkDriveFilePermission('test-only',async()=>{throw Error('private');})).ready,false);
 const s=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const callback=s.slice(s.indexOf('app.get("/api/drive/callback"'),s.indexOf('async function getValidDriveAccessToken'));
 assert(callback.indexOf('await checkDriveFilePermission(tokenJson.access_token)')<callback.indexOf('driveSession.accessToken = tokenJson.access_token'));
 assert(callback.includes("return c.redirect('/?drive=permission-required')"));
 assert(s.includes('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email'));
});
