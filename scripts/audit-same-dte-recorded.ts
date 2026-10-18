import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { compareSameDteHistory } from '../rag-same-dte-history.js';
// Usage: node --import tsx scripts/audit-same-dte-recorded.ts CURRENT.json PRIOR.json [...]
const paths=process.argv.slice(2);
if(paths.length<2)throw Error('Provide current and prior recorded replay JSON files');
const sources=paths.map(path=>{const raw=readFileSync(path);return {file:basename(path),sha256:createHash('sha256').update(raw).digest('hex'),replay:JSON.parse(raw.toString())};});
const current=sources[0].replay,history=sources.slice(1).map(s=>s.replay),day=current.request.tradeDate,symbol=current.request.symbol;
let result:any=null;let attempted=0;
for(const timeIst of ['09:36','09:39','09:42','09:45','09:48','09:51','09:54','09:57','10:00']){
 const t=Date.parse(day+'T'+timeIst+':00+05:30');
 const spot=Number(current.market.find((m:any)=>Date.parse(m.minute_bucket)===t)?.spot_ltp);
 const contracts=[...new Map(current.options.filter((q:any)=>q.option_type==='CE'&&Date.parse(q.minute_bucket)===t).map((q:any)=>[q.expiry+':'+q.strike,q])).values()] as any[];
 contracts.sort((a,b)=>Math.abs(Number(a.strike)-spot)-Math.abs(Number(b.strike)-spot));
 for(const q of contracts){
  attempted++;
  const r:any=compareSameDteHistory({symbol,date:day,expiry:q.expiry.slice(0,10),strike:Number(q.strike),side:'CE',timeIst,asOf:Date.parse(day+'T15:30:00+05:30')},current,history);
  if(r.ok&&r.matches.length){result=r;break;}
 }
 if(result)break;
}
console.log(JSON.stringify({status:result?'PARTIAL':'NOT_PROVEN',semantics:'RECORDED_ARCHIVE_REPLAY_FIRST_ACCEPTED_EXAMPLE_NOT_PERFORMANCE_STUDY',sources:sources.map(({file,sha256})=>({file,sha256})),attempted,result},null,2));
