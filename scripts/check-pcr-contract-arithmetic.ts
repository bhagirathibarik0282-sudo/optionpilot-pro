import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

/** Independent reduction of allowlisted OI rows, not a second live PCR authority. */
export function inspectPcrContractArithmetic(payload:any){
 const a=payload?.audit,rows=a?.rows;
 const fail=(reason:string)=>({ok:false,reason,symbol:a?.symbol??null,expiry:a?.expiry??null});
 if(payload?.connected!==true||payload.readOnly!==true||payload.extraBrokerRequests!==0||!a||a.source!=='KITE_REST_FULL_EXPIRY_SNAPSHOT'||a.fetchState!=='OK'||!Array.isArray(rows)||!Number.isInteger(a.expected)||a.expected<=0||a.expected>3000||rows.length!==a.expected)return fail('NO_COMPLETE_ATTEMPT_EVIDENCE');
 if(!['NIFTY','SENSEX','BANKNIFTY'].includes(a.symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(a.expiry||'')||!Number.isFinite(Date.parse(a.expiry+'T00:00:00Z'))||new Date(a.expiry+'T00:00:00Z').toISOString().slice(0,10)!==a.expiry)return fail('INVALID_SELECTION');
 const now=Date.parse(payload.serverTime),checked=Date.parse(a.checkedAt),cycle=Date.parse(a.cycleStartedAt);
 if(![now,checked,cycle].every(Number.isFinite)||checked>now||now-checked>90000||cycle>checked||checked-cycle>60000||new Date(now+19800000).toISOString().slice(0,10)!==new Date(checked+19800000).toISOString().slice(0,10)||a.expiry<new Date(now+19800000).toISOString().slice(0,10))return fail('EXPIRED_OR_INVALID_ATTEMPT');
 const tokens=new Set<number>(),keys=new Set<string>(),identities=new Set<string>();
 let ce=0,pe=0,calls=0,puts=0;const times:number[]=[];
 for(const r of rows){
  const identity=r.strike+'|'+r.side,t=Date.parse(r.sourceAt);
  if(r.symbol!==a.symbol||r.expiry!==a.expiry||!['CE','PE'].includes(r.side)||!Number.isFinite(r.strike)||r.strike<=0||!Number.isSafeInteger(r.token)||r.token<=0||r.responseToken!==r.token||typeof r.key!=='string'||!r.key.includes(':')||tokens.has(r.token)||keys.has(r.key)||identities.has(identity))return fail('INVALID_OR_DUPLICATE_CONTRACT');
  if(!Number.isSafeInteger(r.oi)||r.oi<0)return fail('MISSING_OR_INVALID_OI');
  if(typeof r.sourceAt!=='string'||!Number.isFinite(t)||t<=0||t>checked+5000)return fail('INVALID_SOURCE_TIME');
  tokens.add(r.token);keys.add(r.key);identities.add(identity);times.push(t);
  if(r.side==='CE'){ce+=r.oi;calls++;}else{pe+=r.oi;puts++;}
 }
 if(!calls||!puts||!Number.isSafeInteger(ce)||!Number.isSafeInteger(pe)||ce<=0)return fail('INVALID_TOTALS');
 const ratio=pe/ce,c=a.claimed;
 if(!c||c.ceTotal!==ce||c.peTotal!==pe||!Number.isFinite(c.value)||Math.abs(c.value-ratio)>Math.max(1,ratio)*1e-12)return fail('COLLECTOR_ARITHMETIC_MISMATCH');
 return {ok:true,reason:'CONTRACT_SUMS_MATCH_REPORTED_TOTALS',symbol:a.symbol,expiry:a.expiry,
  contracts:rows.length,ceContracts:calls,peContracts:puts,ceTotal:ce,peTotal:pe,pcr:ratio,
  checkedAt:a.checkedAt,cycleStartedAt:a.cycleStartedAt,observation:a.observation,
  freshnessState:a.freshnessState,freshnessReason:a.reason,
  sourceMinAt:new Date(Math.min(...times)).toISOString(),sourceMaxAt:new Date(Math.max(...times)).toISOString(),
  evidenceSha256:createHash('sha256').update(JSON.stringify(a)).digest('hex'),
  limitation:'Arithmetic and included-row identity only; not independent broker/exchange truth, instrument-universe completeness, browser proof or synchronized OI.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [origin,symbol,expiry]=process.argv.slice(2);
  if(!origin||!symbol||!expiry)throw Error('USAGE');
  const url=new URL('/api/research/dashboard-live/pcr-audit',origin);url.searchParams.set('symbol',symbol);url.searchParams.set('expiry',expiry);
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  const result=inspectPcrContractArithmetic(await response.json());
  console.log(JSON.stringify({...result,httpStatus:response.status},null,2));process.exitCode=response.ok&&result.ok?0:2;
 }catch{console.log(JSON.stringify({ok:false,reason:'AUDIT_READ_FAILED',usage:'node --import tsx scripts/check-pcr-contract-arithmetic.ts ORIGIN SYMBOL YYYY-MM-DD'}));process.exitCode=2;}
}
