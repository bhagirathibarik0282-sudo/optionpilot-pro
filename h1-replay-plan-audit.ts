import {runH1ReplayRead, type H1ReplayRequest} from './h1-replay-http.js';

// Fixed diagnostic for the actual slow request. No HTTP surface, SQL input,
// arbitrary date sweep, data reads, schema changes or execution authority.
export const H1_PLAN_AUDIT_REQUEST:H1ReplayRequest={
  symbol:'NIFTY',tradeDate:'2026-10-19',fromTime:'10:45',toTime:'10:45',scope:'FULL'
};
type SourceQuery={kind:'markers'|'canonical';sql:string;params:unknown[]};
export async function collectH1ReplayPlanQueries():Promise<SourceQuery[]>{
  const queries:SourceQuery[]=[];
  // Capture the SQL from the real replay builder without calling its DB reader.
  // Empty injected marker rows suppress normalized reads. Raw-gap SQL is never
  // sent to a database and is not part of this two-plan audit.
  const result=await runH1ReplayRead({...H1_PLAN_AUDIT_REQUEST},async(sql,params)=>{
    const kind=sql.includes("kind = 'H1_TRUTH_MARKER'")?'markers':
      sql.includes("kind = 'H1_CANONICAL_MARKET_ARCHIVE'")?'canonical':null;
    if(kind)queries.push({kind,sql,params:[...params]});
    return [];
  });
  if(!result.ok||queries.length!==2||queries[0].kind!=='markers'||queries[1].kind!=='canonical')
    throw new Error('EXACT_REPLAY_PLAN_QUERY_CAPTURE_FAILED');
  return queries;
}
export interface PlanAuditClient {
  query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[]}>
}
export async function inspectH1ReplayPlans(client:PlanAuditClient){
  const queries=await collectH1ReplayPlanQueries();
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const plans=[];
    for(const source of queries){
      const result=await client.query('EXPLAIN (FORMAT JSON, COSTS TRUE) '+source.sql,source.params);
      const plan=result.rows[0]?.['QUERY PLAN'];
      if(!Array.isArray(plan)||plan.length!==1||!plan[0]?.Plan||
        typeof plan[0].Plan['Node Type']!=='string'||!plan[0].Plan['Node Type'].trim())
        throw new Error('EXPLAIN_PLAN_UNAVAILABLE');
      plans.push({kind:source.kind,plan});
    }
    return {ok:true,mode:'READ_ONLY_H1_REPLAY_PLAN_AUDIT_V1',request:{...H1_PLAN_AUDIT_REQUEST},
      readOnly:true,analyze:false,archiveQueryExecuted:false,writesPerformed:false,plans};
  } finally {
    await client.query('ROLLBACK');
  }
}
