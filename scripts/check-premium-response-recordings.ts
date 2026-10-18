import fs from 'node:fs';
import crypto from 'node:crypto';
import {deriveRecordedPremiumResponse} from '../premium-response-evidence.js';
const root=process.env.RAG_RAW_FIXTURES;
if(!root)throw Error('Set RAG_RAW_FIXTURES to the retained raw H1 replay directory.');
const cases:any[]=[],sources:any[]=[];
for(const date of ['2026-10-08','2026-10-09','2026-10-12','2026-10-13'])for(const symbol of ['NIFTY','SENSEX','BANKNIFTY'] as const){
 const name=date+'_'+symbol+'.json',bytes=fs.readFileSync(root+'/'+name),raw=JSON.parse(bytes);sources.push({file:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 const bucket=new Date(date+'T09:36:00+05:30').toISOString();
 const selected=new Map<string,any>(raw.options.filter((q:any)=>q.symbol===symbol&&q.minute_bucket===bucket&&Number(q.atm_offset)===0).map((q:any)=>[[String(q.expiry).slice(0,10),q.strike,q.option_type].join('|'),q]));
 if(!selected.size)cases.push({date,symbol,status:'NO_RECORDED_ATM_AT_REQUESTED_TIME'});
 for(const q of selected.values()){
  const s={date,symbol,expiry:String(q.expiry).slice(0,10),strike:Number(q.strike),side:q.option_type,time:'09:36',lookback:3,asOf:Date.parse(date+'T09:36:59+05:30')};
  const r=deriveRecordedPremiumResponse(raw,s);
  if(r.change&&r.current&&r.before&&typeof r.change.price==='number'&&Math.abs(r.change.price-(r.current.price-r.before.price))>1e-9)throw Error('PRICE_PARITY');
  if(r.change&&typeof r.change.price==='number'&&typeof r.change.spotIntrinsicProxy==='number'&&typeof r.change.spotRemainder==='number'&&Math.abs(r.change.price-r.change.spotIntrinsicProxy-r.change.spotRemainder)>1e-8)throw Error('DECOMPOSITION_PARITY');
  cases.push({...s,asOf:new Date(s.asOf).toISOString(),status:r.status,reason:r.reason,dte:r.clock.calendarDte,priceBefore:r.before?.price??null,priceAt:r.current?.price??null,spotBefore:r.before?.spot??null,spotAt:r.current?.spot??null,change:r.change,evidenceSha256:r.evidenceSha256});
 }
}
const report={kind:'ACTUAL_ARCHIVE_PREMIUM_RESPONSE_READBACK',generatedAt:new Date().toISOString(),source:'EXISTING_RETAINED_H1_REPLAY_JSON; NOT INDEPENDENT EXCHANGE VERIFICATION',selectionRule:'All retained ATM contracts at 09:36 IST across 4 specified dates and all 3 indices; 3m exact lookback; 09:36:59 cutoff',sources,summary:{attempted:cases.length,measured:cases.filter(c=>c.status==='MEASURED').length,withheld:cases.filter(c=>c.status!=='MEASURED').length},cases};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
