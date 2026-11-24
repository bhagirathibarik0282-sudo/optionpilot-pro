import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDashboardReplay,replayWatchMinute,sharedFullOiRows,sharedBandOiRows} from '../recorded-dashboard-replay-clock.ts';
const date='2026-11-20', t=(m:number)=>new Date(Date.parse(date+'T09:15:00+05:30')+m*60000).toISOString();
const row=(m:number, extra:any={})=>({symbol:'NIFTY',truth_verdict:'TRUE',minute_bucket:t(m),backend_timestamp:t(m),created_at:t(m),truth_marker_created_at:t(m),quote_timestamp:t(m),ltp:100+m,...extra});
function fixture(){
  const state={date,scope:'FULL',recordedDates:[date],stocks:{live:999},sectors:{future:999},cash:{future:999},ratings:[{future:999}],unknownLiveField:999};
  const prior=Object.fromEntries(Object.entries(row(0)).map(([k,v])=>[['minute_bucket','backend_timestamp','created_at','truth_marker_created_at','quote_timestamp'].includes(k)?k:k,['minute_bucket','backend_timestamp','created_at','truth_marker_created_at','quote_timestamp'].includes(k)?'2026-11-19T10:00:00+05:30':v]));
  const frame={date,at:t(3),playing:true,timeline:[t(0),t(3),t(6)],current:{NIFTY:{market:[row(0),row(3),row(6)],options:[row(3),row(3,{symbol:'SENSEX'}),row(3,{truth_verdict:'PARTIAL'})],chain:[]}},history:{NIFTY:[{market:[prior,row(6)]}]}};
  return {state,frame};
}
test('shared projection excludes future, wrong-index and unqualified observations',()=>{
  const {state,frame}=fixture(), p=projectDashboardReplay(state,frame);
  assert.equal(p.current.NIFTY.market.length,2);assert.equal(p.current.NIFTY.options.length,1);
  assert.equal(p.history.NIFTY[0].market.length,1);assert.equal(p.replay.index,1);
  assert.deepEqual(p.stocks,{});assert.equal(p.sectors,null);assert.equal(p.cash,null);
  assert.deepEqual(p.ratings,[]);assert.equal('unknownLiveField' in p,false);
  assert.equal(frame.current.NIFTY.market.length,3);
});
test('blocked, loading, wrong-date and invalid cursors fail closed',()=>{
  const {state,frame}=fixture();
  for(const p of [projectDashboardReplay(state,frame,true),projectDashboardReplay({...state,archiveLoading:true,loadingDate:'2026-11-23'},frame),projectDashboardReplay(state,{...frame,date:'2026-11-19'}),projectDashboardReplay(state,{...frame,at:t(4)}),projectDashboardReplay(state,null)]){
    assert.deepEqual(p.current.NIFTY.market,[]);assert.deepEqual(p.history.NIFTY,[]);assert.equal(p.replay.at,null);assert.equal(p.replay.playing,false);
  }
});
test('seek backwards returns only past data and leaves source intact',()=>{
  const {state,frame}=fixture();const p=projectDashboardReplay(state,{...frame,at:t(0)});
  assert.equal(p.current.NIFTY.market.length,1);assert.deepEqual(p.current.NIFTY.options,[]);assert.equal(p.replay.index,0);assert.equal(frame.current.NIFTY.market.length,3);
});
test('Watch uses the exact IST minute with session bounds, no rounding',()=>{
  assert.equal(replayWatchMinute(date,t(0)),0);assert.equal(replayWatchMinute(date,t(375)),375);
  assert.equal(replayWatchMinute(date,t(-1)),null);assert.equal(replayWatchMinute(date,t(376)),null);
  assert.equal(replayWatchMinute(date,'2026-11-20T09:15:01+05:30'),null);
  assert.equal(replayWatchMinute('2026-11-19',t(0)),null);assert.equal(replayWatchMinute(date,null),null);
});

test('full OI archive requires same expiry, arithmetic, source and storage cutoff and rejects duplicate minutes',()=>{
 const expiry='2026-11-26',r={symbol:'NIFTY',expiry,sourceAt:new Date(Date.parse(t(0))+10000).toISOString(),recordedAt:new Date(Date.parse(t(0))+20000).toISOString(),ceOi:100,peOi:75,pcr:.75};
 assert.equal(sharedFullOiRows([r],date,'NIFTY',expiry,t(0)).size,0);
 assert.equal(sharedFullOiRows([r],date,'NIFTY',expiry,t(1)).get(0)?.pcr,.75);
 for(const x of [{...r,recordedAt:undefined},{...r,recordedAt:t(2)},{...r,expiry:'2026-12-01'},{...r,pcr:2}])assert.equal(sharedFullOiRows([x],date,'NIFTY',expiry,t(3)).size,0);
 assert.equal(sharedFullOiRows([r,r],date,'NIFTY',expiry,t(1)).size,0);
});
test('band totals are calculated from exactly 30 same-snapshot legs, never full PCR or reported band',()=>{
 const expiry='2026-11-26',market=[{symbol:'NIFTY',minute_bucket:t(0),truth_verdict:'TRUE',snapshot_id:'S'}];
 const options=Array.from({length:15},(_,i)=>['CE','PE'].map(side=>({symbol:'NIFTY',expiry,minute_bucket:t(0),truth_verdict:'TRUE',snapshot_id:'S',atm_offset:i-7,option_type:side,strike:25000+i*50,oi:side==='CE'?100:80,quote_timestamp:t(0),quote_age_seconds:0}))).flat();
 const read=(legs:any[])=>sharedBandOiRows({market,options:legs},date,'NIFTY',expiry,t(0)).get(0);
 assert.deepEqual(read(options),{expiry,ceOi:1500,peOi:1200,pcr:.8,basket:Array.from({length:15},(_,i)=>25000+i*50).join('|'),coverage:30});
 assert.equal(read(options.slice(1)),undefined);
 for(const change of [{snapshot_id:'X'},{quote_timestamp:t(1)},{quote_age_seconds:31},{oi:-1},{strike:99999},{atm_offset:null}])assert.equal(read([{...options[0],...change},...options.slice(1)]),undefined);
 assert.equal(read([options[1],...options.slice(1)]),undefined);
});

test('actual 20 Nov 09:20 market clocks: no early display, missing clocks fail closed',()=>{
 const {state,frame}=fixture();
 const sample=row(5,{backend_timestamp:'2026-11-20T03:50:55.862Z',created_at:'2026-11-20T03:52:01.326238Z',truth_marker_created_at:'2026-11-20T03:52:02Z'});
 const timeline=[t(5),t(7),t(8)];
 const read=(at:string,market:any[],options:any[]=[],chain:any[]=[])=>projectDashboardReplay(state,{...frame,at,timeline,current:{NIFTY:{market,options,chain}}}).current.NIFTY;
 assert.equal(read(t(5),[sample]).market.length,0);
 assert.equal(read(t(7),[sample]).market.length,0);
 assert.equal(read(t(8),[sample]).market.length,1);
 assert.equal(read(t(8),[{...sample,created_at:null}]).market.length,0);
 assert.equal(read(t(8),[{...sample,truth_marker_created_at:undefined}]).market.length,0);
 const option=row(5,{quote_timestamp:'2026-11-20T03:50:56Z',created_at:t(9),truth_marker_created_at:t(7)});
 assert.equal(read(t(8),[sample],[option]).options.length,0);
 const chain=row(5,{created_at:t(7),truth_marker_created_at:t(7),full_pcr_source:'Exact archived full-chain source',full_chain_oi_pcr:1.2,full_pcr_source_timestamp:'2026-11-20T03:50:55Z',full_pcr_recorded_at:t(9)});
 assert.equal(read(t(8),[sample],[],[chain]).chain[0].full_chain_oi_pcr,null);
 assert.equal(read(t(8),[sample],[],[{...chain,full_pcr_recorded_at:t(7)}]).chain[0].full_chain_oi_pcr,1.2);
 assert.equal(chain.full_chain_oi_pcr,1.2);
});
