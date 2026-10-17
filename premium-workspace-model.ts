/** Descriptive presentation model. Each row retains its exact contract and source times. */
export function derivePremiumWorkspace(input:any){
 const num=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const day=(v:any)=>String(v||'').slice(0,10),id=(r:any)=>[r.symbol,day(r.expiry),r.strike,r.option_type].join('|');
 const rows=(input.rows||[]).filter((r:any)=>['NIFTY','SENSEX','BANKNIFTY'].includes(r.symbol)&&['CE','PE'].includes(r.option_type)&&num(r.strike)!==null&&r.strike>0&&/^\d{4}-\d{2}-\d{2}$/.test(day(r.expiry))&&day(r.minute_bucket)===input.date&&Number.isFinite(Date.parse(r.minute_bucket)));
 const groups=new Map<string,any[]>();for(const r of rows){const k=id(r);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(r);}
 const prior=new Map<string,any>();for(const r of input.prior||[])if(r.truth_verdict==='TRUE'&&day(r.minute_bucket)<input.date&&Number.isFinite(Date.parse(r.minute_bucket))){const old=prior.get(id(r));if(!old||r.minute_bucket>old.minute_bucket)prior.set(id(r),r);}
 const contracts:any[]=[];
 groups.forEach((items,key)=>{
  // Quarantine contradictory duplicates at the same source timestamp.
  const byTime=new Map<string,any[]>();for(const r of items){if(!byTime.has(r.minute_bucket))byTime.set(r.minute_bucket,[]);byTime.get(r.minute_bucket)!.push(r);}
  const series=[...byTime.values()].map(rs=>{
   const r=rs[0],conflict=rs.some(x=>['ltp','oi','pdh','pdl','pdc','iv'].some(k=>x[k]!==r[k]));
   return conflict?{...r,ltp:null,oi:null,iv:null,truth_verdict:'CONFLICT'}:r;
  }).sort((a,b)=>Date.parse(a.minute_bucket)-Date.parse(b.minute_bucket));
  const last=series.at(-1),usable=(r:any)=>r?.truth_verdict==='TRUE'&&num(r.ltp)!==null&&r.ltp>0;
  const price=usable(last)?last.ltp:null,t=Date.parse(last.minute_bucket),minutes=Number(input.minutes||3),target=t-minutes*60000;
  const before=series.filter(r=>Date.parse(r.minute_bucket)<=target).at(-1);
  const baseline=usable(before)&&(input.live?target-Date.parse(before.minute_bucket)<=60000:Date.parse(before.minute_bucket)===target)?before:null;
  const pdc=price!==null&&num(last.pdc)!==null&&last.pdc>0?last.pdc:null;
  const from=input.minutes==='DAY'?pdc:baseline?.ltp??null,change=price!==null&&from!==null&&from>0?(price/from-1)*100:null;
  const high=num(last.pdh),low=num(last.pdl),levelsOk=!(high!==null&&low!==null&&high<=low);
  const pdh=levelsOk&&high!==null&&high>0?high:null,pdl=levelsOk&&low!==null&&low>0?low:null;
  const initialReaction=price===null?'UNAVAILABLE':pdh!==null&&price>=pdh?'ABOVE PDH':pdl!==null&&price<pdl?'BELOW PDL':'IN RANGE';let reaction=initialReaction,eventAt:string|null=null,eventFrom:string|null=null;
  for(let i=1;i<series.length;i++){
   const a=series[i-1],b=series[i],gap=Date.parse(b.minute_bucket)-Date.parse(a.minute_bucket);if(!usable(a)||!usable(b)||gap<=0||gap>180000){reaction=initialReaction;eventAt=null;eventFrom=null;continue;}
   let event='';if(pdh!==null&&a.pdh===pdh&&b.pdh===pdh){if(a.ltp<=pdh&&b.ltp>pdh)event='PDH BREAK';if(a.ltp>=pdh&&b.ltp<pdh)event='PDH REJECT';}
   if(pdl!==null&&a.pdl===pdl&&b.pdl===pdl){if(a.ltp>=pdl&&b.ltp<pdl)event='PDL BREAK';if(a.ltp<pdl&&b.ltp>=pdl)event='PDL RECOVER';}
   if(event){reaction=event;eventAt=b.minute_bucket;eventFrom=a.minute_bucket;}
  }
  if(price===null){reaction='UNAVAILABLE';eventAt=null;eventFrom=null;}
  else if(reaction==='PDH BREAK'&&price<=pdh!||reaction==='PDH REJECT'&&price>=pdh!||reaction==='PDL BREAK'&&price>=pdl!||reaction==='PDL RECOVER'&&price<pdl!){reaction=pdh!==null&&price>=pdh?'ABOVE PDH':pdl!==null&&price<pdl?'BELOW PDL':'IN RANGE';eventAt=null;eventFrom=null;}
  const old=prior.get(key),closeAt=old?.minute_bucket?new Date(old.minute_bucket):null;
  const closeMinute=closeAt?(closeAt.getUTCHours()*60+closeAt.getUTCMinutes()+330)%1440:null;
  const fib:any={};if(closeMinute===930&&num(old.day_high)!==null&&num(old.day_low)!==null&&num(old.ltp)!==null&&old.day_high>=old.day_low&&old.day_low>0){const p=(old.day_high+old.day_low+old.ltp)/3,w=old.day_high-old.day_low;Object.assign(fib,{R3:p+w,R2:p+.618*w,R1:p+.382*w,P:p,S1:p-.382*w,S2:p-.618*w,S3:p-w});}
  const nearest=price===null?null:Object.entries(fib).sort((a:any,b:any)=>Math.abs(price-a[1])-Math.abs(price-b[1]))[0]||null;
  const dte=Math.round((Date.parse(day(last.expiry)+'T00:00:00Z')-Date.parse(input.date+'T00:00:00Z'))/86400000);
  contracts.push({key,symbol:last.symbol,expiry:day(last.expiry),strike:last.strike,type:last.option_type,dte,price,change,from,fromAt:input.minutes==='DAY'?null:baseline?.minute_bucket||null,at:last.minute_bucket,observedAt:last.observedAt||last.minute_bucket,receivedAt:last.receivedAt||null,
   pdh,pdl,reaction,eventAt,eventFrom,oi:usable(last)?num(last.oi):null,oiChange:usable(last)&&baseline&&num(last.oi)!==null&&num(baseline.oi)!==null?last.oi-baseline.oi:null,iv:usable(last)?num(last.iv):null,volume:usable(last)?num(last.volume):null,bid:usable(last)?num(last.bid):null,ask:usable(last)?num(last.ask):null,
   fib,fibAt:old?.minute_bucket||null,nearest,points:series.map(r=>({at:r.minute_bucket,value:usable(r)?r.ltp:null})),state:last.truth_verdict==='CONFLICT'?'CONFLICT':price===null?'UNAVAILABLE':input.live?'LIVE':'RECORDED'});
 });
 const f=input.filter||{};
 const nearby=(r:any)=>{if(!f.strikeScope||f.strikeScope==='ALL'||r.type==='CE'&&f.ceStrike||r.type==='PE'&&f.peStrike)return true;const spot=num(input.spots?.[r.symbol]);if(spot===null)return false;const ks=[...new Set(contracts.filter(x=>x.symbol===r.symbol&&x.expiry===r.expiry).map(x=>x.strike))].sort((a,b)=>a-b),atm=ks.reduce((a,k)=>Math.abs(k-spot)<Math.abs(a-spot)?k:a,ks[0]);return Math.abs(ks.indexOf(r.strike)-ks.indexOf(atm))<=Math.floor(Number(f.strikeScope)/2);};
 const filtered=contracts.filter(r=>nearby(r)&&(!f.symbol||f.symbol==='ALL'||r.symbol===f.symbol)&&(!f.side||f.side==='BOTH'||r.type===f.side)&&(!f.expiries?.length||f.expiries.includes(r.expiry))&&
  (r.type==='CE'?!f.ceStrike||r.strike===Number(f.ceStrike):!f.peStrike||r.strike===Number(f.peStrike))&&
  (!f.dte||f.dte==='ALL'||f.dte==='NEAR'&&r.dte<=4||f.dte==='MID'&&r.dte>=5&&r.dte<=9||f.dte==='FAR'&&r.dte>=10)&&
  (!f.reaction||f.reaction==='ALL'||f.reaction==='UP'&&r.change>0||f.reaction==='DOWN'&&r.change<0||r.reaction===f.reaction));
 filtered.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.strike-b.strike||a.expiry.localeCompare(b.expiry)||a.type.localeCompare(b.type));
 return {rows:filtered,total:contracts.length,expiries:[...new Set(contracts.map(r=>r.expiry))].sort(),strikes:[...new Set(contracts.map(r=>r.strike))].sort((a,b)=>a-b),up:filtered.filter(r=>r.change!==null&&r.change>0).length,down:filtered.filter(r=>r.change!==null&&r.change<0).length,events:filtered.filter(r=>r.eventAt).length};
}
