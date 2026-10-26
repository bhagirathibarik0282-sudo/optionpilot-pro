import assert from 'node:assert/strict';
import pg from 'pg';
import {runH1ReplayRead} from '../h1-replay-http.js';
import {inspectRecorderReplayScope,inspectRecorderContractInventory} from '../recorder-matched-history.js';
// One fixed failed window only. No matching, fallback, raw payload or listener.
let stage='CONFIGURATION';
async function main(){
 assert.equal(process.env.PR799_HISTORY_WINDOW_DIAGNOSTIC,'NIFTY_OCT23_1021_1039_READ_ONLY');assert(process.env.DATABASE_URL);
 const deadline=setTimeout(()=>{console.error('PR799_HISTORY_WINDOW_TIMEOUT');process.exit(1);},120000);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,query_timeout:50000,
  application_name:'pr799-one-history-window-diagnostic',options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000'});
 let queries=0,failed=false;pool.on('error',()=>{failed=true;});
 const read=async<T extends Record<string,unknown>>(sql:string,params:unknown[]):Promise<T[]>=>{
  assert(/^(SELECT|WITH)\b/i.test(sql.trim()));assert(++queries<=6);
  const client=await pool.connect();let begun=false,broken=false;
  try{await client.query('BEGIN READ ONLY');begun=true;assert.equal((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only,'on');return (await client.query(sql,params)).rows as T[];}
  finally{try{if(begun)await client.query('ROLLBACK');}catch{broken=true;failed=true;}client.release(broken);}
 };
 const request={symbol:'NIFTY' as const,tradeDate:'2026-10-23',fromTime:'10:21',toTime:'10:39',scope:'FULL' as const};
 let result:any;
 try{stage='READ_FAILED_WINDOW';const replay=await runH1ReplayRead(request,read);
  const inventory=inspectRecorderContractInventory(request,replay,'2026-10-24','PE');
  result={scope:inspectRecorderReplayScope(request,replay),inventory:{expectedExpiry:'2026-10-24',side:'PE',ok:inventory.ok,reason:inventory.reason,contractCount:inventory.contracts.length}};
 }finally{try{await pool.end();}catch{failed=true;}finally{clearTimeout(deadline);}}
 stage='VERIFY_POOL_CLOSED';assert.equal(failed,false);
 console.log('PR799_HISTORY_WINDOW_RESULT '+JSON.stringify({...result,queries,readOnly:true,writesPerformed:false,poolClosed:true,ratePublished:false}));
 console.log('PR799_HISTORY_WINDOW_COMPLETE_DB_CLOSED_NO_LISTENER');
}
main().catch(()=>{console.error('PR799_HISTORY_WINDOW_FAILED '+JSON.stringify({stage}));process.exitCode=1;});
