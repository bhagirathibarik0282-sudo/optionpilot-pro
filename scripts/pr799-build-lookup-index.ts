import pg from 'pg';
import {buildReviewedH1LookupIndex} from '../h1-archive-lookup-index.js';
const enabled=process.env.PR799_LOOKUP_INDEX_BUILD==='APPLY_REVIEWED_SINGLE_INDEX';
const url=process.env.DATABASE_URL?.trim();
if(!enabled||!url){console.error(JSON.stringify({ok:false,reason:'REVIEWED_INDEX_BUILD_NOT_ENABLED'}));process.exitCode=2;}
else{
 let client:pg.Client|undefined,result:any,failed=false,sqlState:string|null=null;
 const deadline=setTimeout(()=>{console.error(JSON.stringify({ok:false,reason:'INDEX_BUILD_PROCESS_DEADLINE',inspectIndexBeforeRetry:true}));process.exit(1);},180000);
 try{
   client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,query_timeout:125000,
     application_name:'pr799-reviewed-single-index-build',options:'-c statement_timeout=45000 -c lock_timeout=1000'});
   client.on('error',()=>{failed=true;});await client.connect();
   result=await buildReviewedH1LookupIndex(client,{capacityBytes:Number(process.env.PR799_PROVIDER_CAPACITY_BYTES),
     usedBytes:Number(process.env.PR799_PROVIDER_USED_BYTES),observedAt:Date.parse(process.env.PR799_PROVIDER_OBSERVED_AT??'')});
 }catch(error){failed=true;const code=(error as any)?.code;if(typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code))sqlState=code;}
 finally{try{await client?.end();}catch{failed=true;}clearTimeout(deadline);}
 if(failed||!result){console.error(JSON.stringify({ok:false,sqlState,reason:'REVIEWED_INDEX_BUILD_FAILED',inspectIndexBeforeRetry:true}));process.exitCode=1;}
 else console.log(JSON.stringify(result));
}
