import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBnfShadowHost, bindBnfHostMaster } from './host.ts';
const now=Date.parse('2026-11-18T04:30:00Z'),stamp=new Date(now).toISOString();
const entries=[{instrumentToken:1,symbol:'BANKNIFTY',role:'SPOT',instrumentLabel:'NIFTY BANK'},
 {instrumentToken:101,symbol:'BANKNIFTY',role:'OPTION',instrumentLabel:'label',expiry:'2026-11-23',strike:62000,optionSide:'CE'},
 {instrumentToken:102,symbol:'BANKNIFTY',role:'OPTION',instrumentLabel:'label',expiry:'2026-11-23',strike:62000,optionSide:'PE'}];
const rows=[{instrument_token:1,tradingsymbol:'NIFTY BANK',exchange:'NSE',segment:'INDICES'},
 ...entries.slice(1).map(e=>({instrument_token:e.instrumentToken,tradingsymbol:e.optionSide==='CE'?'BANKNIFTY_TEST_CE':'BANKNIFTY_TEST_PE',exchange:'NFO',name:'BANKNIFTY',expiry:e.expiry,strike:e.strike,instrument_type:e.optionSide})),
 {instrument_token:2,tradingsymbol:'BANKNIFTY_TEST_FUT',exchange:'NFO',name:'BANKNIFTY',expiry:'2026-11-24',instrument_type:'FUT'}];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={},deps={}){
 const dir=mkdtempSync(join(tmpdir(),'bnf-host-test-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({mode:'SHADOW',lots:1,contract_lot_size:30}));
 const starts=[],children=[],statuses=[];
 const host=createBnfShadowHost({enabled:true,entries,masterRows:rows,masterDate:'2026-11-18',configPath:file,
 env:{PATH:process.env.PATH,DATABASE_URL:'synthetic-db',KITE_API_KEY:'synthetic-api-key',KITE_SESSION_ENCRYPTION_KEY:'synthetic-encryption-key',KITE_ACCESS_TOKEN:'must-not-forward',OTHER_SECRET:'must-not-forward'},
 resolveClock:()=>({expired:false,expiryMs:Date.parse('2026-11-23T10:10:00Z')}),onStatus:s=>statuses.push(s),...overrides},
 {now:()=>now,preflight:async()=>({ready:true}),spawn:(...args)=>{
   starts.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.lines=[];
   child.stdin=new Writable({write(chunk,enc,done){child.lines.push(chunk.toString());done();}});
   child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('exit',0)));
   child.kill=()=>{child.emit('exit',null,'SIGTERM');return true;};children.push(child);return child;
 },...deps});
 return {host,starts,children,statuses,cleanup:async()=>{host.stop();await flush();rmSync(dir,{recursive:true,force:true});}};
}
test('disabled host never probes config, starts process or reads credentials',async()=>{const f=fixture({enabled:false,configPath:'/does-not-exist',env:new Proxy({},{get(){throw Error('must-not-read-env');}})},{preflight:()=>{throw Error('must-not-run');}});f.host.onState('OPEN');await flush();assert.equal(f.starts.length,0);assert.equal(f.host.status().phase,'DISABLED');await f.cleanup();});
test('master binding enriches future expiry and adds only a needed reference token',()=>{const p=bindBnfHostMaster(entries,rows,'2026-11-18');assert.deepEqual(p.referenceTokens,[2]);assert.equal(p.entries.at(-1).expiry,'2026-11-24');assert.equal(p.options.get(101).tradingsymbol,'BANKNIFTY_TEST_CE');});
test('wrong option/master identity fails closed',()=>{assert.throws(()=>bindBnfHostMaster(entries,rows.map(r=>r.instrument_token===101?{...r,strike:61900}:r),'2026-11-18'));});
test('missing journal blocks before worker spawn',async()=>{const f=fixture({}, {preflight:async()=>({ready:false,status:'JOURNAL_SCHEMA_REQUIRED'})});f.host.onState('OPEN');await flush();assert.equal(f.starts.length,0);assert.equal(f.host.status().reason,'JOURNAL_SCHEMA_REQUIRED');await f.cleanup();});
test('one child per OPEN generation with minimal env and no shell',async()=>{const f=fixture();f.host.onState('OPEN');await flush();f.host.onState('OPEN');await flush();assert.equal(f.starts.length,1);const [bin,args,options]=f.starts[0];assert.equal(bin,'python');assert.equal(options.shell,false);assert.equal(options.env.EXECUTION_MODE,'SHADOW');assert.equal(options.env.OTHER_SECRET,undefined);assert.equal(options.env.KITE_ACCESS_TOKEN,undefined);assert.equal(args.includes('--init-schema'),false);await f.cleanup();});
test('no packet forwarding until worker READY; same-feed spot/future/option then forwards',async()=>{const f=fixture();f.host.onState('OPEN');await flush();const child=f.children[0];f.host.onPackets([],stamp);assert.equal(child.lines.length,0);
 child.stdout.write(JSON.stringify({status:'SHADOW_WORKER_READY',mode:'SHADOW',broker_orders:0})+'\n');
 const level=p=>[{price:p,quantity:30,orders:1},...Array.from({length:4},()=>({price:0,quantity:0,orders:0}))];
 f.host.onPackets([{instrumentToken:1,mode:'full',isIndex:true,lastPrice:62100,exchangeTimestamp:stamp},{instrumentToken:2,mode:'full',isIndex:false,lastPrice:63000,averageTradePrice:62000,exchangeTimestamp:stamp},{instrumentToken:101,mode:'full',isIndex:false,lastPrice:700,oi:1000,exchangeTimestamp:stamp,marketDepth:{buy:level(699.95),sell:level(700)}}],stamp);
 assert.equal(child.lines.length,1);const event=JSON.parse(child.lines[0]);assert.equal(event.tradingsymbol,'BANKNIFTY_TEST_CE');assert.equal(event.market_context.vwap,62000);assert.equal(event.signal_source.expiry_ts,'2026-11-23T10:10:00.000Z');await f.cleanup();});
test('feed disconnect closes child input and reconnect restarts a fresh worker',async()=>{const f=fixture();f.host.onState('OPEN');await flush();f.host.onState('CLOSED');await flush();assert.equal(f.children[0].stdin.writableEnded,true);f.host.onState('OPEN');await flush();assert.equal(f.starts.length,2);await f.cleanup();});
test('reconnect during preflight never starts obsolete worker',async()=>{const pending=[];const f=fixture({}, {preflight:()=>new Promise(resolve=>pending.push(resolve))});f.host.onState('OPEN');f.host.onState('CLOSED');f.host.onState('OPEN');pending[0]({ready:true});await flush();assert.equal(f.starts.length,0);assert.equal(pending.length,2);pending[1]({ready:true});await flush();assert.equal(f.starts.length,1);await f.cleanup();});
test('raw child output is not echoed and sanitized source metrics exclude arbitrary fields',async()=>{const f=fixture();f.host.onState('OPEN');await flush();const c=f.children[0];c.stderr.write('synthetic-private-error\n');c.stderr.write(JSON.stringify({status:'SHADOW_SOURCE_STATUS',observations:3,signals:1,rejected_iv:2,rejected_oi:-1,rejected_unknown:99,token:'synthetic-private-error'})+'\n');assert.deepEqual(f.host.status().sourceCounts,{observations:3,signals:1,rejected_iv:2});assert.equal(JSON.stringify(f.statuses).includes('synthetic-private-error'),false);await f.cleanup();});

test('worker exit preserves historical diagnostics while live counts remain cleared and no retry is invented',async()=>{
 const f=fixture();f.host.onState('OPEN');await flush();const c=f.children[0];
 c.stderr.write(JSON.stringify({status:'SHADOW_SOURCE_STATUS',observations:12,signals:0,rejected:3,warmup:9,reason:'EXACT_180S_PAIR_WARMUP'})+'\n');
 c.stderr.write(JSON.stringify({status:'SHADOW_WORKER_STOPPED',broker_orders:0,stage:'SESSION_CHECK',reason:'SESSION_CHECK_FAILED',secret:'never-publish'})+'\n');
 c.emit('exit',1,null);await flush();
 const s=f.host.status();assert.equal(s.phase,'BLOCKED');assert.equal(s.reason,'WORKER_EXITED_NO_AUTO_RETRY');
 assert.equal(s.sourceCounts,null);assert.equal(s.childRunning,false);assert.equal(s.health.lastReportedCounts.observations,12);
 assert.equal(s.health.failureStage,'SESSION_CHECK');assert.equal(s.health.failureReason,'SESSION_CHECK_FAILED');
 assert.equal(s.health.exitCode,1);assert.equal(s.health.lastExitAt,stamp);assert.equal(s.health.sourceReason,'EXACT_180S_PAIR_WARMUP');
 assert.equal(f.starts.length,1);assert.ok(!JSON.stringify(s).includes('never-publish'));await f.cleanup();
});
