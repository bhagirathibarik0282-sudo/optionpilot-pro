import pg from 'pg';
import {inspectH1ReplayPlans} from '../h1-replay-plan-audit.js';

// Run only in an already-authorized database environment. Never print the URL,
// raw DB errors or archive rows; use provider TLS settings from DATABASE_URL.
const url=process.env.DATABASE_URL?.trim();
const args=process.argv.slice(2),paired=args.length===1&&args[0]==='--rag-pair';
if(args.length&&!paired){
  console.error(JSON.stringify({ok:false,reason:'UNSUPPORTED_PLAN_AUDIT_ARGUMENTS'}));
  process.exitCode=2;
}else if(!url){
  console.error(JSON.stringify({ok:false,reason:'DATABASE_URL_NOT_CONFIGURED'}));
  process.exitCode=2;
}else{
  let client:pg.Client|undefined;
  let result:Awaited<ReturnType<typeof inspectH1ReplayPlans>>|undefined;
  let failed=false;
  const deadline=setTimeout(()=>{
    console.error(JSON.stringify({ok:false,reason:'READ_ONLY_PLAN_AUDIT_DEADLINE'}));
    process.exit(1);
  },25000);
  try{
    // Configuration parsing can throw before connect; keep it inside the same
    // safe error boundary as the query and connection lifecycle.
    client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,
      query_timeout:7000,application_name:'optionpilot-h1-plan-audit',
      options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'});
    client.on('error',()=>{failed=true;});
    await client.connect();
    result=await inspectH1ReplayPlans(client,paired);
  }catch{
    failed=true;
  }finally{
    try{await client?.end();}catch{failed=true;}
    clearTimeout(deadline);
  }
  // Do not print success until rollback AND client cleanup have completed.
  if(failed||!result){
    console.error(JSON.stringify({ok:false,reason:'READ_ONLY_PLAN_AUDIT_FAILED'}));
    process.exitCode=1;
  }else{
    console.log(JSON.stringify(result));
  }
}
