import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {canonicalReplayReadSql} from '../h1-replay-http.js';

// Fixed read-only diagnosis. No HTTP listener, schema change or application startup.
const enabled=process.env.PR799_LOOKUP_PROOF==='QUALIFY_AND_COMPARE_READ_ONLY';
const url=process.env.DATABASE_URL?.trim();
if(!enabled||!url){console.error(JSON.stringify({ok:false,phase:'guard',reason:'LOOKUP_PROOF_NOT_ENABLED_OR_DB_UNAVAILABLE'}));process.exitCode=2;}
else{
 let client:pg.Client|undefined,result:any,failed=false,phase='connect',sqlState:string|null=null,resourceLimit:string|null=null;
 const completed:Record<string,unknown>={};
 const deadline=setTimeout(()=>{console.error(JSON.stringify({ok:false,phase,reason:'LOOKUP_PROOF_DEADLINE'}));process.exit(1);},150000);
 try{
   client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,query_timeout:50000,
     application_name:'pr799-readonly-lookup-proof',
     options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000 -c temp_file_limit=65536'});
   client.on('error',()=>{failed=true;});await client.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await client.query("SET LOCAL TimeZone='UTC'");
   assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
   phase='metadata';
   const metadata=(await client.query(`WITH keys AS MATERIALIZED (
     SELECT kind,payload->>'symbol' AS symbol,jsonb_typeof(payload->'symbol') AS symbol_type
     FROM public.app_state_log WHERE kind IN ('H1_TRUTH_MARKER','H1_CANONICAL_MARKET_ARCHIVE'))
     SELECT kind,COUNT(*)::integer AS rows,
       COUNT(*) FILTER(WHERE symbol_type IS DISTINCT FROM 'string')::integer AS non_string_symbols,
       COUNT(*) FILTER(WHERE symbol IS NULL OR symbol NOT IN ('NIFTY','SENSEX','BANKNIFTY'))::integer AS unexpected_symbols,
       MAX(octet_length(kind)+COALESCE(octet_length(symbol),0))::integer AS max_key_bytes
     FROM keys GROUP BY kind ORDER BY kind`)).rows;
   completed.metadata=metadata;
   const indexes=(await client.query(`SELECT c.relname AS name,i.indisvalid AS valid,i.indisready AS ready,
       pg_relation_size(c.oid)::text AS bytes,pg_get_indexdef(c.oid) AS definition
     FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE i.indrelid='public.app_state_log'::regclass ORDER BY c.relname`)).rows;
   completed.indexes=indexes;
   const storage=(await client.query(`SELECT pg_database_size(current_database())::text AS database_bytes,
     pg_total_relation_size('public.app_state_log')::text AS relation_bytes,
     (SELECT COUNT(*)::integer FROM pg_stat_progress_create_index WHERE relid='public.app_state_log'::regclass) AS active_index_builds,
     (SELECT COUNT(*)::integer FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND xact_start<now()-interval '5 minutes') AS older_transactions`)).rows[0];
   completed.storage=storage;
   const captured=JSON.parse(readFileSync(new URL('../docs/audits/pr799-paired-query-plan-20261025.json',import.meta.url),'utf8'));
   const old=captured.queries.find((q:any)=>q.kind==='canonical');
   const candidate=canonicalReplayReadSql(false,true);
   // Fingerprints are multisets. Sorting wide raw market JSON before hashing
   // adds no evidence and can exceed the diagnostic's 64MiB temp-file budget.
   // Keep all predicates/rows; sort only the resulting 32-byte digests.
   const scanOnly=(sql:string)=>sql.replace(/ORDER BY p\."minuteBucket"::timestamptz ASC\s*$/,'');
   const fingerprint=async(sql:string)=>{
     const start=performance.now();
     const value=(await client!.query(`SELECT COUNT(*)::integer AS rows,
       COUNT(*) FILTER(WHERE market IS NULL)::integer AS sql_null_markets,
       md5(string_agg(digest,',' ORDER BY digest)) AS fingerprint FROM (
         SELECT market,md5((CASE WHEN market IS NULL THEN 'SQLNULL:' ELSE 'JSON:' END)||to_jsonb(r)::text) AS digest
         FROM (${scanOnly(sql)}) AS r) AS evidence`,old.params)).rows[0];
     return {...value,elapsedMs:Math.round((performance.now()-start)*10)/10};
   };
   phase='baseline_fingerprint';const baseline=await fingerprint(old.sql);
   phase='candidate_fingerprint';const current=await fingerprint(candidate);
   assert.deepEqual({...current,elapsedMs:0},{...baseline,elapsedMs:0});
   phase='baseline_actual_plan';
   const baselinePlan=(await client.query('EXPLAIN (ANALYZE TRUE, BUFFERS TRUE, TIMING FALSE, FORMAT JSON) '+scanOnly(old.sql),old.params)).rows[0]['QUERY PLAN'];
   phase='candidate_plan';
   const candidatePlan=(await client.query('EXPLAIN (FORMAT JSON, COSTS TRUE) '+candidate,old.params)).rows[0]['QUERY PLAN'];
   result={ok:true,mode:'PR799_READ_ONLY_LOOKUP_ROOT_CAUSE_PROOF',readOnly:true,writesPerformed:false,
     metadata,indexes,storage,baseline,current,baselinePlan,candidatePlan,
     baselineActualPlanScope:'Original predicates/projection without ORDER BY; bounded scan diagnosis, not whole-handler timing.',
     comparison:'Same REPEATABLE READ snapshot; baseline first. Cache/order effects are uncontrolled.',
     limits:{statementMs:45000,lockMs:1000,processMs:150000,tempFileLimitKiB:65536}};
   phase='rollback';await client.query('ROLLBACK');
 }catch(error){failed=true;const code=(error as any)?.code;if(typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code))sqlState=code;
   if(/temporary file size exceeds temp_file_limit/.test(String((error as any)?.message)))resourceLimit='DIAGNOSTIC_TEMP_FILE_LIMIT';}
 finally{try{await client?.end();}catch{failed=true;}clearTimeout(deadline);}
 if(failed||!result){console.error(JSON.stringify({ok:false,phase,sqlState,resourceLimit,completed,reason:'READ_ONLY_LOOKUP_PROOF_FAILED'}));process.exitCode=1;}
 else console.log(JSON.stringify(result));
}
