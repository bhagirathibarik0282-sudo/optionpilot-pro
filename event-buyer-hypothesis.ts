/** Research hypothesis only. Not a selector, fill model or production order rule.
 * Exact sampled LTP path; no intraminute high/low, execution, cost or P&L claim.
 * Independent event candidates, not portfolio positions. */
export function evaluateEventBuyerHypothesis(state:any,event:any,storedAt:string,pairs:any[],build:Function){
 const stamp=(x:any)=>typeof x==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):NaN;
 const at=stamp(event?.at),known=stamp(storedAt),cursor=stamp(state?.replay?.at),date=event?.tradeDate;
 const open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!state?.replay?.active||state.date!==date||!(at>=open&&at<=close&&known>=at&&known<=cursor&&cursor<=close)||!Array.isArray(pairs))return [];
 const safety={researchOnly:true,affectsExecution:false,affectsVerdict:false,affectsTelegram:false,netPnl:null,quantity:null,verifiedFill:false};
 const positive=(x:any)=>typeof x==='number'&&Number.isFinite(x)&&x>0;
 const number=(x:any)=>typeof x==='number'&&Number.isFinite(x);
 const strikes=[...new Set(pairs.filter(p=>p?.symbol===event.symbol&&Number.isSafeInteger(p.strike)&&p.strike>0).map(p=>p.strike))];
 return strikes.map(strike=>{
  const group=pairs.filter(p=>p.symbol===event.symbol&&p.strike===strike).sort((a,b)=>String(a.expiry).localeCompare(String(b.expiry)));
  const why:string[]=[],whyNot:string[]=['No verified bid/ask fill, spread, lot size, costs or portfolio risk; no executable P&L.','VWAP and full/local OI alignment are not validated in this hypothesis.'];
  const result:any={...safety,symbol:event.symbol,strike,expiry:group[0]?.expiry??null,side:null,status:'NO_CANDIDATE',why,whyNot,entry:null,exit:null,initialStop:null,trail:[],rule:'PDL_TWO_EXPIRY_SAMPLED_V1'};
  const block=(reason:string,status='NO_CANDIDATE')=>{whyNot.push(reason);result.status=status;return result;};
  if(group.length!==2||new Set(group.map(p=>p.expiry)).size!==2)return block('Two distinct selected expiries required.');
  if(group.some(p=>!Number.isInteger(p.dte)||p.dte<0))return block('Invalid DTE.');
  const ce=group.every(p=>p.ceCrossing==='OBSERVED_PDL_CROSSING'),pe=group.every(p=>p.peCrossing==='OBSERVED_PDL_CROSSING');
  if(ce===pe)return block(ce?'Both sides crossed PDL; conflicting direction.':'No common same-side PDL crossing across both expiries.');
  const side=ce?'pe':'ce',weak=ce?'ce':'pe',weakKey=ce?'ceCrossing':'peCrossing',otherKey=ce?'peCrossing':'ceCrossing';
  if(group.some(p=>['UNAVAILABLE','OBSERVED_PDL_CROSSING','ALREADY_BELOW_PDL'].includes(p[otherKey])))return block('Opposite buyer-side PDL evidence missing or weak.');
  const near=group[0];result.side=side.toUpperCase();
  if(near.dte>4)return block('Nearer selected expiry outside proposed 0–4 calendar DTE.');
  const b=near.rows.find((r:any)=>r.offset===-3),e=near.rows.find((r:any)=>r.offset===0);
  if(!b||!e||!positive(b[side]?.price)||!positive(e[side]?.price)||e[side].price<=b[side].price)return block('Buyer premium did not strengthen at the exact event.');
  why.push(weak.toUpperCase()+' crossed own PDL in both selected expiries; opposite '+side.toUpperCase()+' strengthened in nearer selected expiry.');
  if(!positive(b.spot)||!positive(e.spot)||!number(b.fullPcr)||!number(e.fullPcr)||b.fullPcrSource!==e.fullPcrSource||!b.fullPcrSource)return block('Comparable spot / full PCR evidence unavailable.');
  if(side==='pe'?!(e.spot<b.spot&&e.fullPcr<b.fullPcr):!(e.spot>b.spot&&e.fullPcr>b.fullPcr))return block('Spot and full PCR do not confirm proposed direction.');
  why.push('Spot and same-source full PCR direction agree at -3m → event.');
  const stop=Math.min(b[side].price,e[side].price),trigger=e[side].price;
  const entryOffset=Math.floor((known-at)/60000)+1,entryAt=at+entryOffset*60000;
  if(entryOffset>5||entryAt>Date.parse(date+'T15:00:00+05:30'))return block('Saved event became known too late for proposed entry window.');
  const offsets=Array.from({length:16},(_,i)=>entryOffset+i);
  const path=build(state,{...event,expiry:near.expiry,strike},storedAt,offsets);
  const first=path.find((r:any)=>r.offset===entryOffset);
  result.status='WATCH_ONLY';result.initialStop=stop;result.trigger=trigger;
  if(entryAt>cursor)return block('Next eligible exact-minute sample has not arrived.','WAIT_FOR_SAMPLE');
  if(!first||!positive(first[side]?.price)||!positive(first[weak]?.price))return block('Entry-minute pair unavailable; no nearest-price substitution.','UNVERIFIED');
  if(!positive(e[weak]?.pdl)||first[weak].pdl!==e[weak].pdl||first[weak].price>=e[weak].pdl)return block('Weak premium recovered or its PDL reference changed before entry.');
  const entry=first[side].price,R=entry-stop;
  if(entry<=trigger||!positive(R))return block('Next sample did not break event premium or stop distance invalid.');
  result.entry={at:first.at,price:entry,kind:'SAMPLED_LTP_NOT_FILL'};result.riskPoints=R;result.status='OBSERVED_OPEN';
  let trail=stop;
  result.trail.push({at:first.at,price:entry,stop:trail,reason:'Initial sampled structural stop'});
  for(const offset of offsets.slice(1)){
   const t=at+offset*60000;if(t>cursor)break;
   const row=path.find((r:any)=>r.offset===offset);
   if(!row||!positive(row[side]?.price)||!positive(row[weak]?.price)||row[weak].pdl!==e[weak].pdl){result.status='UNVERIFIED';result.whyNot.push('Missing or inconsistent holding sample; stop/exit outcome cannot be established.');break;}
   const price=row[side].price;
   const reason=price<=trail?'SAMPLED_STOP_THRESHOLD':row[weak].price>=e[weak].pdl?'OPPOSITE_PDL_RECOVERY':offset===entryOffset+15?'15_MINUTE_TIME_EXIT':null;
   if(reason){result.exit={at:row.at,price,reason,kind:'SAMPLED_LTP_NOT_FILL'};result.status='OBSERVED_EXIT';break;}
   const gain=(price-entry)/R;
   if(gain>=1)trail=Math.max(trail,entry+Math.floor((gain-1)*2+1e-9)*R/2);
   result.trail.push({at:row.at,price,stop:trail,reason:'After-sample stop update; never applied retroactively'});
  }
  return result;
 });
}
