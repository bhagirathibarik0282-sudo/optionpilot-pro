import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {settingsStore,settingsPanel,createSettingsController,startTelegramSettings} from '../telegram-ladder-settings.js';
import {LADDER_FIELDS,renderWindow,renderSummary,value,type MinuteFrame,type Window} from '../telegram-ladder-v4.js';
const v=(n:number)=>value(n,'STALE','RECORDED');
const frame:MinuteFrame={minute:'2026-10-30T04:48:00.000Z',indices:[{symbol:'NIFTY',spot:v(100),pdh:v(105),pdl:v(90),expiries:[{expiry:'2026-11-03',volumeScope:'FULL',pcr:{full:v(1),band7:v(2),volume:v(3)},ceWall:{strike:110,oi:v(10)},peWall:{strike:90,oi:v(20)},contracts:[{strike:100,side:'CE',ltp:v(10),pdh:v(12),pdl:v(8)}]}]}],participation:[]};
const w:Window={date:'2026-10-30',from:'2026-10-30T04:45:00.000Z',to:frame.minute,timeframe:3,partial:false};
test('legacy token is removed even when settings are disabled',()=>{const env={TELEGRAM_BOT_TOKEN:'TEST_TOKEN'};startTelegramSettings(env);assert.equal(env.TELEGRAM_BOT_TOKEN,undefined);});
test('selected parameters alter real TXT and summary, preserving quality and coverage',()=>{
 const text=renderWindow([frame],w,'NIFTY',['spot']).join('\n'),summary=renderSummary([frame],w,'NIFTY',['spot']);
 for(const t of [text,summary]){assert.match(t,/STALE/);assert.match(t,/Minute coverage 1\/4/);assert.doesNotMatch(t,/PDH|PDL|Full OI|±7 OI|Volume PCR|CE wall|Strike 100 CE|SECTORS/);}
 const premiums=renderWindow([frame],w,'NIFTY',['premiums','levels']).join('\n');assert.match(premiums,/Strike 100 CE/);assert.match(premiums,/PDH/);assert.doesNotMatch(premiums,/SPOT|CE wall|Full OI/);
});
test('settings persist across restart, group choices and update offsets stay isolated',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tg-settings-'));try{const a=settingsStore(dir);a.set('-1',['spot']);a.advance(19);a.markAnnounced('-1');const b=settingsStore(dir);assert.deepEqual(b.get('-1'),['spot']);assert.equal(b.offset(),19);assert.equal(b.announced('-1'),true);assert.deepEqual(b.get('-2'),[...LADDER_FIELDS]);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('corrupt state fails closed rather than forgetting saved settings',()=>{const dir=mkdtempSync(join(tmpdir(),'tg-settings-'));try{writeFileSync(join(dir,'telegram-message-settings.json'),'broken');assert.throws(()=>settingsStore(dir),/STATE_INVALID/);}finally{rmSync(dir,{recursive:true,force:true});}});
test('menu has valid toggle for each supported field and one report button',()=>{const rows=settingsPanel(['spot']).reply_markup.inline_keyboard.flat();for(const key of LADDER_FIELDS)assert.equal(rows.filter(x=>x.callback_data==='cfg:'+key).length,1);assert.ok(rows.some(x=>x.callback_data==='cfg:report'));});
test('unmapped chats and non-admin users cannot change settings or request reports',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tg-settings-')),calls:any[]=[];try{const store=settingsStore(dir),handle=createSettingsController({store,chats:{'-1':'NIFTY'},api:async(m,b)=>{calls.push([m,b]);return {status:'member'};}});
 await handle({message:{chat:{id:-2},from:{id:7},text:'/settings'}});assert.equal(calls.length,0);
 await handle({callback_query:{id:'cb',from:{id:7},data:'cfg:spot',message:{chat:{id:-1},message_id:2}}});assert.deepEqual(store.get('-1'),[...LADDER_FIELDS]);assert.ok(!calls.some(c=>c[0]==='sendMessage'||c[0]==='editMessageText'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('admin toggles save immediately, edit same menu, and report uses saved selection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tg-settings-')),calls:any[]=[];try{const store=settingsStore(dir),handle=createSettingsController({store,chats:{'-1':'NIFTY'},now:()=>Date.parse('2026-10-30T04:49:00Z'),read:async()=>({frames:[frame],failures:[]}),api:async(m,b)=>{calls.push([m,b]);return {status:'administrator'};}});
 const msg={chat:{id:-1},message_id:42,from:{id:7},text:'/settings@OptionPilotBot'};
 await handle({message:msg});assert.equal(calls.at(-1)[0],'sendMessage');
 await handle({callback_query:{id:'a',from:{id:7},data:'cfg:spot',message:msg}});assert.ok(!store.get('-1').includes('spot'));assert.equal(calls.at(-1)[0],'editMessageText');assert.equal(calls.at(-1)[1].message_id,42);
 store.set('-1',['spot']);await handle({message:{...msg,text:'/report'}});
 const summary=calls.findLast(c=>c[0]==='sendMessage')[1].text;assert.match(summary,/RECORDED/);assert.doesNotMatch(summary,/Full OI PCR|CE wall/);
 const form=calls.findLast(c=>c[0]==='sendDocument')[1];assert.equal(form.get('chat_id'),'-1');const text=await form.get('document').text();assert.match(text,/STALE/);assert.doesNotMatch(text,/PDH|CE wall|Strike 100 CE/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('transient bootstrap failure retries; verified menus send once; polling conflict stops safely',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tg-retry-'));try{let failed=false,sends=0;const pauses:number[]=[];
 const env={TELEGRAM_BOT_TOKEN:'TEST_ONLY',TELEGRAM_SETTINGS_ENABLED:'true',RAILWAY_VOLUME_MOUNT_PATH:dir,TELEGRAM_CHAT_ID_NIFTY:'-1'};
 const http:typeof fetch=async(url:any)=>{assert.equal(env.TELEGRAM_BOT_TOKEN,undefined);const method=String(url).split('/').at(-1);let result:any;
 if(method==='getWebhookInfo'){if(!failed){failed=true;throw new TypeError('fetch failed');}result={url:''};}
 else if(method==='getMe')result={id:9,username:'TestBot'};
 else if(method==='getChat')result={id:-1,type:'supergroup',title:'OptionPilot Nifty'};
 else if(method==='sendMessage'){sends++;result={message_id:88};}
 else if(method==='setMyCommands')result=true;
 else if(method==='getUpdates')return new Response(JSON.stringify({ok:false}),{status:409});
 else throw Error('Unexpected request');
 return new Response(JSON.stringify({ok:true,result}));};
 await startTelegramSettings(env,{http,pause:async ms=>{pauses.push(ms);}});assert.equal(sends,1);assert.deepEqual(pauses,[15000]);
 await startTelegramSettings({...env,TELEGRAM_BOT_TOKEN:'TEST_ONLY'},{http,pause:async()=>{}});assert.equal(sends,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing newest endpoint returns an explicitly delayed recorded window, retaining preferences',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tg-gap-')),calls:any[]=[],reads:any[]=[];try{const store=settingsStore(dir);store.set('-1',['spot']);
 const older={...frame,minute:'2026-10-30T04:45:00.000Z'};
 const handle=createSettingsController({store,chats:{'-1':'NIFTY'},now:()=>Date.parse('2026-10-30T04:49:00Z'),read:async(r:any)=>{reads.push(r);return {frames:reads.length===1?[]:[older],failures:[]};},api:async(m,b)=>{calls.push([m,b]);return {status:'creator'};}});
 await handle({message:{chat:{id:-1},from:{id:7},text:'/report'}});assert.equal(reads.length,2);assert.ok(Date.parse(reads[1].to)-Date.parse(reads[1].from)<=12*60000);
 const summary=calls.find(c=>c[0]==='sendMessage')[1].text;assert.match(summary,/DELAYED/);assert.match(summary,/10:15–10:18/);assert.match(summary,/10:12–10:15/);assert.match(summary,/3 min/);assert.doesNotMatch(summary,/Full OI PCR/);
 const document=calls.find(c=>c[0]==='sendDocument')[1].get('document');assert.match(await document.text(),/DELAYED/);assert.match(await document.text(),/Minute coverage 1\/4/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing every bounded endpoint and source failures are distinct; neither fabricates a report',async()=>{
 for(const failures of [[],['NIFTY_SOURCE_UNAVAILABLE']]){const dir=mkdtempSync(join(tmpdir(),'tg-no-data-')),calls:any[]=[];try{
 const handle=createSettingsController({store:settingsStore(dir),chats:{'-1':'NIFTY'},now:()=>Date.parse('2026-10-30T04:49:00Z'),read:async()=>({frames:[],failures}),api:async(m,b)=>{calls.push([m,b]);return {status:'administrator'};}});
 await handle({message:{chat:{id:-1},from:{id:7},text:'/report'}});assert.ok(!calls.some(c=>c[0]==='sendDocument'));
 assert.match(calls.find(c=>c[0]==='sendMessage')[1].text,failures.length?/read ବିଫଳ/:/୧୨ minute/);
 }finally{rmSync(dir,{recursive:true,force:true});}}
});
