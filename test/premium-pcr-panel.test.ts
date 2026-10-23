import test from 'node:test';
import assert from 'node:assert/strict';
import {measurePcrSnapshot,PCR_REFRESH_MS} from '../dashboard-pcr-sampler.js';
import {deriveLiveThreeIndexPcr} from '../live-three-index-pcr.js';
import {derivePremiumPcrPanel as panel} from '../premium-pcr-panel.js';
import type {LiveEntry} from '../dashboard-live-feed.js';

const date='2026-10-23',expiry='2026-10-27',start=Date.parse(date+'T04:30:00Z');
function fixture(minute=0,spotPrice=23000,change?:(entries:LiveEntry[],quotes:any)=>void){
 const now=start+minute*60000,stamp=new Date(now).toISOString();
 const indices=['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>{
  const entries:LiveEntry[]=Array.from({length:41},(_,i)=>['CE','PE'].map((side,j)=>({token:100+i*2+j,exchange:'NFO',label:symbol+i+side,role:'OPTION' as const,symbol:symbol as any,expiry,strike:22000+i*50,side:side as 'CE'|'PE'}))).flat();
  const quotes=Object.fromEntries(entries.map(e=>[e.exchange+':'+e.label,{instrument_token:e.token,oi:e.side==='CE'?100+minute:200+3*minute,volume:e.side==='CE'?1000+10*minute:2000+20*minute,timestamp:stamp}]));
  quotes[entries[0].exchange+':'+entries[0].label].timestamp=new Date(now-31000).toISOString(); // An outer strike blocks fresh Full PCR only.
  change?.(entries,quotes);
  const spot={identity:{role:'SPOT',symbol},state:'LIVE',price:spotPrice,observedAt:stamp,receivedAt:stamp};
  return {symbol,expiry,expiries:[expiry],spot,pcrSnapshot:{...measurePcrSnapshot(entries,quotes,date,now,now,spot),fetchState:'OK'}};
 });
 return {connected:true,connectionState:'OPEN',source:'KITE_WEBSOCKET_FULL',serverTime:stamp,snapshot:{runtimeId:'band-panel-test',tradeDate:date,asOf:stamp,indices}};
}
const read=(p:any,previous:any=null,scope='BAND',period=60000)=>panel(p,deriveLiveThreeIndexPcr(p),previous,scope,period);
test('exact 15-strike band remains usable with an inactive outer quote; full is separately reported',()=>{
 const p=fixture(),v=read(p);assert.equal(PCR_REFRESH_MS,60000);assert.equal(v.rows.length,3);
 for(const r of v.rows){assert.equal(r.current?.value,2);assert.equal(r.current?.expected,30);assert.equal(r.current?.ce,1500);assert.equal(r.current?.pe,3000);assert.equal(r.current?.from,22650);assert.equal(r.current?.anchor,23000);assert.equal(r.current?.to,23350);assert.deepEqual(r.current?.volume,{ce:15000,pe:30000,value:2});assert.equal(r.direction,'WAIT');}
 const full=read(p,null,'FULL');assert.equal(full.rows[0].current,null);assert.equal(full.rows[0].reported?.value,2);assert.equal(full.rows[0].direction,'WAIT');
});
test('one-minute deltas and three-minute deltas use exact fixed membership and observed endpoint volumes',()=>{
 const first=read(fixture()),next=read(fixture(1),first);assert.equal(next.rows[0].direction,'UP');assert.deepEqual(next.rows[0].oiDelta,{ce:15,pe:45});assert.deepEqual(next.rows[0].volumeDelta,{ce:150,pe:300});
 let three=read(fixture(),null,'BAND',180000);for(let m=1;m<=3;m++)three=read(fixture(m),three,'BAND',180000);
 assert.equal(three.rows[0].direction,'UP');assert.equal(three.rows[0].baselineAt,start);assert.deepEqual(three.rows[0].oiDelta,{ce:45,pe:135});assert.deepEqual(three.rows[0].volumeDelta,{ce:450,pe:900});
 for(let m=4;m<=20;m++)three=read(fixture(m),three,'BAND',180000);assert.equal(three.rows[0].samples.length,8);
});
test('ATM, contract membership, expiry, runtime, gaps, invalid checks and period changes reset comparisons',()=>{
 const first=read(fixture());const moved=read(fixture(1,23050),first);assert.equal(moved.rows[0].direction,'WAIT');assert.equal(moved.rows[0].current?.anchor,23050);
 const gap=read(fixture(3),first);assert.equal(gap.rows[0].samples.length,1);assert.equal(gap.rows[0].direction,'WAIT');
 for(const change of [(p:any)=>p.snapshot.runtimeId='new',(p:any)=>p.snapshot.indices[0].pcrSnapshot.bandPcr.membershipKey=p.snapshot.indices[0].pcrSnapshot.bandPcr.membershipKey.replace('126:', '1126:')]){const p=fixture(1);change(p);assert.equal(read(p,first).rows[0].direction,'WAIT');}
 const missing=fixture(1);missing.snapshot.indices[0].pcrSnapshot.bandPcr.state='INCOMPLETE';const failed=read(missing,first);assert.equal(failed.rows[0].current,null);assert.equal(read(fixture(2),failed).rows[0].direction,'WAIT');
 assert.equal(read(fixture(1),first,'BAND',180000).rows[0].direction,'WAIT');assert.equal(read(null,first).rows[0].current,null);
});
test('band invalid identities, timestamps, fetch failures and disconnect cannot produce readings',()=>{
 const mutations=[(p:any)=>p.connected=false,(p:any)=>p.serverTime=new Date(start+90001).toISOString(),(p:any)=>p.snapshot.indices[0].pcrSnapshot.fetchState='RATE_LIMITED',(p:any)=>p.snapshot.indices[0].pcrSnapshot.bandPcr.ceTotal=0,(p:any)=>p.snapshot.indices[0].pcrSnapshot.bandPcr.strikes.pop(),(p:any)=>p.snapshot.indices[0].pcrSnapshot.bandPcr.sourceMinAt=new Date(start-31000).toISOString(),(p:any)=>p.snapshot.indices[0].pcrSnapshot.bandPcr.membershipKey='duplicate',(p:any)=>p.snapshot.indices[0].pcrSnapshot.bandPcr.anchorStrike=999];
 for(const mutate of mutations){const p=fixture();mutate(p);assert.equal(read(p).rows[0].current,null);}
 const badInner=read(fixture(0,23000,(es,qs)=>{delete qs[es[40].exchange+':'+es[40].label];}));assert.equal(badInner.rows[0].current,null);
});
test('missing volume withholds volume only, real zero survives, and cumulative corrections cannot become negative window volume',()=>{
 const missing=read(fixture(0,23000,(es,qs)=>{delete qs[es[40].exchange+':'+es[40].label].volume;}));assert.equal(missing.rows[0].current?.value,2);assert.equal(missing.rows[0].current?.volume,null);
 const zero=read(fixture(0,23000,(es,qs)=>{for(const e of es){const q=qs[e.exchange+':'+e.label];if(e.side==='PE')q.oi=0;if(e.side==='CE')q.volume=0;}}));assert.equal(zero.rows[0].current?.value,0);assert.equal(zero.rows[0].current?.volume?.ce,0);assert.equal(zero.rows[0].current?.volume?.value,null);
 const corrected=read(fixture(1,23000,(es,qs)=>{for(const e of es)qs[e.exchange+':'+e.label].volume=1;}),read(fixture()));assert.equal(corrected.rows[0].volumeDelta,null);assert.equal(corrected.rows[0].direction,'UP');
});
test('repeated, mutated and backward cycles cannot create a comparison or restart a corrupted sample',()=>{
 const first=read(fixture());const repeat=read(fixture(),first);assert.equal(repeat.rows[0].samples.length,1);
 const mutated=fixture();mutated.snapshot.indices[0].pcrSnapshot.bandPcr.volume!.ceTotal=999;mutated.snapshot.indices[0].pcrSnapshot.bandPcr.volume!.value=30000/999;
 const rejected=read(mutated,first);assert.equal(rejected.rows[0].current,null);assert.equal(read(mutated,rejected).rows[0].current,null);
 const later=read(fixture(1),first);assert.equal(read(fixture(),later).rows[0].current,null);
});
