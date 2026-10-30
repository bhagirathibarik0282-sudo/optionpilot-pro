import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {LADDER_FIELDS,sessionWindows,renderWindow,renderSummary,type LadderField,type SymbolName} from './telegram-ladder-v4.js';

const labels:Record<LadderField,string>={spot:'Spot',levels:'PDH / PDL',fullPcr:'Full OI PCR',bandPcr:'±7 OI PCR',volumePcr:'Volume PCR',walls:'CE / PE walls',premiums:'Premium ladder',changes:'Changes Δ',alignment:'PCR alignment',participation:'Sectors / stocks',sources:'Source details'};
type State={offset:number;fields:Record<string,LadderField[]>;announced?:string[]};
export function settingsStore(dir:string) {
  const path=join(dir,'telegram-message-settings.json');let state:State={offset:0,fields:{}};
  try {const raw=JSON.parse(readFileSync(path,'utf8'));if(!Number.isSafeInteger(raw.offset)||raw.offset<0||!raw.fields||typeof raw.fields!=='object')throw Error();
    for(const v of Object.values(raw.fields))if(!Array.isArray(v)||v.some(x=>!LADDER_FIELDS.includes(x)))throw Error();state=raw;
  }catch(error:any){if(error.code!=='ENOENT')throw Error('TELEGRAM_SETTINGS_STATE_INVALID');}
  function save(next:State){mkdirSync(dir,{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(path+'.tmp',path);state=next;}
  return {offset:()=>state.offset,advance:(offset:number)=>save({...state,offset}),get:(chat:string)=>[...(state.fields[chat]??LADDER_FIELDS)],
    announced:(chat:string)=>state.announced?.includes(chat)??false,markAnnounced:(chat:string)=>save({...state,announced:[...(state.announced??[]),chat]}),
    set:(chat:string,fields:LadderField[])=>save({...state,fields:{...state.fields,[chat]:[...new Set(fields)]}})};
}
export function settingsPanel(fields:readonly LadderField[]) {
  const buttons=LADDER_FIELDS.map(key=>({text:`${fields.includes(key)?'✅':'⬜'} ${labels[key]}`,callback_data:'cfg:'+key}));
  const rows=[];for(let i=0;i<buttons.length;i+=2)rows.push(buttons.slice(i,i+2));
  rows.push([{text:'📄 My report',callback_data:'cfg:report'},{text:'↺ Reset',callback_data:'cfg:reset'}]);
  return {text:'⚙️ OptionPilot message settings\nButton ଦବାଇ parameter ON/OFF କରନ୍ତୁ — ପସନ୍ଦ ସଙ୍ଗେସଙ୍ଗେ save ହେବ।\nଏହି groupର admin ପସନ୍ଦ ବଦଳାଇପାରିବେ।\nOld automatic messages: OFF. /report = ଆପଣଙ୍କ ପସନ୍ଦର recorded report.\nQuality / missing-data labels ସବୁବେଳେ ରହିବ।',reply_markup:{inline_keyboard:rows}};
}
export function createSettingsController(options:{api:(method:string,body:any)=>Promise<any>;store:ReturnType<typeof settingsStore>;chats:Record<string,SymbolName>;now?:()=>number;read?:any;botUsername?:string}) {
  const {api,store,chats}=options,now=options.now??Date.now;
  async function allowed(chat:string,user:any){if(!chats[chat]||!Number.isSafeInteger(user?.id)||user.is_bot)return false;
    const member=await api('getChatMember',{chat_id:chat,user_id:user.id});return ['creator','administrator'].includes(member?.status);}
  async function report(chat:string){
    const date=new Date(now()+19_800_000).toISOString().slice(0,10),w=sessionWindows(date).filter(w=>w.timeframe===3&&Date.parse(w.to)+60_000<=now()).at(-1);
    if(!w)return api('sendMessage',{chat_id:chat,text:'ଏପର୍ଯ୍ୟନ୍ତ ଆଜିର closed 3-minute window ନାହିଁ।'});
    const read=options.read??(await import('./telegram-ladder-existing-source.js')).readExistingLadderFrames;
    const result=await read({date,from:w.from,to:w.to}),symbol=chats[chat];
    if(!result.frames.some((f:any)=>f.minute===w.to&&f.indices.some((i:any)=>i.symbol===symbol)))return api('sendMessage',{chat_id:chat,text:'ଏହି windowର recorded data ଅନୁପଲବ୍ଧ। /report ପୁଣି ମାଗନ୍ତୁ।'});
    const fields=store.get(chat),parts=renderWindow(result.frames,w,symbol,fields);
    await api('sendMessage',{chat_id:chat,text:'RECORDED / ON DEMAND\n'+renderSummary(result.frames,w,symbol,fields)});
    const form=new FormData();form.set('chat_id',chat);form.set('document',new Blob([parts.join('\n\n')],{type:'text/plain;charset=utf-8'}),`OptionPilot_${symbol}_${date}_${w.to.slice(11,16).replace(':','')}.txt`);
    return api('sendDocument',form);
  }
  return async function handle(update:any){
    const cb=update.callback_query,msg=cb?.message??update.message,chat=String(msg?.chat?.id??''),data=cb?.data;
    if(!chats[chat])return;
    const command=typeof msg?.text==='string'?msg.text.trim().split(/\s/)[0].replace(/@\w+$/,''):'';
    if(!cb&&!['/settings','/report'].includes(command))return;
    const addressed=msg?.text?.trim().split(/\s/)[0].split('@')[1];
    if(!cb&&addressed&&options.botUsername&&addressed.toLowerCase()!==options.botUsername.toLowerCase())return;
    if(cb&&(typeof data!=='string'||!data.startsWith('cfg:')))return;
    if(!await allowed(chat,cb?.from??msg?.from)){if(cb)await api('answerCallbackQuery',{callback_query_id:cb.id,text:'Group admin only',show_alert:true});return;}
    if(cb)await api('answerCallbackQuery',{callback_query_id:cb.id});
    if(command==='/report'||data==='cfg:report'){try{return await report(chat);}catch{return api('sendMessage',{chat_id:chat,text:'Report ପୂର୍ଣ୍ଣ ହୋଇନାହିଁ। Data / delivery ଯାଞ୍ଚ ପରେ /report ପୁଣି ମାଗନ୍ତୁ।'});}}
    if(cb){const key=data.slice(4);if(key==='reset')store.set(chat,[...LADDER_FIELDS]);
      else if(LADDER_FIELDS.includes(key as LadderField)){const fields=store.get(chat);store.set(chat,fields.includes(key)?fields.filter(x=>x!==key):[...fields,key]);}else return;
      return api('editMessageText',{chat_id:chat,message_id:msg.message_id,...settingsPanel(store.get(chat))});}
    return api('sendMessage',{chat_id:chat,...settingsPanel(store.get(chat))});
  };
}
/** Capture credentials before importing legacy modules. Only this lexical API can
 * use the token; all old senders see an absent token even when menu is enabled. */
export function startTelegramSettings(env:NodeJS.ProcessEnv=process.env,options:{http?:typeof fetch;pause?:(ms:number)=>Promise<void>}={}) {
  const token=env.TELEGRAM_BOT_TOKEN?.trim();delete env.TELEGRAM_BOT_TOKEN;
  console.log('[TELEGRAM_LEGACY_DELIVERY] disabled; token isolated from legacy runtime');
  if(!token||env.TELEGRAM_SETTINGS_ENABLED!=='true')return;
  const http=options.http??globalThis.fetch.bind(globalThis),pause=options.pause??(ms=>new Promise(r=>setTimeout(r,ms))),chats:Record<string,SymbolName>={};
  for(const symbol of ['NIFTY','SENSEX','BANKNIFTY'] as const){const id=env['TELEGRAM_CHAT_ID_'+symbol]?.trim();if(id)chats[id]=symbol;}
  const api=async(method:string,body:any)=>{const form=body instanceof FormData;
    const r=await http(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:form?undefined:{'content-type':'application/json'},body:form?body:JSON.stringify(body),signal:AbortSignal.timeout(35_000),redirect:'error'});
    const json:any=await r.json();if(!r.ok||json.ok!==true)throw Error('TELEGRAM_API_FAILED_'+method+'_'+r.status);return json.result;};
  async function initialize(){
    const info=await api('getWebhookInfo',{});if(info.url)throw Error('EXISTING_WEBHOOK_PRESENT');
    const me=await api('getMe',{});
    const store=settingsStore(env.RAILWAY_VOLUME_MOUNT_PATH||'/app/data'),handle=createSettingsController({api,store,chats,botUsername:me.username});
    // Acknowledge updates before executing sends. Restart never replays a report.
    for(const [chat,symbol] of Object.entries(chats)){
      const target=await api('getChat',{chat_id:chat});
      const titles={NIFTY:'OptionPilot Nifty',SENSEX:'OptionPilot SENSEX',BANKNIFTY:'OptionPilot BANKNIFTY'};
      if(String(target.id)!==chat||!['group','supergroup'].includes(target.type)||target.title!==titles[symbol])throw Error('SETTINGS_DESTINATION_MISMATCH');
      await api('setMyCommands',{scope:{type:'chat',chat_id:chat},commands:[{command:'settings',description:'Choose message parameters'},{command:'report',description:'Get your saved report format'}]});
      if(!store.announced(chat)){store.markAnnounced(chat);const message=await api('sendMessage',{chat_id:chat,...settingsPanel(store.get(chat))});console.log('[TELEGRAM_SETTINGS_MENU]',JSON.stringify({symbol,messageId:message.message_id}));}
    }
    console.log('[TELEGRAM_SETTINGS] polling active; legacyDelivery=false; scheduledDelivery=false');
    let errors=0;
    for(;;){try{const updates=await api('getUpdates',{offset:store.offset(),timeout:20,allowed_updates:['message','callback_query']});
      for(const update of updates){store.advance(update.update_id+1);try{await handle(update);}catch{console.error('[TELEGRAM_SETTINGS] update failed; not replayed');}}errors=0;
    }catch(error:any){if(error.message?.endsWith('_409'))throw Error('TELEGRAM_POLLING_CONFLICT');errors=Math.min(errors+1,6);console.error('[TELEGRAM_SETTINGS] polling retry');await pause(errors*5000);}}
  }
  return(async()=>{for(;;){try{await initialize();return;}catch(error:any){
    const reason=error.message??'STARTUP_FAILED';
    console.error('[TELEGRAM_SETTINGS]',reason,'cause='+String(error.cause?.code??'NONE'));
    if(/EXISTING_WEBHOOK|DESTINATION_MISMATCH|STATE_INVALID|POLLING_CONFLICT|_401$|_403$/.test(reason))return;
    await pause(15_000);
  }}})();
}
