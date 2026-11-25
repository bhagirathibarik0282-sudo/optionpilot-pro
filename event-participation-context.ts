/** Research-only participation context. No weighted score, causal or execution claim. */
export function createEventParticipationContext(){
 const EVENT_BANK_TEAM=['HDFCBANK','ICICIBANK','NIFTY PSU BANK'] as const;
const EVENT_BROAD_TEAM=['HDFCBANK','RELIANCE','NIFTY IT','NIFTY SMLCAP 100','NIFTY MIDCAP 100'] as const;
const extra=['AXISBANK','KOTAKBANK','SBIN'];
const bankPrimary=[...EVENT_BANK_TEAM,'AXISBANK','KOTAKBANK'];
const broadPrimary=[...EVENT_BROAD_TEAM,'ICICIBANK'];
const labels:Record<string,string>={HDFCBANK:'HDFC Bank',ICICIBANK:'ICICI Bank','NIFTY PSU BANK':'PSU Bank',RELIANCE:'Reliance','NIFTY IT':'Nifty IT','NIFTY SMLCAP 100':'Smallcap 100','NIFTY MIDCAP 100':'Midcap 100',AXISBANK:'Axis Bank',KOTAKBANK:'Kotak Bank',SBIN:'SBI'};
const sector=(s:string)=>s.startsWith('NIFTY ');
const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const num=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const validDate=(s:any)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)===s;
const istDate=(n:number)=>Number.isFinite(n)?new Date(n+19800000).toISOString().slice(0,10):'';
const alignment=(a:any[])=>{const valid=a.filter(x=>x.dayPct!==null);return {up:valid.filter(x=>x.dayPct>0).length,down:valid.filter(x=>x.dayPct<0).length,flat:valid.filter(x=>x.dayPct===0).length,available:valid.length,required:a.length,state:valid.length!==a.length?'INCOMPLETE':valid.every(x=>x.dayPct>0)?'ALIGNED_UP':valid.every(x=>x.dayPct<0)?'ALIGNED_DOWN':valid.every(x=>x.dayPct===0)?'FLAT':'MIXED'};};
function eventParticipationContext(date:string,index:string,eventAt:string,storedAt:string,cursorAt:string,snapshots:any[],cash:any){
 const at=stamp(eventAt),known=stamp(storedAt),cursor=stamp(cursorAt),open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!validDate(date)||!['NIFTY','SENSEX','BANKNIFTY'].includes(index)||!(at>=open&&known>=at&&cursor>=known&&cursor<=close))return null;
 const order=[...new Set<string>(index==='BANKNIFTY'?[...EVENT_BANK_TEAM,...extra,...EVENT_BROAD_TEAM]:[...broadPrimary,...EVENT_BANK_TEAM])];
 const source=(Array.isArray(snapshots)?snapshots:[]).filter(s=>s?.source==='SERVER_BACKGROUND_KITE_QUOTES'&&s.tradingDate===date&&istDate(stamp(s.timestamp))===date&&stamp(s.timestamp)>=open&&stamp(s.timestamp)<=close);
 const counts=new Map<number,number>();for(const s of source){const t=stamp(s.timestamp);counts.set(t,(counts.get(t)||0)+1);}
 const checkpoints=[-15,-5,-3,0,1,3,5,15,30].map(offset=>{
  const target=at+offset*60000;
  const cap=Math.min(target,offset<=0?known:cursor);
  const snap=target>=open&&target<=cursor&&target<=close?source.filter(s=>counts.get(stamp(s.timestamp))===1&&stamp(s.timestamp)<=cap&&cap-stamp(s.timestamp)<=180000).sort((a,b)=>stamp(b.timestamp)-stamp(a.timestamp))[0]:null;
  const receipt=stamp(snap?.timestamp);
  const moves=order.map(symbol=>{
   // Cross-index stock duplicates are not additional votes. Prefer the selected index;
   // fall back to a single unambiguous quote from the other configured group.
   const exact=(a:any)=>Array.isArray(a)?a.filter(q=>q?.symbol==='NSE:'+symbol):[];
   let quotes=sector(symbol)?exact(snap?.sectors):exact(snap?.stocks?.[index]);
   if(!sector(symbol)&&!quotes.length){const other=index==='BANKNIFTY'?'NIFTY':'BANKNIFTY';quotes=exact(snap?.stocks?.[other]);}
   const q=quotes.length===1?quotes[0]:null,t=stamp(q?.exchangeTimestamp),p=num(q?.price),c=num(q?.previousClose);
   const valid=!!q&&istDate(t)===date&&t>=open&&t<=receipt&&receipt-t<=30000&&p!==null&&p>0&&c!==null&&c>0;
   const pct=valid?(p!/c!-1)*100:null;
   return {symbol,label:labels[symbol],role:sector(symbol)?'SECTOR_PROXY':'STOCK',dayPct:num(pct),price:valid?p:null,quoteAt:valid?q.exchangeTimestamp:null};
  });
  return {offset,at:new Date(target).toISOString(),receiptAt:snap?snap.timestamp:null,status:target>cursor?'FUTURE':snap?'AS_OF_SNAPSHOT':'GAP',moves,banks:alignment(moves.filter(x=>(EVENT_BANK_TEAM as readonly string[]).includes(x.symbol))),broad:alignment(moves.filter(x=>(EVENT_BROAD_TEAM as readonly string[]).includes(x.symbol))),bankPrimary:alignment(moves.filter(x=>bankPrimary.includes(x.symbol))),broadPrimary:alignment(moves.filter(x=>broadPrimary.includes(x.symbol)))};
 });
 const baseline=checkpoints.find(x=>x.offset===-3);
 const rows=checkpoints.map(row=>({...row,moves:row.moves.map(m=>{const b=baseline?.moves.find(x=>x.symbol===m.symbol);return {...m,deltaFromBeforePct:m.price!==null&&b?.price!=null&&row.offset>=0&&row.receiptAt!==baseline?.receiptAt?num((m.price/b.price-1)*100):null};})}));
 // Existing cash API supplies verified daily rows, not point-in-time publication timestamps.
 // Strictly previous dates only, retrospective context; never an entry-time fact.
 const daily=cash?.dailyHistoryState==='VERIFIED_STORED_EOD'&&Array.isArray(cash.dailyHistory)?cash.dailyHistory:[];
 const seen=new Map<string,number>();for(const r of daily)seen.set(r?.date,(seen.get(r?.date)||0)+1);
 const history=daily.filter(r=>validDate(r?.date)&&r.date<date&&seen.get(r.date)===1&&num(r.fiiNetCrore)!==null&&num(r.diiNetCrore)!==null).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10);
 const knownAt=known;
 const cashWindows=[1,3,5,10].map(n=>{
  const h=history.slice(0,n),complete=h.length===n;
  const fii=complete?h.reduce((a,r)=>a+r.fiiNetCrore,0):null,dii=complete?h.reduce((a,r)=>a+r.diiNetCrore,0):null;
  // Never substitute older days for missing receipt evidence in a window.
  // Date eligibility is separate from fetch-time eligibility.
  const known=h.filter(r=>{const fetched=stamp(r.fetchedAt);return Number.isFinite(fetched)&&fetched>=Date.parse(r.date+'T15:30:00+05:30')&&fetched<=knownAt;});
  const qualified=complete&&known.length===n;
  return {sessions:n,dates:h.map(r=>r.date),available:h.length,fii,dii,combined:fii===null||dii===null?null:fii+dii,receiptQualified:known.length,receiptFii:qualified?fii:null,receiptDii:qualified?dii:null};
 });
 const oiRaw=cash?.participantOiHistoryState==='STORED_OI_READBACK'&&Array.isArray(cash.participantOiHistory)?cash.participantOiHistory:[];
 const oiDays=oiRaw.filter((r:any)=>validDate(r?.date)&&r.date<date).sort((a:any,b:any)=>b.date.localeCompare(a.date)).slice(0,11);
 const groups=['FII','DII','PRO','CLIENT'],fields=['futureLong','futureShort','callLong','callShort','putLong','putShort'];
 const eligible=(d:any)=>{
  if(!d||d.complete!==true||oiDays.filter((r:any)=>r.date===d.date).length!==1||!Array.isArray(d.participants)||d.participants.length!==4)return null;
  const entries=groups.map(participant=>{
   const matches=d.participants.filter((r:any)=>r?.participant===participant);if(matches.length!==1)return null;
   const p=matches[0],f=stamp(p.fetchedAt),u=stamp(p.updatedAt);
   if(!(f>=Date.parse(d.date+'T15:30:00+05:30')&&u>=f&&u<=knownAt)||!fields.every(k=>Number.isSafeInteger(p[k])&&p[k]>=0))return null;
   return {participant,futureLong:p.futureLong,futureShort:p.futureShort,callLong:p.callLong,callShort:p.callShort,putLong:p.putLong,putShort:p.putShort,futureNet:p.futureLong-p.futureShort,callNet:p.callLong-p.callShort,putNet:p.putLong-p.putShort};
  });
  return entries.every(Boolean)?entries:null;
 };
 const latest=oiDays[0],currentOi=eligible(latest);
 const positionWindows=[1,3,5,10].map(n=>{
  const prior=oiDays[n],base=eligible(prior);
  return {sessions:n,date:prior?.date||null,changes:currentOi&&base?currentOi.map((p:any,i:number)=>({participant:p.participant,futureLong:p.futureLong-base[i]!.futureLong,futureShort:p.futureShort-base[i]!.futureShort,futureNet:p.futureNet-base[i]!.futureNet,callNet:p.callNet-base[i]!.callNet,putNet:p.putNet-base[i]!.putNet})):[]};
 });
 const participantOi={date:latest?.date||null,positions:currentOi||[],windows:positionWindows,availableDates:oiDays.length,scope:'NSE_AGGREGATE_INDEX_CONTRACTS',status:currentOi?'RECORDED_FETCH_AND_UPDATE_CUTOFF':'UNAVAILABLE'};
 return {index,date,checkpoints:rows,cashWindows,participantOi,cashStatus:'PRIOR_STORED_DATES_ONLY_PUBLICATION_TIME_UNKNOWN',researchOnly:true,affectsExecution:false,affectsVerdict:false,affectsTelegram:false,officialWeight:null,indexContribution:null};
}
 return {eventParticipationContext,EVENT_BANK_TEAM,EVENT_BROAD_TEAM};
}
export const {eventParticipationContext,EVENT_BANK_TEAM,EVENT_BROAD_TEAM}=createEventParticipationContext();
