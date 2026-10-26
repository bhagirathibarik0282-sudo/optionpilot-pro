import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {listH1TheoryRecordedDates} from '../h1-theory-history.js';
test('injected date-index reader retains existing SQL and pg date normalization without a global pool',async()=>{
 let reads=0;
 const result=await listH1TheoryRecordedDates(async<T>(sql:string)=>{
  reads++;assert(sql.includes("kind = 'H1_TRUTH_MARKER'"));assert(sql.includes('COUNT(DISTINCT'));
  return {rows:[{trade_date:new Date('2026-10-19T00:00:00Z'),symbol:'NIFTY',marker_count:'61',first_minute:new Date('2026-10-19T03:45:00Z'),last_minute:null}] as T[]};
 });
 assert.equal(reads,1);assert.equal(result.ok,true);assert.equal(result.dates[0].tradeDate,'2026-10-19');
 assert.equal(result.dates[0].markerCount,61);assert.equal(result.dates[0].firstMinute,'2026-10-19T03:45:00.000Z');
 assert.equal((await listH1TheoryRecordedDates(async()=>null)).reason,'H1_RECORDED_DATE_QUERY_FAILED');
});
test('manual matching validation without its flag exits before database access',()=>{
 const env={...process.env};delete env.PR799_MATCH_HISTORY_ACCEPTANCE;delete env.DATABASE_URL;
 const result=spawnSync(process.execPath,['--import','tsx','scripts/pr799-matched-history-acceptance.ts'],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert(result.stderr.includes('PR799_MATCH_HISTORY_FAILED_NO_RATE'));
 assert(!result.stdout.includes('PR799_MATCH_HISTORY_RESULT'));
});
test('focused history-window diagnostic also requires its own explicit flag before any read',()=>{
 const env={...process.env};delete env.PR799_HISTORY_WINDOW_DIAGNOSTIC;delete env.DATABASE_URL;
 const result=spawnSync(process.execPath,['--import','tsx','scripts/pr799-history-window-diagnostic.ts'],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert(result.stderr.includes('PR799_HISTORY_WINDOW_FAILED'));
 assert(!result.stdout.includes('PR799_HISTORY_WINDOW_RESULT'));
});
