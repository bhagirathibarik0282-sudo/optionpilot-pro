import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLadderShadowHost,tickTelegramLadderShadow} from '../telegram-ladder-shadow-host.js';
import {createLadderRecorderSource} from '../telegram-ladder-source.js';
import {participationMinute} from '../participation-minute-recorder.js';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {premiumRecordStatus,sourceQuoteAgeSeconds} from '../h1-premium-record-quality.js';
const open=Date.parse('2026-10-29T09:15:00+05:30');
test('shadow binding is off by default and cannot read or send when disabled',async()=>{
  let reads=0;const host=createLadderShadowHost({enabled:()=>false,read:async()=>{reads++;throw Error('unexpected');},log:()=>{throw Error('unexpected');}});
  assert.equal(await host.tick(open+60_000),'DISABLED');assert.equal(reads,0);
  const previous=process.env.TELEGRAM_LADDER_SHADOW_ENABLED;
  try{delete process.env.TELEGRAM_LADDER_SHADOW_ENABLED;assert.equal(await tickTelegramLadderShadow(open+60_000),'DISABLED');}
  finally{if(previous===undefined)delete process.env.TELEGRAM_LADDER_SHADOW_ENABLED;else process.env.TELEGRAM_LADDER_SHADOW_ENABLED=previous;}
});
test('enabled host plans and logs counts once per minute without a delivery destination',async()=>{
  const logs:any[]=[];let reads=0;
  const host=createLadderShadowHost({enabled:()=>true,read:async()=>{reads++;return {frames:[],failures:['NIFTY_SOURCE_UNAVAILABLE']};},log:r=>logs.push(r)});
  assert.equal(await host.tick(open+60_000),'SHADOW_TICK');assert.equal(await host.tick(open+65_000),'SKIPPED');
  assert.equal(reads,1);assert.equal(logs.filter(r=>r.state==='PLANNED').length,1);
  assert.ok(logs.every(r=>r.sendsPerformed===false&&r.writesPerformed===false));
  assert.deepEqual(logs.at(-1).failures,['NIFTY_SOURCE_UNAVAILABLE']);
});
test('source read failure is contained and can retry on the next existing timer tick',async()=>{
  let reads=0;const logs:any[]=[];
  const host=createLadderShadowHost({enabled:()=>true,read:async()=>{reads++;if(reads===1)throw Error('private database details');return {frames:[],failures:[]};},log:r=>logs.push(r)});
  assert.equal(await host.tick(open+60_000),'FAILED');assert.equal(await host.tick(open+65_000),'SHADOW_TICK');
  assert.equal(reads,2);assert.ok(!JSON.stringify(logs).includes('private database details'));
});
test('overlapping existing timer ticks cannot start a second source read',async()=>{
  let release:()=>void=()=>{},reads=0;const wait=new Promise<void>(r=>release=r);
  const host=createLadderShadowHost({enabled:()=>true,read:async()=>{reads++;await wait;return {frames:[],failures:[]};},log:()=>{}});
  const first=host.tick(open+60_000);assert.equal(await host.tick(open+65_000),'SKIPPED');release();await first;assert.equal(reads,1);
});
test('captured NIFTY archive and participation can pass through the bound shadow path',async()=>{
  const replay=JSON.parse(readFileSync(new URL('./fixtures/replay-NIFTY.json',import.meta.url),'utf8'));
  const capture=JSON.parse(readFileSync(new URL('./fixtures/live-capture.json',import.meta.url),'utf8'));
  const participation=participationMinute(capture,Date.parse(capture.serverTime))!;
  // Exercise the actual recorder projection with captured canonical data. These
  // fixture rows are not normalized database exports and must not be passed off as such.
  const normalized:any={market:[],options:[],chain:[]};
  const snake=(row:any)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value]));
  const recorderSource=readFileSync(new URL('../h1-recorder-adapter.ts',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
  const writer=runInNewContext(transformSync(recorderSource,{loader:'ts'}).code+';({recordH1Snapshot})',{
    console,premiumRecordStatus,sourceQuoteAgeSeconds,openingGapPercent:()=>null,dbInsert:async()=>{},
    dbUpsertMarketSnapshot1m:async(row:any)=>normalized.market.push({...snake(row),truth_verdict:'TRUE'}),
    dbUpsertOptionSnapshot1m:async(row:any)=>normalized.options.push({...snake(row),truth_verdict:'TRUE'}),
    dbUpsertChainState1m:async(row:any)=>normalized.chain.push({...snake(row),truth_verdict:'TRUE'}),
  });
  for(const observation of replay.canonical) {
    const market=structuredClone(observation.market);
    market.expiries=market.expiries.map((e:any)=>({...e,expiryDate:new Date(e.expiryDate)}));
    await writer.recordH1Snapshot({market,truthVerdict:observation.truth_verdict,calculationVersion:'TEST_CAPTURE',now:new Date(market.timestamp)});
  }
  assert.equal(normalized.options.length,8);
  const source=createLadderRecorderSource({replay:async request=>{
    if(request.symbol!=='NIFTY')return {ok:false,request} as any;
    const from=Date.parse(request.tradeDate+'T'+request.fromTime+':00+05:30'),to=Date.parse(request.tradeDate+'T'+request.toTime+':00+05:30');
    const inside=(r:any)=>Date.parse(r.minute_bucket)>=from&&Date.parse(r.minute_bucket)<=to;
    return {ok:true,request,market:normalized.market.filter(inside),options:normalized.options.filter(inside),chain:normalized.chain.filter(inside)} as any;
  },participation:async range=>Date.parse(participation.minuteBucket)>=Date.parse(range.from)&&Date.parse(participation.minuteBucket)<=Date.parse(range.to)?[participation]:[]});
  const logs:any[]=[];let premiums=0,participants=0;
  const host=createLadderShadowHost({enabled:()=>true,read:async range=>{
    const result=await source(range);
    for(const frame of result.frames){participants+=frame.participation.length;for(const index of frame.indices)for(const expiry of index.expiries)premiums+=expiry.contracts.length;}
    return result;
  },log:r=>logs.push(r)});
  const at=Date.parse(capture.serverTime)+60_000;
  // Four bounded catch-up passes reach the captured archive interval.
  for(let n=0;n<4;n++)await host.tick(at+n*60_000);
  assert.ok(logs.some(r=>r.cached>0));assert.ok(logs.some(r=>r.state==='PLANNED'&&r.parts>0));
  assert.equal(premiums,8);assert.equal(participants,16);
  assert.ok(logs.every(r=>r.sendsPerformed===false&&r.writesPerformed===false));
});
test('actual dashboard timer invokes the shadow binding without adding another timer',async()=>{
  let ticks:Function[]=[],ladder=0;
  const src=readFileSync(new URL('../dashboard-live-runtime.ts',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'');
  const ctx:any={process:{env:{NODE_ENV:'production'}},Date,console,
    createParticipationMinuteRecorder:()=>({capture:async()=> 'SKIPPED'}),dbSaveParticipationMinuteOnce:async()=>{},
    tickTelegramLadderShadow:async()=>{ladder++;},isIndianEquityMarketOpenAt:()=>false,
    subscribeKiteAuthoritySessionPersisted:()=>{},setInterval:(fn:Function)=>{ticks.push(fn);return {unref(){}};}};
  const runtime=runInNewContext(transformSync(src,{loader:'ts'}).code+';({startDashboardLiveRuntime})',ctx);
  runtime.startDashboardLiveRuntime();assert.equal(ticks.length,1);ticks[0]();await Promise.resolve();assert.equal(ladder,1);
});
