import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createBnfReplayArchiver,readBnfReplayStatus} from '../bnf-replay-archive.js';
import {uploadBnfReplayToDrive} from '../eod-drive-upload.js';

const date='2026-11-20',runId='a'.repeat(32),stem='bnf-shadow-replay-'+date+'-'+runId;
async function fixture(t:any,state='SEALED'){
 const root=await mkdtemp(join(tmpdir(),'bnf-replay-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=gzipSync('synthetic private event archive');
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const meta={mode:'BNF_SHADOW_REPLAY_V1',date,runId,state,sealed:state==='SEALED',updatedAt:date+'T04:00:00Z',
  fileName:stem+'.jsonl.gz',compressedBytes:bytes.length,sha256,recordsWritten:14,recordsDropped:0};
 await writeFile(join(root,stem+'.meta.json'),JSON.stringify(meta));await writeFile(join(root,stem+'.jsonl.gz'),bytes);
 return {root,meta,bytes,sha256};
}
test('only sealed checksummed captures upload, restart reuses local verified receipts, no files deleted',async t=>{
 const f=await fixture(t);let uploads=0;
 const upload=async(d:string,name:string,bytes:Buffer)=>{uploads++;assert.equal(d,date);assert.equal(name,stem+'.jsonl.gz');assert.deepEqual(bytes,f.bytes);return {fileId:'private-fixture',checksumSha256:f.sha256};};
 assert.equal((await createBnfReplayArchiver({root:f.root,upload})()).status,'DRIVE_VERIFIED');
 assert.equal((await createBnfReplayArchiver({root:f.root,upload})()).status,'NO_SEALED_PENDING_CAPTURE');
 assert.equal(uploads,1);assert.equal((await readdir(f.root)).length,3);
 const status:any=await readBnfReplayStatus(date,f.root);
 assert.equal(status.runs[0].archive,'DRIVE_VERIFIED');assert.equal(status.completeSessionVerified,false);
 assert.ok(!JSON.stringify(status).includes('private-fixture'));
});
test('corrupt bytes never upload or get a receipt; bounded retry cannot spin',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,stem+'.jsonl.gz'),Buffer.alloc(f.bytes.length));let uploads=0;
 const run=createBnfReplayArchiver({root:f.root,upload:async()=>{uploads++;}});
 assert.equal((await run()).status,'REPLAY_ARCHIVE_FAILED');assert.equal((await run()).status,'IDLE');
 assert.equal(uploads,0);assert.ok(!(await readdir(f.root)).some(n=>n.endsWith('.drive.json')));
});
test('active/stale captures stay incomplete, no mistaken full-session proof',async t=>{
 const f=await fixture(t,'RECORDING');let uploads=0;
 const run=createBnfReplayArchiver({root:f.root,upload:async()=>{uploads++;}});
 assert.equal((await run()).status,'NO_SEALED_PENDING_CAPTURE');assert.equal(uploads,0);
 const status:any=await readBnfReplayStatus(date,f.root,Date.parse(date+'T04:10:00Z'));
 assert.equal(status.runs[0].state,'STALE_OR_INTERRUPTED');assert.equal(status.runs[0].offlineReplayVerification,'NOT_RUN');
});
test('archive calls are single-flight; concurrent callers cannot duplicate a private upload',async t=>{
 const f=await fixture(t);let release:any;let uploads=0;
 const run=createBnfReplayArchiver({root:f.root,upload:async()=>{uploads++;await new Promise(resolve=>{release=resolve;});return {fileId:'fixture',checksumSha256:f.sha256};}});
 const first=run();while(!release)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await run()).status,'IDLE');release();assert.equal((await first).status,'DRIVE_VERIFIED');assert.equal(uploads,1);
});
test('binary replay sidecars require downloaded-byte verification and preserve normal EOD names',async t=>{
 const bytes=gzipSync('synthetic replay data'),sha=createHash('sha256').update(bytes).digest('hex'),md5=createHash('md5').update(bytes).digest('hex');
 const original=globalThis.fetch,names=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_DRIVE_EOD_FOLDER_ID'];
 const old=names.map(n=>process.env[n]);names.forEach(n=>{process.env[n]='fixture';});
 t.after(()=>{globalThis.fetch=original;names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i];});});
 let uploaded=false,media=0;
 const file={id:'fixture',name:stem+'.jsonl.gz',parents:['fixture'],size:String(bytes.length),md5Checksum:md5,appProperties:{checksumSha256:sha}};
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'fixture'});
  if(url.includes('?q='))return Response.json({files:[]});
  if(url.includes('uploadType=multipart')){
   uploaded=true;const body=Buffer.from(init!.body as any);
   assert.ok(body.includes(bytes));assert.ok(body.includes(Buffer.from('application/gzip')));
   assert.ok(!body.includes(Buffer.from('optionpilot-eod-')));return Response.json(file);
  }
  if(url.includes('alt=media')){media++;return new Response(bytes);}
  return Response.json(file);
 };
 assert.equal((await uploadBnfReplayToDrive(date,file.name,bytes)).checksumSha256,sha);
 assert.equal(uploaded,true);assert.equal(media,1);
 globalThis.fetch=async(input)=>{
  const url=String(input);if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'fixture'});
  if(url.includes('?q='))return Response.json({files:[file]});
  if(url.includes('alt=media'))return new Response(Buffer.concat([bytes,Buffer.from('tamper')]));
  return Response.json(file);
 };
 await assert.rejects(uploadBnfReplayToDrive(date,file.name,bytes),/SHA256_MISMATCH/);
 await assert.rejects(uploadBnfReplayToDrive(date,'../private',bytes),/ARTIFACT_INVALID/);
});
