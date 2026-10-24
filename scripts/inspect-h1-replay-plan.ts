import pg from 'pg';
import {inspectH1ReplayPlans} from '../h1-replay-plan-audit.js';

// Run only in an already-authorized database environment. Never print the URL,
// raw DB errors or archive rows; use provider TLS settings from DATABASE_URL.
const url=process.env.DATABASE_URL?.trim();
if(!url){
  console.error(JSON.stringify({ok:false,reason:'DATABASE_URL_NOT_CONFIGURED'}));
  process.exitCode=2;
}else{
  const client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,
    query_timeout:7000,application_name:'optionpilot-h1-plan-audit',
    options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'});
  try{
    await client.connect();
    console.log(JSON.stringify(await inspectH1ReplayPlans(client)));
  }catch{
    console.error(JSON.stringify({ok:false,reason:'READ_ONLY_PLAN_AUDIT_FAILED'}));
    process.exitCode=1;
  }finally{
    await client.end();
  }
}
