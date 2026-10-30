import type {Hono} from 'hono';
import {createHash,timingSafeEqual} from 'node:crypto';
import {dbSharedPoolForLadder} from './db.js';
import {resolveTelegramChatId} from './telegram-sender-v2.js';
import {createPostgresLadderOutbox,OUTBOX_KIND} from './telegram-ladder-postgres-outbox.js';
import {deliverLadderJob,type DeliveryPart} from './telegram-ladder-outbox.js';
import {createLadderTelegramTransport} from './telegram-ladder-transport.js';
import {LADDER_PREFIX} from './telegram-ladder-v4.js';

const path='/api/telegram/ladder-acceptance',filename='OptionPilot_NIFTY_delivery_test.txt';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** One fixed NIFTY text/TXT test per configured run. Default OFF, 15-minute
 * authorization window, explicit destination readback, durable receipts. No timer. */
export function mountLadderAcceptanceRoutes(app:Hono,options:{
  env?:()=>Record<string,string|undefined>;now?:()=>number;http?:typeof fetch;
  pool?:()=>any;outbox?:typeof createPostgresLadderOutbox;pause?:(ms:number)=>Promise<void>;
}={}) {
  const env=options.env??(()=>process.env),now=options.now??Date.now,http=options.http??fetch;
  const pool=options.pool??dbSharedPoolForLadder,outbox=options.outbox??createPostgresLadderOutbox;
  const pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  function config(key:string|undefined) {
    const e=env(),expected=e.TELEGRAM_LADDER_ACCEPTANCE_KEY??'',run=e.TELEGRAM_LADDER_ACCEPTANCE_RUN_ID??'';
    const stamp=/^(\d{13})-[a-f0-9]{8}$/.exec(run)?.[1];
    if(e.TELEGRAM_LADDER_ACCEPTANCE_ENABLED!=='true'||expected.length<32||!key
      ||Buffer.byteLength(key)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(key),Buffer.from(expected))
      ||!stamp||now()<Number(stamp)||now()-Number(stamp)>15*60_000)return null;
    return {token:e.TELEGRAM_BOT_TOKEN??'',chatId:resolveTelegramChatId('NIFTY',e).chatId,run};
  }
  async function api(token:string,method:string,fields:Record<string,string>) {
    const response=await http(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body:new URLSearchParams(fields),redirect:'error',signal:AbortSignal.timeout(15_000)});
    const result=await response.json() as any;if(!response.ok||result?.ok!==true)throw Error('TELEGRAM_READ_FAILED');return result.result;
  }
  async function chat(config:{token:string;chatId:string}) {
    const result=await api(config.token,'getChat',{chat_id:config.chatId});
    if(String(result.id)!==config.chatId||!['group','supergroup'].includes(result.type)||typeof result.title!=='string')throw Error('DESTINATION_UNVERIFIED');
    return {chatId:config.chatId,title:result.title,type:result.type,symbol:'NIFTY'};
  }
  async function state(p:any,id:string) {
    const c=await p.connect();try{
      const r=await c.query("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'id'=$2",[OUTBOX_KIND,id]);
      if(r.rows.length!==1)throw Error('ACCEPTANCE_STATE_UNAVAILABLE');return r.rows[0].payload;
    }finally{c.release();}
  }
  app.get(path,async c=>{
    c.header('Cache-Control','no-store');
    try {const cfg=config(c.req.header('x-ladder-acceptance-key'));if(!cfg)return c.json({ok:false,error:'ACCEPTANCE_DISABLED',sendsTelegram:false},403);
      return c.json({ok:true,...await chat(cfg),runId:cfg.run,sendsTelegram:false});
    }catch{return c.json({ok:false,error:'DESTINATION_UNVERIFIED',sendsTelegram:false},503);}
  });
  app.post(path,async c=>{
    c.header('Cache-Control','no-store');
    try {
      const cfg=config(c.req.header('x-ladder-acceptance-key'));if(!cfg)return c.json({ok:false,error:'ACCEPTANCE_DISABLED',sendsTelegram:false},403);
      const body=await c.req.json().catch(()=>null);
      if(body?.expectedChatId!==cfg.chatId||body?.runId!==cfg.run)return c.json({ok:false,error:'DESTINATION_OR_RUN_MISMATCH',sendsTelegram:false},409);
      const destination=await chat(cfg),p=pool();if(!p)throw Error('DATABASE_UNAVAILABLE');
      const store=outbox(p),id=`LADDER_V4|ACCEPTANCE|${cfg.run}|NIFTY|${cfg.chatId}`;
      const content=LADDER_PREFIX+`NIFTY TXT DELIVERY TEST\nRun: ${cfg.run}\nଏହା କେବଳ delivery ଯାଞ୍ଚ। କୌଣସି trade signal ନୁହେଁ।\nUTF-8 ଯାଞ୍ଚ: ଓଡ଼ିଆ 🟢 🔴\n`;
      const expectedBytes=Buffer.from(content,'utf8');
      const job={id,parts:[LADDER_PREFIX+`NIFTY DELIVERY TEST\nଏହା କେବଳ text/TXT delivery ଯାଞ୍ଚ। କୌଣସି trade signal ନୁହେଁ।\nRun: ${cfg.run}`,
        {kind:'DOCUMENT' as const,filename,content,caption:LADDER_PREFIX+'NIFTY TXT DELIVERY TEST'}]};
      await store.putIfAbsent(job);await store.pending(id);
      let saved=await state(p,id),start=saved.states.findIndex((s:any)=>s.status!=='ACKED');
      let delivery='ACKED',sent=0,document:any;
      if(start>=0&&['PENDING','RETRYABLE'].includes(saved.states[start].status)) {
        const transport=createLadderTelegramTransport({token:cfg.token,chatId:cfg.chatId,
          fetch:async(url,init)=>{const response=await http(url,init);
            if(String(url).endsWith('/sendDocument'))document=(await response.clone().json() as any)?.result?.document;
            return response;}});
        delivery=await deliverLadderJob(store,job,async(part:DeliveryPart)=>{
          if(typeof part!=='string')await pause(1100);
          const result=await transport.send(part);if(result.status!=='ACKED')return result;sent++;
          if(typeof part==='string')return {status:'ACKED',receipt:JSON.stringify({messageId:result.receipt})};
          if(document?.file_name!==filename||document?.file_size!==expectedBytes.length||typeof document?.file_id!=='string')throw Error('DOCUMENT_METADATA_MISMATCH');
          const file=await api(cfg.token,'getFile',{file_id:document.file_id});
          if(typeof file?.file_path!=='string'||!/^[\w./-]+$/.test(file.file_path)||file.file_path.includes('..')||file.file_path.startsWith('/'))throw Error('DOCUMENT_PATH_INVALID');
          const response=await http(`https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`,{redirect:'error',signal:AbortSignal.timeout(15_000)});
          if(!response.ok)throw Error('DOCUMENT_DOWNLOAD_FAILED');const bytes=new Uint8Array(await response.arrayBuffer());
          if(hash(bytes)!==hash(expectedBytes))throw Error('DOCUMENT_CONTENT_MISMATCH');
          return {status:'ACKED',receipt:JSON.stringify({messageId:result.receipt,filename,bytes:bytes.length,sha256:hash(bytes),documentVerified:true})};
        },start);
      }else if(start>=0)delivery=saved.states[start].status;
      saved=await state(p,id);
      return c.json({ok:delivery==='ACKED',delivery,destination,runId:cfg.run,newMessagesAcknowledged:sent,
        receipts:saved.states.map((s:any)=>({status:s.status,...(s.receipt?JSON.parse(s.receipt):{})})),createsOrders:false,scheduledDeliveryEnabled:false});
    }catch{return c.json({ok:false,delivery:'UNKNOWN',mayHaveSent:true,error:'ACCEPTANCE_FAILED'},503);}
  });
}
