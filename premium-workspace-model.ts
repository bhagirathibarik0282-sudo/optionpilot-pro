/** Loaded contract identities, not freshness or exchange-wide coverage. No expiry-type inference. */
export function derivePremiumSeriesInventory(rows:any[],tradeDate:string,symbol='ALL',pins:any={}){
 const day=(v:any)=>{if(v instanceof Date)return Number.isFinite(v.getTime())?v.toISOString().slice(0,10):null;if(typeof v!=='string'||v.length!==10&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))))return null;const s=v.slice(0,10),t=Date.parse(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null;};
 const date=day(tradeDate);if(!date)return [];
 const groups=new Map<string,{symbol:string;expiry:string;ce:Set<number>;pe:Set<number>}>();
 for(const r of rows){const expiry=day(r.expiry),side=r.side??r.option_type??r.type;
  if(!['NIFTY','SENSEX','BANKNIFTY'].includes(r.symbol)||symbol!=='ALL'&&r.symbol!==symbol||!expiry||!['CE','PE'].includes(side)||typeof r.strike!=='number'||!Number.isFinite(r.strike)||r.strike<=0)continue;
  const key=r.symbol+'|'+expiry;let g=groups.get(key);if(!g){g={symbol:r.symbol,expiry,ce:new Set(),pe:new Set()};groups.set(key,g);}(side==='CE'?g.ce:g.pe).add(r.strike);
 }
 const pinned=(v:any,ks:Set<number>)=>v!==undefined&&v!==null&&v!==''?ks.has(Number(v)):null;
 return [...groups.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.expiry.localeCompare(b.expiry)).map(g=>({symbol:g.symbol,expiry:g.expiry,
  dte:Math.round((Date.parse(g.expiry+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000),ceCount:g.ce.size,peCount:g.pe.size,
  cePinnedAvailable:pinned(pins.ceStrike,g.ce),pePinnedAvailable:pinned(pins.peStrike,g.pe),seriesType:'UNVERIFIED'}));
}

/** Freshness is checked again at display time, even if a request or stream stalls. */
export function premiumLiveClock(payload:any,elapsedMs=0){
 const base=Date.parse(payload?.serverTime||''),now=base+elapsedMs;
 const day=Number.isFinite(now)?new Date(now+19800000).toISOString().slice(0,10):null;
 return {now,valid:payload?.connected===true&&Number.isFinite(base)&&Number.isFinite(elapsedMs)&&elapsedMs>=0&&elapsedMs<=3000&&payload?.snapshot?.tradeDate===day};
}

export function projectLivePremiumQuote(payload:any,q:any,reference:any=null,elapsedMs=0){
 const clock=premiumLiveClock(payload,elapsedMs),e=q?.identity,at=Date.parse(q?.observedAt||''),received=Date.parse(q?.receivedAt||'');
 if(!e||e.role!=='OPTION'||!['NIFTY','SENSEX','BANKNIFTY'].includes(e.symbol)||!['CE','PE'].includes(e.side)||typeof e.strike!=='number'||!Number.isFinite(e.strike)||e.strike<=0)return null;
 const day=(v:number)=>Number.isFinite(v)?new Date(v+19800000).toISOString().slice(0,10):null;
 const fresh=clock.valid&&q.state==='LIVE'&&clock.now-at>=-5000&&clock.now-at<=30000&&clock.now-received>=0&&clock.now-received<=30000&&day(at)===payload.snapshot.tradeDate&&day(received)===payload.snapshot.tradeDate;
 const n=(v:any,positive=false)=>fresh&&typeof v==='number'&&Number.isFinite(v)&&(positive?v>0:v>=0)?v:null;
 const exact=reference?.truth_verdict==='TRUE'&&reference.symbol===e.symbol&&String(reference.expiry).slice(0,10)===e.expiry&&reference.strike===e.strike&&reference.option_type===e.side&&String(reference.minute_bucket).slice(0,10)===payload?.snapshot?.tradeDate;
 return {symbol:e.symbol,expiry:e.expiry,strike:e.strike,option_type:e.side,minute_bucket:q.observedAt||payload.serverTime,observedAt:q.observedAt||null,receivedAt:q.receivedAt||null,
  ltp:n(q.price,true),oi:n(q.oi),pdc:n(q.pdc,true),bid:n(q.bid,true),ask:n(q.ask,true),volume:n(q.volume),iv:null,
  truth_verdict:fresh&&n(q.price,true)!==null?'TRUE':'STALE',pdh:exact?reference.pdh:null,pdl:exact?reference.pdl:null,referenceDate:exact?String(reference.minute_bucket).slice(0,10):null};
}

export function derivePremiumLiveContext(payload:any,symbol='ALL',expiries:string[]=[],elapsedMs=0){
 const clock=premiumLiveClock(payload,elapsedMs),n=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const quote=(q:any)=>{const at=Date.parse(q?.observedAt||''),received=Date.parse(q?.receivedAt||''),valid=clock.valid&&q?.state==='LIVE'&&clock.now-at>=-5000&&clock.now-at<=30000&&clock.now-received>=0&&clock.now-received<=30000;
  return {value:valid&&n(q.price)!==null&&q.price>0?q.price:null,at:q?.observedAt||null};};
 return {vix:quote(payload?.snapshot?.vix),indices:(payload?.snapshot?.indices||[]).filter((r:any)=>symbol==='ALL'||r.symbol===symbol).map((r:any)=>{
  const s=payload?.pcrDisplay?.[r.symbol],checked=Date.parse(s?.checkedAt||''),period=s?.periodMs;
  const sourceMin=Date.parse(s?.sourceMinAt||''),sourceMax=Date.parse(s?.sourceMaxAt||'');
  const complete=clock.valid&&s?.state==='COMPLETE'&&s.coverage?.complete===true&&s.coverage.expected>0&&s.coverage.freshOi===s.coverage.expected&&s.expiry===r.expiry&&(!expiries.length||expiries.includes(s.expiry))&&[60000,180000].includes(period)&&clock.now-checked>=0&&clock.now-checked<=period+30000&&checked-sourceMax>=-5000&&checked-sourceMax<=30000&&sourceMax-sourceMin>=0&&sourceMax-sourceMin<=30000;
  return {symbol:r.symbol,future:quote(r.future),pcr:{value:complete?n(s.fullPcr):null,expiry:s?.expiry||null,at:s?.checkedAt||null,minutes:[60000,180000].includes(period)?period/60000:null}};
 })};
}

/** Descriptive presentation model. Each row retains its exact contract and source times. */
export function derivePremiumWorkspace(input:any){
 const num=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const count=(v:any):number|null=>{const n=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?n:null;};
 const day=(v:any)=>String(v||'').slice(0,10),id=(r:any)=>[r.symbol,day(r.expiry),r.strike,r.option_type].join('|');
 const rows=(input.rows||[]).filter((r:any)=>['NIFTY','SENSEX','BANKNIFTY'].includes(r.symbol)&&['CE','PE'].includes(r.option_type)&&num(r.strike)!==null&&r.strike>0&&/^\d{4}-\d{2}-\d{2}$/.test(day(r.expiry))&&day(r.minute_bucket)===input.date&&Number.isFinite(Date.parse(r.minute_bucket)));
 const groups=new Map<string,any[]>();for(const r of rows){const k=id(r);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(r);}
 const prior=new Map<string,any>();for(const r of input.prior||[])if(r.truth_verdict==='TRUE'&&day(r.minute_bucket)<input.date&&Number.isFinite(Date.parse(r.minute_bucket))){const old=prior.get(id(r));if(!old||r.minute_bucket>old.minute_bucket)prior.set(id(r),r);}
 const contracts:any[]=[];
 groups.forEach((items,key)=>{
  // Quarantine contradictory duplicates at the same source timestamp.
  const byTime=new Map<string,any[]>();for(const r of items){if(!byTime.has(r.minute_bucket))byTime.set(r.minute_bucket,[]);byTime.get(r.minute_bucket)!.push(r);}
  const series=[...byTime.values()].map(rs=>{
   const r=rs[0],conflict=rs.some(x=>['ltp','oi','pdh','pdl','pdc','iv','delta'].some(k=>x[k]!==r[k]));
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
   pdh,pdc,pdl,reaction,eventAt,eventFrom,oi:usable(last)?count(last.oi):null,oiChange:usable(last)&&baseline&&count(last.oi)!==null&&count(baseline.oi)!==null?count(last.oi)!-count(baseline.oi)!:null,iv:usable(last)?num(last.iv):null,delta:usable(last)?num(last.delta):null,gamma:usable(last)?num(last.gamma):null,theta:usable(last)?num(last.theta):null,vega:usable(last)?num(last.vega):null,volume:usable(last)?count(last.volume):null,bid:usable(last)?num(last.bid):null,ask:usable(last)?num(last.ask):null,
   fib,fibAt:old?.minute_bucket||null,nearest,points:series.map(r=>({at:r.minute_bucket,value:usable(r)?r.ltp:null})),state:last.truth_verdict==='CONFLICT'?'CONFLICT':price===null?'UNAVAILABLE':input.live?'LIVE':'RECORDED'});
 });
 const f=input.filter||{};
 const nearby=(r:any)=>{if(!f.strikeScope||f.strikeScope==='ALL'||r.type==='CE'&&f.ceStrike||r.type==='PE'&&f.peStrike)return true;const spot=num(input.spots?.[r.symbol]);if(spot===null)return false;const ks=[...new Set(contracts.filter(x=>x.symbol===r.symbol&&x.expiry===r.expiry).map(x=>x.strike))].sort((a,b)=>a-b),atm=ks.reduce((a,k)=>Math.abs(k-spot)<Math.abs(a-spot)?k:a,ks[0]);return Math.abs(ks.indexOf(r.strike)-ks.indexOf(atm))<=Math.floor(Number(f.strikeScope)/2);};
 const filtered=contracts.filter(r=>nearby(r)&&(!f.symbol||f.symbol==='ALL'||r.symbol===f.symbol)&&(!f.side||f.side==='BOTH'||r.type===f.side)&&(!f.expiries?.length||f.expiries.includes(r.expiry))&&
  (r.type==='CE'?!f.ceStrike||r.strike===Number(f.ceStrike):!f.peStrike||r.strike===Number(f.peStrike))&&
  (!f.dte||f.dte==='ALL'||/^\d+$/.test(f.dte)&&r.dte===Number(f.dte)||f.dte==='NEAR'&&r.dte<=4||f.dte==='MID'&&r.dte>=5&&r.dte<=9||f.dte==='FAR'&&r.dte>=10)&&
  (!f.reaction||f.reaction==='ALL'||f.reaction==='UP'&&r.change>0||f.reaction==='DOWN'&&r.change<0||r.reaction===f.reaction));
 filtered.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.strike-b.strike||a.expiry.localeCompare(b.expiry)||a.type.localeCompare(b.type));
 return {rows:filtered,total:contracts.length,series:derivePremiumSeriesInventory(contracts,input.date,f.symbol||'ALL',f),expiries:[...new Set(contracts.map(r=>r.expiry))].sort(),strikes:[...new Set(contracts.map(r=>r.strike))].sort((a,b)=>a-b),up:filtered.filter(r=>r.change!==null&&r.change>0).length,down:filtered.filter(r=>r.change!==null&&r.change<0).length,events:filtered.filter(r=>r.eventAt).length};
}

/** Pair only observed, same-expiry contracts. No Greek calculation or historical live fallback. */
export function derivePremiumDeltaPair(rows:any[],target:number,source='RECORDED'){
 const validNumber=(v:any)=>typeof v==='number'&&Number.isFinite(v);
 const empty={CE:null,PE:null,gap:null,matched:false};
 if(![.25,.4,.5].includes(target)||!['LIVE','RECORDED'].includes(source)||!rows.length)return empty;
 const first=rows[0],key=first.symbol+'|'+first.expiry;
 if(!['NIFTY','SENSEX','BANKNIFTY'].includes(first.symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(first.expiry)||rows.some(r=>r.symbol+'|'+r.expiry!==key||r.dte!==first.dte))return empty;
 const latest=Math.max(...rows.map(r=>Date.parse(r.at)).filter(Number.isFinite));
 const identities=new Map<string,number>();for(const r of rows)identities.set(r.key,(identities.get(r.key)||0)+1);
 const usable=rows.filter(r=>identities.get(r.key)===1&&r.state===source&&validNumber(r.price)&&r.price>0&&validNumber(r.delta)&&Math.abs(r.delta)>0&&Math.abs(r.delta)<=1&&(r.type==='CE'?r.delta>0:r.type==='PE'&&r.delta<0)&&Math.abs(Math.abs(r.delta)-target)<=.050000000001&&Number.isFinite(Date.parse(r.at))&&(source==='RECORDED'?Date.parse(r.at)===latest:latest-Date.parse(r.at)<=5000));
 let best:any=null;
 for(const CE of usable.filter(r=>r.type==='CE'))for(const PE of usable.filter(r=>r.type==='PE')){
  const ceAt=Date.parse(CE.observedAt),peAt=Date.parse(PE.observedAt),gap=Math.abs(CE.delta+PE.delta);
  if(!Number.isFinite(ceAt)||!Number.isFinite(peAt)||Math.abs(ceAt-peAt)>(source==='LIVE'?5000:0)||gap>.020000000001)continue;
  const score=Math.abs(CE.delta-target)+Math.abs(-PE.delta-target);
  if(!best||score<best.score||score===best.score&&(gap<best.gap||gap===best.gap&&(CE.strike<best.CE.strike||CE.strike===best.CE.strike&&PE.strike<best.PE.strike)))best={CE,PE,gap,score,matched:true};
 }
 return best||empty;
}
