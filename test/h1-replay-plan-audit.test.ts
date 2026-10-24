import test from 'node:test';
import assert from 'node:assert/strict';
import {collectH1ReplayPlanQueries,inspectH1ReplayPlans} from '../h1-replay-plan-audit.js';

test('captures the exact two source SQL statements without reading a database',async()=>{
  const queries=await collectH1ReplayPlanQueries();
  assert.deepEqual(queries.map(q=>q.kind),['markers','canonical']);
  for(const q of queries){
    assert.deepEqual(q.params,['NIFTY','2026-10-19','10:45','10:45']);
    assert.match(q.sql,/app_state_log/);
    assert.match(q.sql,/payload->>'symbol' = \$1/);
    assert.match(q.sql,/Asia\/Kolkata/);
  }
});

test('only EXPLAIN is sent under read-only transaction with timeouts and rollback',async()=>{
  const calls:Array<{sql:string;params?:unknown[]}>=[];
  const result=await inspectH1ReplayPlans({query:async(sql,params)=>{
    calls.push({sql,params});
    return {rows:sql.startsWith('EXPLAIN ')?[{'QUERY PLAN':[{Plan:{'Node Type':'Index Scan'}}]}]:[]};
  }});
  assert.equal(result.ok,true);assert.equal(result.analyze,false);
  assert.equal(result.archiveQueryExecuted,false);assert.equal(result.writesPerformed,false);
  assert.equal(calls[0].sql,'BEGIN READ ONLY');
  assert.deepEqual(calls.slice(1,3).map(c=>c.sql),[
    "SET LOCAL statement_timeout = '5s'","SET LOCAL lock_timeout = '1s'"
  ]);
  assert.equal(calls.at(-1)?.sql,'ROLLBACK');
  assert.equal(calls.filter(c=>c.sql.startsWith('EXPLAIN (FORMAT JSON, COSTS TRUE) ')).length,2);
  assert.equal(calls.some(c=>/\bANALYZE\b|\bCOMMIT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b/.test(c.sql)),false);
});

test('failed or absent plan rolls back and never returns success',async()=>{
  for(const fail of ['throw','empty','timeout-setting']){
    const calls:string[]=[];
    await assert.rejects(()=>inspectH1ReplayPlans({query:async sql=>{
      calls.push(sql);
      if(fail==='timeout-setting'&&sql.startsWith('SET LOCAL'))throw Error('settings unavailable');
      if(sql.startsWith('EXPLAIN')&&fail==='throw')throw Error('timeout');
      return {rows:[]};
    }}));
    assert.equal(calls.at(-1),'ROLLBACK');
    assert.equal(calls.filter(c=>c.startsWith('EXPLAIN')).length,fail==='timeout-setting'?0:1);
  }
});
