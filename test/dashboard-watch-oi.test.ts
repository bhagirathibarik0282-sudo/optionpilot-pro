import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardWatchOiCycle, readDashboardWatchOi, DASHBOARD_WATCH_OI_KIND } from '../dashboard-watch-oi.js';

const date='2026-11-23',expiry='2026-11-26',cycleAt=date+'T03:45:00.000Z';
const snapshot={source:'KITE_REST_FULL_EXPIRY_SNAPSHOT',state:'COMPLETE',fetchState:'OK',cycleStartedAt:cycleAt,
 checkedAt:date+'T03:45:20Z',sourceMinAt:date+'T03:45:14Z',sourceMaxAt:date+'T03:45:19Z',
 coverage:{complete:true,expected:15,freshOi:15},ceTotal:200,peTotal:0,fullPcr:0,callWall:{strike:26000},putWall:null};

test('Watch archives only the complete nearest expiry at its own source minute',()=>{
 const samples=new Map([
  ['NIFTY|'+expiry,snapshot],['NIFTY|2026-12-01',{...snapshot,peTotal:100,fullPcr:0.5}],
  ['BANKNIFTY|'+expiry,{...snapshot,coverage:{...snapshot.coverage,freshOi:14}}],
  ['BANKNIFTY|2026-12-01',snapshot],['SENSEX|'+expiry,{...snapshot,sourceMinAt:date+'T03:44:58Z'}],
 ]);
 const archive=dashboardWatchOiCycle(date,cycleAt,samples);
 assert.equal(archive?.version,DASHBOARD_WATCH_OI_KIND);
 assert.deepEqual(archive?.rows,[{symbol:'NIFTY',expiry,sourceAt:date+'T03:45:19.000Z',pcr:0,ceOi:200,peOi:0,ceWall:26000,peWall:null}]);
 assert.equal(dashboardWatchOiCycle(date,cycleAt,new Map([['NIFTY|'+expiry,{...snapshot,fullPcr:1}]])),null);
});

test('Watch OI history preserves source times, exposes only current date rows and validates old payloads',async()=>{
 const payload=dashboardWatchOiCycle(date,cycleAt,new Map([['NIFTY|'+expiry,snapshot]]))!;
 const now=new Date(date+'T05:00:00Z');
 const response=await readDashboardWatchOi(date,async(sql,params)=>{
  assert.match(sql,/WHERE kind=\$1 AND created_at >= \$2 AND created_at < \$3 .* LIMIT 376/);
  assert.deepEqual(params,[DASHBOARD_WATCH_OI_KIND,'2026-11-22T18:30:00.000Z','2026-11-23T18:30:00.000Z']);
  const older={...payload.rows[0],sourceAt:date+'T03:45:17.000Z',ceOi:201};
  const invalid={...payload.rows[0],sourceAt:date+'T03:46:00.000Z',pcr:-0.1};
  return {rows:[{payload},{payload:{...payload,rows:[older,invalid]}},{payload:{...payload,tradeDate:'2026-11-22'}}]};
 },now);
 assert.deepEqual(response,{date,rows:payload.rows});
 await assert.rejects(readDashboardWatchOi('2026-11-24',async()=>{throw Error('Unexpected query');},now),/INVALID_DATE/);
});

test('readback attaches valid storage timestamps without altering old payloads',async()=>{
 const payload=dashboardWatchOiCycle(date,cycleAt,new Map([['NIFTY|'+expiry,snapshot]]))!;
 const now=new Date(date+'T05:00:00Z'),recordedAt=date+'T03:45:22.000Z';
 const response=await readDashboardWatchOi(date,async()=>({rows:[{payload,recorded_at:new Date(recordedAt)}]}),now);
 assert.deepEqual(response.rows,[{...payload.rows[0],recordedAt}]);
 const unqualified=await readDashboardWatchOi(date,async()=>({rows:[{payload,recorded_at:date+'T03:45:00Z'}]}),now);
 assert.deepEqual(unqualified.rows,payload.rows);
});
