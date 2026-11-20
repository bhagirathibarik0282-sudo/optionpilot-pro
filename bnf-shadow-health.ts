/** Allowlisted daily worker checkpoints on the existing persistent data volume.
 * Operational evidence only: never a trade journal, zero-trade proof or raw ticks.
 */
import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

export const bnfHealthPath=()=>join(process.env.RAILWAY_VOLUME_MOUNT_PATH||'/app/data','bnf-shadow-health-v1.json');
const stamp=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const count=(v:any)=>Number.isSafeInteger(v)&&v>=0?v:null;
const code=(v:any)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(v)?v:null;
export const bnfIstDay=(ms=Date.now())=>new Date(ms+19800000).toISOString().slice(0,10);
export function validBnfHealthDate(v:any):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}

export function cleanBnfHealth(raw:any){
 if(!raw||!validBnfHealthDate(raw.date))return null;
 return {date:raw.date,updatedAt:stamp(raw.updatedAt),phase:code(raw.phase),reason:code(raw.reason),
  workerRunning:raw.workerRunning===true,feedConnected:raw.feedConnected===true,
  startedAt:stamp(raw.startedAt),lastReportAt:stamp(raw.lastReportAt),
  lastExitAt:stamp(raw.lastExitAt),exitCode:count(raw.exitCode),exitSignal:code(raw.exitSignal),
  failureStage:code(raw.failureStage),failureReason:code(raw.failureReason),
  sourceReason:code(raw.sourceReason),
  lastReportedCounts:raw.lastReportedCounts?Object.fromEntries(['observations','signals','rejected','warmup'].map(k=>[k,count(raw.lastReportedCounts[k])])):null,
  coverage:'CHECKPOINTS_ONLY' as const,completeSessionVerified:false as const};
}
function readDays(path:string):any[]{
 try{if(statSync(path).size>131072)return [];const v=JSON.parse(readFileSync(path,'utf8'));return v.version===1&&Array.isArray(v.days)?v.days.map(cleanBnfHealth).filter(Boolean).slice(0,30):[];}catch{return [];}
}
export function readBnfShadowHealth(date:string,path=bnfHealthPath()){
 return readDays(path).find(d=>d.date===date)??null;
}
export function writeBnfShadowHealth(raw:any,path=bnfHealthPath()){
 const row=cleanBnfHealth(raw);if(!row)return false;
 try{const previous=readDays(path),old=previous.find(d=>d.date===row.date);
  // A restart must not erase the last exit or the last observed source report.
  const kept={...row};
  for(const key of ['startedAt','lastReportAt','lastExitAt','exitCode','exitSignal','failureStage','failureReason','sourceReason','lastReportedCounts'] as const)
   if(kept[key]===null&&old?.[key]!==null&&old?.[key]!==undefined)(kept as any)[key]=old[key];
  const days=[kept,...previous.filter(d=>d.date!==row.date)].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  mkdirSync(dirname(path),{recursive:true});const tmp=path+'.'+process.pid+'.tmp';
  writeFileSync(tmp,JSON.stringify({version:1,days}),{mode:0o600});renameSync(tmp,path);return true;
 }catch{return false;}
}
