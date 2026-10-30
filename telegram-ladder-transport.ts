import {LADDER_PREFIX} from './telegram-ladder-v4.js';
import type {DeliveryPart,TransportResult} from './telegram-ladder-outbox.js';

/** Explicit destination and injected HTTP client; no environment reads or sends on import. */
export function createLadderTelegramTransport(config:{
  token:string;chatId:string;fetch?:typeof fetch;now?:()=>number;timeoutMs?:number;
}) {
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(config.token)||! /^-?[1-9]\d*$/.test(config.chatId))throw Error('INVALID_TELEGRAM_DESTINATION');
  const http=config.fetch??fetch,now=config.now??Date.now;
  let blockedUntil=0;
  return {get blockedUntil(){return blockedUntil;},async send(part:DeliveryPart):Promise<TransportResult> {
    if(now()<blockedUntil)return {status:'RETRYABLE'};
    const text=typeof part==='string'?part:part.caption;
    if(!text.startsWith(LADDER_PREFIX)||text.length>(typeof part==='string'?4096:1024))throw Error('INVALID_LADDER_PAYLOAD');
    let body:FormData|URLSearchParams,method:string;
    if(typeof part==='string') {method='sendMessage';body=new URLSearchParams({chat_id:config.chatId,text:part});}
    else {
      if(part.kind!=='DOCUMENT'||!part.content||Buffer.byteLength(part.content,'utf8')>45*1024*1024||!/^[A-Za-z0-9_-]+\.txt$/.test(part.filename))throw Error('INVALID_LADDER_DOCUMENT');
      method='sendDocument';body=new FormData();body.set('chat_id',config.chatId);body.set('caption',part.caption);
      body.set('document',new Blob([part.content],{type:'text/plain;charset=utf-8'}),part.filename);
    }
    try {
      const response=await http(`https://api.telegram.org/bot${config.token}/${method}`,{method:'POST',body,signal:AbortSignal.timeout(config.timeoutMs??15_000),redirect:'error'});
      const result=await response.json() as any;
      if(response.ok&&result?.ok===true&&Number.isSafeInteger(result.result?.message_id)&&result.result.message_id>0
        &&String(result.result?.chat?.id)===config.chatId)return {status:'ACKED',receipt:String(result.result.message_id)};
      if(response.status===429&&result?.ok===false&&result.error_code===429) {
        const seconds=result.parameters?.retry_after;
        blockedUntil=now()+((Number.isSafeInteger(seconds)&&seconds>0?Math.min(seconds,86400):60)*1000);
        return {status:'RETRYABLE'};
      }
      // Only an explicit Telegram rejection is safe to retry. Proxy/empty/timeout outcomes are ambiguous.
      if(result?.ok===false&&Number.isSafeInteger(result.error_code)&&result.error_code>=400&&result.error_code<500)return {status:'RETRYABLE'};
      return {status:'UNKNOWN'};
    }catch{return {status:'UNKNOWN'};}
  }};
}
