import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readBnfShadowHealth,writeBnfShadowHealth,bnfIstDay,validBnfHealthDate} from '../bnf-shadow-health.js';
import {summarizeBnfShadowDaywise,withBnfShadowDailyStatus} from '../bnf-shadow-daywise.js';

test('worker evidence survives process restart, excludes private fields and does not become full-session proof',t=>{
 const dir=mkdtempSync(join(tmpdir(),'bnf-health-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'health.json');
 assert.equal(writeBnfShadowHealth({date:'2026-11-19',updatedAt:'2026-11-19T04:30:00Z',phase:'BLOCKED',reason:'WORKER_EXITED_NO_AUTO_RETRY',
  lastExitAt:'2026-11-19T04:29:00Z',exitCode:1,lastReportAt:'2026-11-19T04:28:00Z',lastReportedCounts:{observations:11,signals:0,rejected:3,warmup:8,token:'PRIVATE'},
  failureStage:'SESSION_CHECK',failureReason:'SESSION_CHECK_FAILED',account:'PRIVATE',completeSessionVerified:true},file),true);
 const saved=readBnfShadowHealth('2026-11-19',file);
 assert.equal(saved?.lastReportedCounts?.observations,11);assert.equal(saved?.completeSessionVerified,false);
 assert.ok(!readFileSync(file,'utf8').includes('PRIVATE'));
 writeBnfShadowHealth({date:'2026-11-19',phase:'STARTING',reason:'WAIT_WORKER_READY',updatedAt:'2026-11-19T05:00:00Z'},file);
 const restart=readBnfShadowHealth('2026-11-19',file);
 assert.equal(restart?.lastExitAt,saved?.lastExitAt);assert.equal(restart?.lastReportAt,saved?.lastReportAt);
 assert.equal(restart?.lastReportedCounts?.signals,0);assert.equal(restart?.phase,'STARTING');
 assert.equal(readBnfShadowHealth('2026-11-18',file),null);
 writeFileSync(file,'broken');assert.equal(readBnfShadowHealth('2026-11-19',file),null);
});

test('19 November absence stays explicit and never inherits 18 November P&L',()=>{
 const event=(kind:string,state:string)=>({occurred_at:'2026-11-18T10:00:00+05:30',kind,intent_id:'test',payload:{trade:{requested_qty:60,contract:{contract_lot_size:30},state}}});
 const report=summarizeBnfShadowDaywise({days:{'2026-11-18':{realized_estimated:-3093}}},[
  event('ENTRY_INTENT_RECORDED_AND_PAPER_ORDER_CREATED','PENDING'),event('ENTRY_FILL','OPEN'),event('EXIT_FILL','CLOSED')]);
 const result=withBnfShadowDailyStatus(report,'2026-11-19',null);
 assert.equal(result.latestJournalDate,'2026-11-18');assert.equal(result.selectedDay?.status,'NO_JOURNAL_EVENTS');
 assert.equal(result.selectedDay?.scenarios,null);assert.equal(result.selectedDay?.workerEvidence,null);
 assert.equal(result.selectedDay?.marketArchiveProvesPaperTrades,false);
 assert.match(result.selectedDay!.explanation,/does not prove zero trades/);
 assert.equal(result.days[0].scenarios[1].estimatedNetPnlInr,-3093);
});

test('IST dates are real calendar dates, invalid selections fail closed',()=>{
 assert.equal(bnfIstDay(Date.parse('2026-11-19T20:00:00Z')),'2026-11-20');
 assert.equal(validBnfHealthDate('2026-11-31'),false);
 const report=summarizeBnfShadowDaywise({days:{}},[]);
 assert.equal(withBnfShadowDailyStatus(report,'2026-11-31',null).ok,false);
});
