import test from 'node:test';
import assert from 'node:assert/strict';
import {projectDashboardReplay,replayWatchMinute} from '../recorded-dashboard-replay-clock.ts';
const date='2026-11-20', t=(m:number)=>new Date(Date.parse(date+'T09:15:00+05:30')+m*60000).toISOString();
const row=(m:number, extra:any={})=>({symbol:'NIFTY',truth_verdict:'TRUE',minute_bucket:t(m),ltp:100+m,...extra});
function fixture(){
  const state={date,scope:'FULL',recordedDates:[date],stocks:{live:999},sectors:{future:999},cash:{future:999},ratings:[{future:999}],unknownLiveField:999};
  const prior={...row(0),minute_bucket:'2026-11-19T10:00:00+05:30'};
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
