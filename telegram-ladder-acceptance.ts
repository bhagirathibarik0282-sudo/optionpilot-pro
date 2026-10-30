import type {Hono} from 'hono';
import {createHash,timingSafeEqual} from 'node:crypto';
import {dbSharedPoolForLadder} from './db.js';
import {resolveTelegramChatId} from './telegram-sender-v2.js';
import {createPostgresLadderOutbox,OUTBOX_KIND} from './telegram-ladder-postgres-outbox.js';
import {deliverLadderJob,type DeliveryPart} from './telegram-ladder-outbox.js';
import {createLadderTelegramTransport} from './telegram-ladder-transport.js';
import {LADDER_PREFIX,SYMBOLS,sessionWindows,renderWindow,renderSummary,type SymbolName,type Window} from './telegram-ladder-v4.js';
import {readExistingLadderFrames} from './telegram-ladder-existing-source.js';

const path='/api/telegram/ladder-acceptance';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** One fixed text/TXT job per index and configured run/window. Default OFF, 15-minute
 * authorization window, explicit destination readback, durable receipts. No timer. */
export function mountLadderAcceptanceRoutes(app:Hono,options:{
  env?:()=>Record<string,string|undefined>;now?:()=>number;http?:typeof fetch;
  pool?:()=>any;outbox?:typeof createPostgresLadderOutbox;pause?:(ms:number)=>Promise<void>;read?:typeof readExistingLadderFrames;
}={}) {
  const env=options.env??(()=>process.env),now=options.now??Date.now,http=options.http??fetch;
  const pool=options.pool??dbSharedPoolForLadder,outbox=options.outbox??createPostgresLadderOutbox;
  const pause=options.pause??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  function config(key:string|undefined,symbol='NIFTY') {
    const e=env(),expected=e.TELEGRAM_LADDER_ACCEPTANCE_KEY??'',run=e.TELEGRAM_LADDER_ACCEPTANCE_RUN_ID??'';
    const stamp=/^(\d{13})-[a-f0-9]{8}$/.exec(run)?.[1];
    if(e.TELEGRAM_LADDER_ACCEPTANCE_ENABLED!=='true'||expected.length<32||!key
      ||Buffer.byteLength(key)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(key),Buffer.from(expected))
      ||!stamp||now()<Number(stamp)||now()-Number(stamp)>15*60_000)return null;
    if(!(SYMBOLS as readonly string[]).includes(symbol))return null;
    let window:Window|undefined;
    if(e.TELEGRAM_LADDER_ACCEPTANCE_WINDOW?.trim()) {
      const [date,from,to]=e.TELEGRAM_LADDER_ACCEPTANCE_WINDOW.trim().split('|');
      window=sessionWindows(date).find(w=>w.timeframe===3&&Date.parse(w.from)===Date.parse(date+'T'+from+':00+05:30')&&Date.parse(w.to)===Date.parse(date+'T'+to+':00+05:30'));
      if(!window||Date.parse(window.to)+60_000>now())return null;
    }
    return {token:e.TELEGRAM_BOT_TOKEN??'',chatId:resolveTelegramChatId(symbol as SymbolName,e).chatId,run,symbol:symbol as SymbolName,window};
  }
  async function recorded(cfg:{symbol:SymbolName;window?:Window}) {
    if(!cfg.window)return undefined;
    const result=await(options.read??readExistingLadderFrames)({date:cfg.window.date,from:cfg.window.from,to:cfg.window.to});
    const end=result.frames.find(f=>Date.parse(f.minute)===Date.parse(cfg.window!.to))?.indices.find(i=>i.symbol===cfg.symbol);
    if(!end||!end.expiries.some(e=>e.contracts.length)||result.failures.includes(cfg.symbol+'_SOURCE_UNAVAILABLE'))throw Error('RECORDED_TARGET_UNAVAILABLE');
    const content=renderWindow(result.frames,cfg.window,cfg.symbol).map(p=>p.replace(LADDER_PREFIX,LADDER_PREFIX+'RECORDED SAMPLE | ')).join('\n\n');
    const clock=(s:string)=>new Date(Date.parse(s)+19_800_000).toISOString().slice(11,16).replace(':','');
    return {window:cfg.window,summary:renderSummary(result.frames,cfg.window,cfg.symbol).replace(LADDER_PREFIX,LADDER_PREFIX+'RECORDED SAMPLE | '),
      filename:`OptionPilot_${cfg.symbol}_${cfg.window.date}_${clock(cfg.window.from)}_${clock(cfg.window.to)}.txt`,content,sha256:hash(Buffer.from(content,'utf8')),
      targetMinutes:result.frames.filter(f=>f.indices.some(i=>i.symbol===cfg.symbol)).length,expiries:end.expiries.length,contractsAtEnd:end.expiries.reduce((n,e)=>n+e.contracts.length,0),sourceFailures:result.failures};
  }
  async function api(token:string,method:string,fields:Record<string,string>) {
    const response=await http(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body:new URLSearchParams(fields),redirect:'error',signal:AbortSignal.timeout(15_000)});
    const result=await response.json() as any;if(!response.ok||result?.ok!==true)throw Error('TELEGRAM_READ_FAILED');return result.result;
  }
  async function chat(config:{token:string;chatId:string;symbol:SymbolName}) {
    const result=await api(config.token,'getChat',{chat_id:config.chatId});
    if(String(result.id)!==config.chatId||!['group','supergroup'].includes(result.type)||typeof result.title!=='string')throw Error('DESTINATION_UNVERIFIED');
    return {chatId:config.chatId,title:result.title,type:result.type,symbol:config.symbol};
  }
  async function state(p:any,id:string,optional=false) {
    const c=await p.connect();try{
      const r=await c.query("SELECT payload FROM app_state_log WHERE kind=$1 AND payload->>'id'=$2",[OUTBOX_KIND,id]);
      if(optional&&!r.rows.length)return null;
      if(r.rows.length!==1)throw Error('ACCEPTANCE_STATE_UNAVAILABLE');return r.rows[0].payload;
    }finally{c.release();}
  }
  app.get(path,async c=>{
    c.header('Cache-Control','no-store');
    try {const cfg=config(c.req.header('x-ladder-acceptance-key'),c.req.query('symbol'));if(!cfg)return c.json({ok:false,error:'ACCEPTANCE_DISABLED',sendsTelegram:false},403);
      return c.json({ok:true,...await chat(cfg),runId:cfg.run,recordedReport:await recorded(cfg),sendsTelegram:false});
    }catch{return c.json({ok:false,error:'DESTINATION_UNVERIFIED',sendsTelegram:false},503);}
  });
  app.post(path,async c=>{
    c.header('Cache-Control','no-store');
    try {
      const cfg=config(c.req.header('x-ladder-acceptance-key'),c.req.query('symbol'));if(!cfg)return c.json({ok:false,error:'ACCEPTANCE_DISABLED',sendsTelegram:false},403);
      const body=await c.req.json().catch(()=>null);
      if(body?.expectedChatId!==cfg.chatId||body?.runId!==cfg.run)return c.json({ok:false,error:'DESTINATION_OR_RUN_MISMATCH',sendsTelegram:false},409);
      const destination=await chat(cfg),p=pool();if(!p)throw Error('DATABASE_UNAVAILABLE');
      const store=outbox(p),id=`LADDER_V4|ACCEPTANCE|${cfg.run}|${cfg.symbol}|${cfg.chatId}|${cfg.window?cfg.window.from+'|'+cfg.window.to:'TEST'}`;
      let saved=await state(p,id,true);
      if(!saved) {
        const report=await recorded(cfg);
        if(report&&body.expectedReportSha256!==report.sha256)return c.json({ok:false,error:'REPORT_CHANGED',sendsTelegram:false},409);
        const content=report?.content??LADDER_PREFIX+`${cfg.symbol} TXT DELIVERY TEST\nRun: ${cfg.run}\nଏହା କେବଳ delivery ଯାଞ୍ଚ। କୌଣସି trade signal ନୁହେଁ।\nUTF-8 ଯାଞ୍ଚ: ଓଡ଼ିଆ 🟢 🔴\n`;
        const job={id,parts:[report?.summary??LADDER_PREFIX+`${cfg.symbol} DELIVERY TEST\nଏହା କେବଳ text/TXT delivery ଯାଞ୍ଚ। କୌଣସି trade signal ନୁହେଁ।\nRun: ${cfg.run}`,
          {kind:'DOCUMENT' as const,filename:report?.filename??`OptionPilot_${cfg.symbol}_delivery_test.txt`,content,caption:LADDER_PREFIX+cfg.symbol+(report?' RECORDED LADDER SAMPLE':' TXT DELIVERY TEST')}]};
        await store.putIfAbsent(job);
      }
      await store.pending(id);saved=await state(p,id);
      const job={id,parts:saved.parts as DeliveryPart[]},attachment=job.parts[1];
      if(typeof attachment==='string'||attachment.kind!=='DOCUMENT')throw Error('INVALID_STORED_DOCUMENT');
      const filename=attachment.filename,expectedBytes=Buffer.from(attachment.content,'utf8');
      if(cfg.window&&body.expectedReportSha256!==hash(expectedBytes))return c.json({ok:false,error:'REPORT_CHANGED',sendsTelegram:false},409);
      const start=saved.states.findIndex((s:any)=>s.status!=='ACKED');
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
