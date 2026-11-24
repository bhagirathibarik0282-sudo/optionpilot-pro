import {dueWindows,renderWindow,renderEod,renderSummary,type MinuteFrame} from './telegram-ladder-v4.js';
export type DeliveryPart=string|{kind:'DOCUMENT';filename:string;content:string;caption:string};
export type Job={id:string;parts:readonly DeliveryPart[]};
/** Large packs retain every ladder in one text attachment instead of flooding the chat. */
export function reportJob(id:string,parts:readonly string[],summary?:string):Job {
  if(parts.length<=2)return {id,parts};
  const content=parts.join('\n\n');
  if(Buffer.byteLength(content,'utf8')>45*1024*1024)throw Error('REPORT_ATTACHMENT_TOO_LARGE');
  const filename=id.replace(/[^A-Za-z0-9_-]/g,'_')+'.txt';
  return {id,parts:[summary??parts[0].split('\n').slice(0,5).join('\n')+'\nସମ୍ପୂର୍ଣ୍ଣ ladder ତଥ୍ୟ ସଂଲଗ୍ନ TXTରେ ଅଛି।',
    {kind:'DOCUMENT',filename,content,caption:'📊 OPTIONPILOT LADDER V4 | ସମ୍ପୂର୍ଣ୍ଣ ସମୟ ଓ index ladder'}]};
}
/** Durable implementations must make putIfAbsent and claim atomic across all workers.
 * A SENDING part after worker restart becomes UNKNOWN; never silently resend it.
 * Confirmation of an ambiguous delivery requires operator reconciliation.
 */
export interface LadderOutbox {
  putIfAbsent(job:Job):Promise<boolean>;
  claim(id:string,part:number):Promise<boolean>;
  settle(id:string,part:number,result:'ACKED'|'RETRYABLE'|'UNKNOWN',receipt?:string):Promise<void>;
}
export type TransportResult={status:'ACKED';receipt:string}|{status:'RETRYABLE'|'UNKNOWN'};
/** No sends here. Resume after restart by enqueueing the same deterministic IDs. */
export async function enqueueLadderReports(store:LadderOutbox,frames:readonly MinuteFrame[],d:string,now:number):Promise<number> {
  if(!Number.isFinite(now))throw Error('INVALID_CLOCK');let count=0;
  for(const w of dueWindows(d,now)) {
    const id=`LADDER_V4|${d}|${w.timeframe}|${w.from}|${w.to}`;
    if(await store.putIfAbsent(reportJob(id,renderWindow(frames,w),renderSummary(frames,w))))count++;
  }
  if(now>=Date.parse(d+'T16:00:00+05:30')) {
    if(await store.putIfAbsent(reportJob(`LADDER_V4|${d}|EOD`,renderEod(frames,d),renderSummary(frames,{date:d,from:d+'T09:15:00+05:30',to:d+'T15:30:00+05:30',timeframe:'EOD',partial:false}))))count++;
  }
  return count;
}
/** Sequential parts, stop on failed/ambiguous part; no later part overtakes it.
 * claim must allow an ACKED part to be skipped via the supplied resume index.
 */
export async function deliverLadderJob(store:LadderOutbox,job:Job,send:(part:DeliveryPart)=>Promise<TransportResult>,startPart=0):Promise<string> {
  if(!Number.isInteger(startPart)||startPart<0||startPart>job.parts.length)throw Error('INVALID_RESUME_PART');
  for(let p=startPart;p<job.parts.length;p++) {
    if(!await store.claim(job.id,p))return 'NOT_CLAIMED';
    let result:TransportResult;
    try {result=await send(job.parts[p]);}catch{result={status:'UNKNOWN'};}
    if(result.status==='ACKED'&&!result.receipt)result={status:'UNKNOWN'};
    await store.settle(job.id,p,result.status,result.status==='ACKED'?result.receipt:undefined);
    if(result.status!=='ACKED')return result.status;
  }
  return 'ACKED';
}
