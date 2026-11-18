import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { BnfMarketReferenceCache, installBnfShadowTradingFeed } from './market_context.ts';
const instant=Date.parse('2026-11-18T04:30:01Z'), iso=ms=>new Date(ms).toISOString();
const entries=[{instrumentToken:1,symbol:'BANKNIFTY',role:'SPOT',instrumentLabel:'BANKNIFTY SPOT'},
 {instrumentToken:2,symbol:'BANKNIFTY',role:'FUTURE',instrumentLabel:'BANKNIFTY_TEST_NEAR',expiry:'2026-11-24'},
 {instrumentToken:3,symbol:'BANKNIFTY',role:'FUTURE',instrumentLabel:'BANKNIFTY_TEST_FAR',expiry:'2026-12-29'}];
function spot(ms=instant){return {mode:'full',isIndex:true,instrumentToken:1,lastPrice:62100,exchangeTimestamp:iso(ms)};}
function future(ms=instant){return {mode:'full',isIndex:false,instrumentToken:2,lastPrice:63000,averageTradePrice:62000,exchangeTimestamp:iso(ms)};}
function fixture(){let clock=instant,online=true;const cache=new BnfMarketReferenceCache(entries,'2026-11-18',()=>online,()=>clock);
 return {cache,clock:ms=>clock=ms,online:flag=>online=flag,seed:()=>cache.ingest([spot(),future()],iso(instant))};}

test('near-futures average is explicit and never called spot VWAP',()=>{const f=fixture();f.seed();const c=f.cache.read();assert.equal(c.spot_ltp,62100);assert.equal(c.vwap,62000);assert.equal(c.vwap_basis,'NEAR_FUTURES_AVERAGE_PRICE');assert.equal(c.comparison_policy,'LEGACY_SPOT_VS_NEAR_FUTURES_AVERAGE');assert.equal(f.cache.identity().nearFutureToken,2);});
test('reference expires after five seconds without new receipts',()=>{const f=fixture();f.seed();f.clock(instant+5001);assert.equal(f.cache.read(),null);});
test('disconnection revokes cache and reconnect needs fresh evidence',()=>{const f=fixture();f.seed();f.online(false);assert.equal(f.cache.read(),null);f.online(true);assert.equal(f.cache.read(),null);});
test('invalid new futures average revokes previous value instead of using LTP',()=>{const f=fixture();f.seed();f.clock(instant+1000);const p=future(instant+1000);p.averageTradePrice=0;f.cache.ingest([p],iso(instant+1000));assert.equal(f.cache.read(),null);});
test('old or duplicate packets cannot overwrite a newer reference',()=>{const f=fixture();f.seed();const p=future(instant-1000);p.averageTradePrice=100;f.cache.ingest([p],iso(instant));assert.equal(f.cache.read().vwap,62000);});
test('day rollover requires a new current master',()=>{const f=fixture();f.seed();f.clock(instant+86400000);assert.equal(f.cache.read(),null);assert.throws(()=>new BnfMarketReferenceCache(entries,'2026-11-17',()=>true,()=>instant),/CURRENT_MASTER/);});
test('missing, ambiguous or malformed future identity rejects',()=>{for(const rows of [entries.filter(e=>e.role!=='SPOT'),[...entries,{...entries[1],instrumentToken:4}],entries.map(e=>e.role==='FUTURE'?{...e,expiry:null}:e)])assert.throws(()=>new BnfMarketReferenceCache(rows,'2026-11-18',()=>true,()=>instant));});
test('far-future and unrelated packets never replace near-future reference',()=>{const f=fixture();f.seed();f.clock(instant+1000);f.cache.ingest([{...future(instant+1000),instrumentToken:3,averageTradePrice:999}],iso(instant+1000));assert.equal(f.cache.read().vwap,62000);});
test('host binding updates reference before emitting option JSONL in same batch',()=>{
 let observer=null,detached=0;const lines=[];const writer=new Writable({write(chunk,enc,done){lines.push(chunk.toString());done();}});
 const binding=installBnfShadowTradingFeed({enabled:true,writer,entries,masterDate:'2026-11-18',connected:()=>true,now:()=>instant,
 registerObserver:fn=>{observer=fn;return()=>{observer=null;detached++;};},contractFor:token=>token===101?{instrument_token:101,tradingsymbol:'BANKNIFTY_TEST_CE'}:null});
 const levels=price=>Array.from({length:5},(_,i)=>({price:price+i*.05,quantity:30,orders:1}));
 const option={mode:'full',isIndex:false,instrumentToken:101,lastPrice:200,exchangeTimestamp:iso(instant),marketDepth:{buy:levels(199).reverse(),sell:levels(200)}};
 observer([option,future(),spot()],iso(instant));assert.equal(lines.length,1);const event=JSON.parse(lines[0]);assert.equal(event.market_context.vwap,62000);assert.equal(event.market_context.vwap_basis,'NEAR_FUTURES_AVERAGE_PRICE');assert.equal(binding.status().extraBrokerConnections,0);binding.stop();assert.equal(detached,1);assert.equal(writer.writableEnded,false);
});
test('disabled binding does not inspect master, register or write',()=>{let registered=0;const writer=new Writable({write(){throw Error('must not write');}});const binding=installBnfShadowTradingFeed({enabled:false,writer,entries:[],masterDate:'',connected:()=>false,registerObserver:()=>{registered++;return()=>{};},contractFor:()=>null});assert.equal(registered,0);assert.equal(binding.identity(),null);binding.stop();});
