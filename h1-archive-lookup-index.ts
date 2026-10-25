import assert from 'node:assert/strict';

export const H1_LOOKUP_INDEX_NAME='idx_app_state_log_h1_kind_symbol';
export const H1_LOOKUP_INDEX_SQL=`CREATE INDEX CONCURRENTLY idx_app_state_log_h1_kind_symbol
 ON public.app_state_log (kind,(payload->>'symbol'))
 WHERE kind IN ('H1_TRUTH_MARKER','H1_CANONICAL_MARKET_ARCHIVE')`;
export const H1_LOOKUP_METADATA_SQL=`WITH keys AS MATERIALIZED (
 SELECT kind,payload->>'symbol' AS symbol,jsonb_typeof(payload->'symbol') AS symbol_type
 FROM public.app_state_log WHERE kind IN ('H1_TRUTH_MARKER','H1_CANONICAL_MARKET_ARCHIVE'))
 SELECT kind,COUNT(*)::integer AS rows,
 COUNT(*) FILTER(WHERE symbol_type IS DISTINCT FROM 'string')::integer AS non_string_symbols,
 COUNT(*) FILTER(WHERE symbol IS NULL OR symbol NOT IN ('NIFTY','SENSEX','BANKNIFTY'))::integer AS unexpected_symbols,
 MAX(octet_length(kind)+COALESCE(octet_length(symbol),0))::integer AS max_key_bytes
 FROM keys GROUP BY kind ORDER BY kind`;
export type LookupProviderObservation={capacityBytes:number;usedBytes:number;observedAt:number};
export function lookupBuildBudget(metadata:any[],provider:LookupProviderObservation,now=Date.now()){
 assert.equal(provider.capacityBytes,5000000000,'reviewed volume capacity must match');
 assert(Number.isFinite(provider.usedBytes)&&provider.usedBytes>=0&&provider.usedBytes<provider.capacityBytes);
 assert(Number.isFinite(provider.observedAt)&&now-provider.observedAt>=-30000&&now-provider.observedAt<=300000,'provider observation must be fresh');
 assert.deepEqual(metadata.map(r=>r.kind).sort(),['H1_CANONICAL_MARKET_ARCHIVE','H1_TRUTH_MARKER']);
 let indexUpperBoundBytes=0;
 for(const row of metadata){
   assert(Number.isInteger(row.rows)&&row.rows>0&&row.rows<=1000000);
   assert.equal(row.non_string_symbols,0);assert.equal(row.unexpected_symbols,0);
   assert(Number.isInteger(row.max_key_bytes)&&row.max_key_bytes>0&&row.max_key_bytes<=128);
   indexUpperBoundBytes+=Math.ceil(row.rows*(row.max_key_bytes+64)/0.6);
 }
 // Conservative planning allowance, not a filesystem-free-space guarantee:
 // discount capacity 5%, reserve 1GiB for normal operation, then budget at least
 // 64MiB or 8x the key-based index bound for build/WAL/temp overhead.
 const operatingReserveBytes=1073741824;
 const buildAllowanceBytes=Math.max(67108864,indexUpperBoundBytes*8);
 const conservativeAvailableBytes=Math.floor(provider.capacityBytes*.95)-provider.usedBytes;
 assert(conservativeAvailableBytes>operatingReserveBytes+buildAllowanceBytes,'insufficient conservative provider headroom');
 return {indexUpperBoundBytes,operatingReserveBytes,buildAllowanceBytes,conservativeAvailableBytes,
   capacityDiscountPct:5,providerObservationAgeMs:now-provider.observedAt};
}
type Client={query(sql:string,params?:unknown[]):Promise<{rows:any[]}>};
export async function buildReviewedH1LookupIndex(client:Client,provider:LookupProviderObservation){
 assert.equal((await client.query('SELECT pg_try_advisory_lock(799,20261025) AS acquired')).rows[0]?.acquired,true);
 let metadata:any[],state:any;
 await client.query('BEGIN READ ONLY');
 try{
   metadata=(await client.query(H1_LOOKUP_METADATA_SQL)).rows;
   state=(await client.query(`SELECT to_regclass('public.idx_app_state_log_h1_kind_symbol')::text AS existing,
     (SELECT COUNT(*)::integer FROM pg_stat_progress_create_index WHERE relid='public.app_state_log'::regclass) AS builds,
     (SELECT COUNT(*)::integer FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND xact_start<now()-interval '5 minutes') AS older_transactions`)).rows[0];
 }finally{await client.query('ROLLBACK');}
 assert.equal(state.existing,null,'existing index requires inspection; never overwrite');
 assert.equal(state.builds,0);assert.equal(state.older_transactions,0);
 const budget=lookupBuildBudget(metadata,provider);
 await client.query("SET maintenance_work_mem='16MB'");
 await client.query("SET temp_file_limit='64MB'");
 await client.query("SET lock_timeout='1s'");
 await client.query("SET statement_timeout='120s'");
 const start=performance.now();
 await client.query(H1_LOOKUP_INDEX_SQL);
 const index=(await client.query(`SELECT i.indisvalid AS valid,i.indisready AS ready,
   pg_relation_size(i.indexrelid)::text AS bytes,pg_get_indexdef(i.indexrelid) AS definition
   FROM pg_index i WHERE i.indexrelid='public.idx_app_state_log_h1_kind_symbol'::regclass
   AND i.indrelid='public.app_state_log'::regclass`)).rows[0];
 assert.equal(index?.valid,true);assert.equal(index?.ready,true);
 return {ok:true,mode:'PR799_REVIEWED_LOOKUP_INDEX_BUILD',index,metadata,budget,
   elapsedMs:Math.round((performance.now()-start)*10)/10,schemaWrite:true,marketDataWrites:false};
}
