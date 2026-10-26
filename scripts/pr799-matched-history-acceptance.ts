import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {listH1TheoryRecordedDates} from '../h1-theory-history.js';
import {runH1ReplayRead} from '../h1-replay-http.js';
import {loadRecorderMatchedHistory} from '../recorder-matched-history.js';
import {validRecorderMatchRule} from '../recorder-matched-outcome.js';
import {selectPr799RecordedTarget} from '../pr799-recorder-target.js';

// One manually authorized, bounded source validation. No server/startup or rate publication.
let stage='CONFIGURATION';
async function main(){
 assert.equal(process.env.PR799_MATCH_HISTORY_ACCEPTANCE,'NIFTY_OCT26_1024_READ_ONLY');
 assert(process.env.DATABASE_URL);
 const bytes=await readFile(new URL('../docs/audits/recorder-match-rule-v1-20261026.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'bbcae1a2262031131805726a489bd9a8285c39b9c6ae05267fac1bffad006a0d');
 const config=JSON.parse(bytes.toString('utf8'));assert(validRecorderMatchRule(config.rule));
 assert.equal(config.activation.dashboardPercentage,false);
 let target:Record<string,string>={symbol:'NIFTY',date:'2026-10-26',side:'PE',time:'10:24'};
 assert(Date.parse(target.date+'T'+target.time+':00+05:30')>=Date.parse(config.rule.declaredAt));
 assert(Date.now()>=Date.parse(target.date+'T'+target.time+':00+05:30'));
 const timeout=setTimeout(()=>{console.error('PR799_MATCH_HISTORY_TIMEOUT_NO_RATE');process.exit(1);},120000);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,
  query_timeout:50000,application_name:'pr799-matching-source-validation',
  options:'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=1000'});
 let failed=false,queries=0;pool.on('error',()=>{failed=true;});
 const read=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[]):Promise<T[]>=>{
  assert(/^(SELECT|WITH)\b/i.test(sql.trim()));assert(++queries<=200);
  const client=await pool.connect();let begun=false,broken=false;
  try{
   await client.query('BEGIN READ ONLY');begun=true;
   assert.equal((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only,'on');
   return (await client.query(sql,params)).rows as T[];
  }finally{
   try{if(begun)await client.query('ROLLBACK');}catch{broken=true;failed=true;}
   client.release(broken);
  }
 };
 let result:any,selectionPolicy:string|null=null;
 try{
  stage='EXACT_RECORDED_TARGET_SELECTION';
  const request={symbol:'NIFTY' as const,tradeDate:target.date,fromTime:'10:21',toTime:target.time,scope:'FULL' as const};
  const current=await runH1ReplayRead(request,read);
  const selection=selectPr799RecordedTarget({symbol:target.symbol,date:target.date,time:target.time,side:target.side},current);
  selectionPolicy=selection.policy;
  if(!selection.ok)result={status:'UNAVAILABLE',reason:selection.reason,audit:{targetAdmission:selection.admission},result:null,limits:null};
  else{
   target=selection.target;stage='BOUNDED_HISTORY_READ';
   result=await loadRecorderMatchedHistory({target,historyFrom:'2026-10-01',historyTo:'2026-10-23',rule:config.rule},{
    listDates:()=>listH1TheoryRecordedDates(async<T>(sql:string,params:unknown[]=[])=>({rows:await read(sql,params) as T[]})),
    // Reuse only this exact request; no cache or alternate target survives the run.
    read:q=>Object.entries(request).every(([k,v])=>(q as any)[k]===v)?Promise.resolve(current):runH1ReplayRead(q,read)
   });
  }
 }finally{
  try{await pool.end();}catch{failed=true;}finally{clearTimeout(timeout);}
 }
 stage='VERIFY_POOL_CLOSED';assert.equal(failed,false);
 // Allowlisted audit only. Never log raw rows, rule-selected prices, percentages or credentials.
 const audit=result.audit;
 console.log('PR799_MATCH_HISTORY_RESULT '+JSON.stringify({target,selectionPolicy,ruleVersion:config.rule.version,
  declaredAt:config.rule.declaredAt,status:result.status,reason:result.reason,
  audit,counts:result.result?.counts??null,limits:result.limits,queries,
  readOnly:true,writesPerformed:false,poolClosed:true,dashboardActivated:false,ratePublished:false}));
 console.log('PR799_MATCH_HISTORY_COMPLETE_DB_CLOSED_NO_LISTENER');
}
main().catch(()=>{console.error('PR799_MATCH_HISTORY_FAILED_NO_RATE '+JSON.stringify({stage}));process.exitCode=1;});
