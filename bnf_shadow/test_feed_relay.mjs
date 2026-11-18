import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { installBnfShadowFeedRelay } from './feed_relay.ts';

const time='2026-11-18T04:30:01.000Z', now=Date.parse(time);
function packet(){return { mode:'full', isIndex:false, instrumentToken:101, lastPrice:200, exchangeTimestamp:time,
 marketDepth:{buy:Array.from({length:5},(_,i)=>({price:199.95-i*.05,quantity:30,orders:1})),
 sell:Array.from({length:5},(_,i)=>({price:200+i*.05,quantity:30,orders:1}))}};}
function fixture(overrides={}){
 const lines=[];let observer=null,unsubscribed=0;
 const writer=new Writable({write(chunk,encoding,done){lines.push(chunk.toString());done();}});
 const cfg={enabled:true,writer,registerObserver:fn=>{observer=fn;return()=>{observer=null;unsubscribed++;};},
 contractFor:()=>({instrument_token:101,tradingsymbol:'BANKNIFTY_TEST_CE'}),
 contextFor:()=>({symbol:'BANKNIFTY',vwap_basis:'NEAR_FUTURES_AVERAGE_PRICE',comparison_policy:'LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE',spot_ltp:62100,vwap:62000,spot_ts:time,vwap_ts:time}),now:()=>now,...overrides};
 const relay=installBnfShadowFeedRelay(cfg);
 return {relay,writer,lines,send:(p=packet(),ts=time)=>observer?.([p],ts),unsubscribed:()=>unsubscribed};
}
test('default off registers nothing',()=>{let registered=false;const f=fixture({enabled:undefined,registerObserver:()=>{registered=true;return()=>{};}});assert.equal(registered,false);assert.equal(f.relay.status().installed,false);f.relay.stop();});
test('allowlisted packet shape preserves actual quantity and strips unrelated data',()=>{
 const f=fixture();const p=packet();p.marketDepth.sell[0].quantity=15;p.accessToken='synthetic-secret';p.marketDepth.buy[0].secret='synthetic-secret';f.send(p);
 assert.equal(f.lines.length,1);const e=JSON.parse(f.lines[0]);assert.equal(e.packet.marketDepth.sell[0].quantity,15);
 assert.equal(f.lines[0].includes('synthetic-secret'),false);assert.equal(f.relay.status().extraBrokerConnections,0);f.relay.stop();
});
test('stale quotes and missing context produce no output',()=>{const f=fixture();const p=packet();p.exchangeTimestamp='2026-11-12T04:30:01Z';f.send(p);assert.equal(f.lines.length,0);f.relay.stop();const g=fixture({contextFor:()=>null});g.send();assert.equal(g.lines.length,0);g.relay.stop();});
test('stale VWAP cannot be promoted by a fresh packet receipt',()=>{const f=fixture({contextFor:()=>({symbol:'BANKNIFTY',vwap_basis:'NEAR_FUTURES_AVERAGE_PRICE',comparison_policy:'LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE',spot_ltp:62100,vwap:62000,spot_ts:time,vwap_ts:'2026-11-18T04:29:00Z'})});f.send();assert.equal(f.lines.length,0);f.relay.stop();});
test('partial packets, future clocks and mismatched token are rejected',()=>{for(const change of [p=>p.mode='quote',p=>p.instrumentToken=102,p=>p.exchangeTimestamp='2026-11-18T04:30:02Z',p=>p.exchangeTimestamp='2026-11-18T04:30:01']){const f=fixture();let p=packet();change(p);f.send(p);assert.equal(f.lines.length,0);f.relay.stop();}});
test('write(false) accepted once, drops until drain, never replays old packets',()=>{
 let calls=0;const writer=new Writable({highWaterMark:1,write(chunk,encoding,done){calls++;}});
 const f=fixture({writer});f.send();assert.equal(calls,1);assert.equal(f.relay.status().accepted,1);f.send();assert.equal(f.relay.status().backpressureDrops,1);assert.equal(calls,1);
 writer.emit('drain');assert.equal(f.relay.status().blocked,false);assert.equal(calls,1);f.relay.stop();writer.destroy();
});
test('sink errors contained and observer detached without throwing',()=>{const f=fixture();assert.doesNotThrow(()=>f.writer.emit('error',new Error('synthetic-secret')));assert.equal(f.relay.status().fault,'SINK_ERROR');assert.equal(f.unsubscribed(),1);f.send();assert.equal(f.lines.length,0);f.relay.stop();});
test('stop unregisters but does not close caller-owned sink',()=>{const f=fixture();f.relay.stop();f.send();assert.equal(f.unsubscribed(),1);assert.equal(f.writer.writableEnded,false);assert.equal(f.lines.length,0);});
test('relay JSONL is accepted by the Python depth adapter',()=>{
 const f=fixture();f.send();f.relay.stop();
 const script=`import json,sys\nfrom datetime import datetime\nfrom bnf_shadow.bridge import InstrumentMaster\nfrom bnf_shadow.depth_source import KiteDepthSource\nfrom bnf_shadow.domain import BNFConfig, timestamp\nfrom bnf_shadow.test_snapshot_source import CSV\ne=json.loads(sys.stdin.read())\nt=KiteDepthSource(BNFConfig(),InstrumentMaster(CSV,'2026-11-18')).to_tick(e,timestamp(e['receive_ts']))\nprint(json.dumps({'token':t.instrument_token,'ask_qty':t.best_ask_qty,'bid':t.best_bid}))`;
 const r=spawnSync(process.env.PYTHON||'python',['-c',script],{input:f.lines[0],encoding:'utf8',cwd:new URL('../',import.meta.url)});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{token:101,ask_qty:30,bid:199.95});
});
