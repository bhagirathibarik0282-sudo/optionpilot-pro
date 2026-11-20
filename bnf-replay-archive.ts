/** Private, bounded SHADOW replay sidecars on the existing volume and Drive folder.
 * No broker connection, database table, retention delete, or change to market EOD files.
 */
import {createHash} from 'node:crypto';
import {readdir,readFile,lstat,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {uploadBnfReplayToDrive} from './eod-drive-upload.js';
import {validBnfHealthDate} from './bnf-shadow-health.js';

const ROOT=()=>join(process.env.RAILWAY_VOLUME_MOUNT_PATH||'/app/data','bnf-shadow-replay');
const NAME=/^bnf-shadow-replay-(\d{4}-\d{2}-\d{2})-([a-f0-9]{32})\.meta\.json$/;
const stateName=(v:any)=>['NOT_STARTED','RECORDING','SEALED','INCOMPLETE'].includes(v)?v:'INCOMPLETE';
const n=(v:any)=>Number.isSafeInteger(v)&&v>=0?v:null;
async function jsonFile(path:string,max=16384){
 const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('REPLAY_METADATA_INVALID');
 return JSON.parse(await readFile(path,'utf8'));
}
async function scan(root:string){
 try{return (await readdir(root)).filter(f=>NAME.test(f)).sort().slice(-1000);}catch{return [];}
}
export async function readBnfReplayStatus(date:string,root=ROOT(),now=Date.now()){
 if(!validBnfHealthDate(date))return {ok:false,reason:'INVALID_DATE'};
 const files=(await scan(root)).filter(f=>NAME.exec(f)![1]===date);
 const runs:any[]=[];
 for(const file of files.slice(-50)){
  try{
   const m=await jsonFile(join(root,file)),match=NAME.exec(file)!;
   if(m.mode!=='BNF_SHADOW_REPLAY_V1'||m.date!==date||m.runId!==match[2])continue;
   let state=stateName(m.state);
   const updated=Date.parse(m.updatedAt||'');
   if(state==='RECORDING'&&(!Number.isFinite(updated)||now-updated>120000))state='STALE_OR_INTERRUPTED';
   let archive='NOT_VERIFIED';
   try{const receipt=await jsonFile(join(root,file.replace('.meta.json','.drive.json')));
    if(receipt.status==='DRIVE_VERIFIED'&&receipt.sha256===m.sha256&&m.sealed===true)archive='DRIVE_VERIFIED';
   }catch{}
   runs.push({runId:m.runId,state,archive,updatedAt:Number.isFinite(updated)?m.updatedAt:null,
    recordsWritten:n(m.recordsWritten),recordsDropped:n(m.recordsDropped),uncompressedBytes:n(m.uncompressedBytes),
    completeSessionVerified:false,offlineReplayVerification:'NOT_RUN'});
  }catch{/* Corrupt metadata is not proof of capture. */}
 }
 return {ok:true,mode:'BNF_SHADOW_REPLAY_STATUS_V1',date,runs,
  status:runs.length?'CAPTURE_RUNS_FOUND':'NO_REPLAY_CAPTURE',
  completeSessionVerified:false,brokerOrders:0};
}

/** Single-flight and bounded retries. Only sealed files are eligible; no local deletes. */
export function createBnfReplayArchiver(deps:any={}){
 let busy=false,nextScan=0;
 const root=deps.root||ROOT(),now=deps.now||Date.now,upload=deps.upload||uploadBnfReplayToDrive;
 const retries=new Map<string,number>();
 return async function archive(){
  if(busy||now()<nextScan)return {status:'IDLE'};
  busy=true;nextScan=now()+60000;
  try{
   for(const file of await scan(root)){
    if((retries.get(file)||0)>now())continue;
    const match=NAME.exec(file)!;
    try{
     const m=await jsonFile(join(root,file));
     const expected=file.replace('.meta.json','.jsonl.gz');
     if(m.mode!=='BNF_SHADOW_REPLAY_V1'||!validBnfHealthDate(m.date)||m.date!==match[1]||m.runId!==match[2]||
        m.sealed!==true||m.fileName!==expected||!['SEALED','INCOMPLETE'].includes(m.state)||!/^[a-f0-9]{64}$/.test(m.sha256||''))continue;
     const receiptPath=join(root,file.replace('.meta.json','.drive.json'));
     try{const saved=await jsonFile(receiptPath);if(saved.status==='DRIVE_VERIFIED'&&saved.sha256===m.sha256)continue;}catch{}
     const path=join(root,expected),stat=await lstat(path);
     if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>64*1024*1024||stat.size!==m.compressedBytes)throw Error('REPLAY_FILE_INVALID');
     const bytes=await readFile(path);
     if(createHash('sha256').update(bytes).digest('hex')!==m.sha256)throw Error('REPLAY_HASH_MISMATCH');
     const result=await upload(m.date,expected,bytes);
     if(result.checksumSha256!==m.sha256||typeof result.fileId!=='string')throw Error('REPLAY_UPLOAD_NOT_VERIFIED');
     const receipt={status:'DRIVE_VERIFIED',sha256:m.sha256,fileId:result.fileId,verifiedAt:new Date(now()).toISOString(),completeSessionVerified:false};
     await writeFile(receiptPath+'.tmp',JSON.stringify(receipt),{mode:0o600});await rename(receiptPath+'.tmp',receiptPath);
     return {status:'DRIVE_VERIFIED',date:m.date};
    }catch{retries.set(file,now()+5*60000);return {status:'REPLAY_ARCHIVE_FAILED',reason:'VERIFY_OR_UPLOAD_FAILED'};}
   }
   return {status:'NO_SEALED_PENDING_CAPTURE'};
  }finally{busy=false;}
 };
}
