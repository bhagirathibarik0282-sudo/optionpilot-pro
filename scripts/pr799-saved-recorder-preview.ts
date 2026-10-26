import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {serve} from '@hono/node-server';
import {createPr799RecorderPreview} from '../pr799-recorder-preview.js';
import {projectRecordedRagLadder} from '../rag-recorder-event-ladder-bridge.js';

// Manual, fixed saved capture only. No database imports or application startup.
// The original transport digest verifies bytes before parsing or rendering.
async function main(){
 const password=process.env.PR799_PREVIEW_PASSWORD??'';
 const path=process.env.PR799_CAPTURE_TRANSPORT_FILE;
 if(process.env.PR799_PREVIEW!=='NIFTY_OCT19_1045_READ_ONLY'||password.length<32||!path)
   throw new Error('PREVIEW_NOT_CONFIGURED');
 const file=await readFile(path);
 assert(file.length<=150000);
 const transport=JSON.parse(file.toString('utf8'));
 assert.equal(transport.manifest?.chunks,1);
 assert.equal(typeof transport.base64,'string');
 assert(transport.base64.length<=100000);
 const bytes=gunzipSync(Buffer.from(transport.base64,'base64'),{maxOutputLength:250000});
 const digest=createHash('sha256').update(bytes).digest('hex');
 assert.equal(digest,'d20c0723293b8875a895db5b5dc3c27dde3d395505ea4f1ccb2a597ff891ff64');
 assert.equal(transport.manifest.sha256,digest);
 const capture=JSON.parse(bytes.toString('utf8'));
 assert.equal(capture.readOnly,true);assert.equal(capture.writesPerformed,false);
 assert.equal(capture.selectedEvidenceSha256,'118a0e2d0c07691435358d41088f4658b8deeeb1f4acf81f539d59eb41b3fc82');
 assert.equal(projectRecordedRagLadder(capture.evidence).ok,true);
 const app=createPr799RecorderPreview({password,state:capture.state,evidence:capture.evidence});
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:8789},()=>{
   console.log('PR799_SAVED_CAPTURE_PREVIEW_READY_LOOPBACK_ONLY_NO_DB_TTL_10M');
 });
 server.on('error',()=>{console.error('PR799_SAVED_PREVIEW_LISTENER_FAILED');process.exitCode=1;});
 const expiry=setTimeout(()=>server.close(),600000);
 server.on('close',()=>clearTimeout(expiry));
 const close=()=>server.close();process.once('SIGTERM',close);process.once('SIGINT',close);
}
main().catch(()=>{console.error('PR799_SAVED_PREVIEW_FAILED_NO_SERVER_STARTED');process.exitCode=1;});
