/** Browser-local presentation only. Reuses the existing complete-expiry sampler. */
export function deriveLiveThreeIndexPcr(payload:any,previous:any=null,localNow=Date.now()) {
 const symbols=['NIFTY','SENSEX','BANKNIFTY'];
 const num=(v:any)=>typeof v==='number'&&Number.isFinite(v);
 const ms=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const day=(v:number)=>Number.isFinite(v)?new Date(v+19800000).toISOString().slice(0,10):'';
 const now=ms(payload?.serverTime),snapshot=payload?.snapshot;
 const key=String(snapshot?.runtimeId||'')+'|'+String(snapshot?.tradeDate||'');
 const live=payload?.connected===true&&payload.source==='KITE_WEBSOCKET_FULL'&&typeof snapshot?.runtimeId==='string'&&snapshot.runtimeId.length>0&&Array.isArray(snapshot.indices)&&num(now)&&snapshot.tradeDate===day(now)&&now-ms(snapshot.asOf)>=0&&now-ms(snapshot.asOf)<=4000&&(!previous||previous.key!==key||!num(previous.serverAt)||now>=previous.serverAt);
 const old=live&&previous?.key===key?previous.rows:[];
 const rows=symbols.map(symbol=>{
  const matches=live?snapshot.indices.filter((a:any)=>a?.symbol===symbol):[];
  const a=matches.length===1?matches[0]:null,q=payload?.pcrDisplay?.[symbol],c=q?.coverage;
  const expiry=a?.expiry;
  const checked=ms(q?.checkedAt),cycle=ms(q?.cycleStartedAt),sourceMin=ms(q?.sourceMinAt),sourceMax=ms(q?.sourceMaxAt);
  const period=q?.periodMs;
  const valid=live&&q?.source==='KITE_REST_FULL_EXPIRY_SNAPSHOT'&&q.state==='COMPLETE'&&typeof expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expiry)&&Number.isFinite(Date.parse(expiry+'T00:00:00Z'))&&new Date(expiry+'T00:00:00Z').toISOString().slice(0,10)===expiry&&expiry>=snapshot.tradeDate&&q.expiry===expiry&&Array.isArray(a.expiries)&&a.expiries.includes(expiry)&&[60000,180000].includes(period)&&c?.complete===true&&Number.isInteger(c.expected)&&c.expected>0&&c.freshOi===c.expected&&num(c.sourceSkewMs)&&c.sourceSkewMs>=0&&c.sourceSkewMs<=30000&&num(q.ceTotal)&&q.ceTotal>0&&num(q.peTotal)&&q.peTotal>=0&&num(q.fullPcr)&&q.fullPcr>=0&&Math.abs(q.fullPcr-q.peTotal/q.ceTotal)<=Math.max(1,q.fullPcr)*1e-12&&[checked,cycle,sourceMin,sourceMax].every(t=>num(t)&&day(t)===snapshot.tradeDate)&&cycle<=checked&&checked-cycle<=60000&&checked<=now&&now-checked<=period+30000&&checked-sourceMin>=-5000&&checked-sourceMin<=30000&&sourceMax>=sourceMin&&sourceMax-sourceMin<=30000&&checked-sourceMax>=-5000;
  const empty={symbol,expiry:typeof expiry==='string'?expiry:null,value:null,direction:'WAIT',current:null,baseline:null,blinkUntil:0,bandValue:null,bandDirection:'WAIT',bandBaseline:null,bandBlinkUntil:0};
  if(!valid)return empty;
  const b=q.bandPcr,anchorAt=ms(b?.anchorAt);
  const bandOk=b?.state==='COMPLETE'&&b.halfWidth===7&&b.strikeCount===15&&b.expected===30&&b.freshOi===30&&c.expected>=30&&num(b.ceTotal)&&b.ceTotal>0&&b.ceTotal<=q.ceTotal&&num(b.peTotal)&&b.peTotal>=0&&b.peTotal<=q.peTotal&&num(b.value)&&b.value>=0&&Math.abs(b.value-b.peTotal/b.ceTotal)<=Math.max(1,b.value)*1e-12&&[b.anchorStrike,b.fromStrike,b.toStrike].every(n=>num(n)&&n>0)&&b.fromStrike<b.anchorStrike&&b.anchorStrike<b.toStrike&&num(anchorAt)&&day(anchorAt)===snapshot.tradeDate&&checked-anchorAt>=-5000&&checked-anchorAt<=30000&&Math.max(sourceMax,anchorAt)-Math.min(sourceMin,anchorAt)<=30000;
  const band=bandOk?{value:b.value,anchor:b.anchorStrike,from:b.fromStrike,to:b.toStrike,ceTotal:b.ceTotal,peTotal:b.peTotal,anchorAt}:null;
  const current={value:q.fullPcr,expiry,period,checked,cycle,sourceMin,sourceMax,ceTotal:q.ceTotal,peTotal:q.peTotal,expected:c.expected,band};
  const prior=old?.find((r:any)=>r.symbol===symbol);
  if(prior?.current&&prior.expiry===expiry&&prior.current.period===period){
   const p=prior.current;
   if(cycle===p.cycle){
    if(['value','checked','sourceMin','sourceMax','ceTotal','peTotal','expected'].some(k=>current[k]!==p[k]))return empty;
    if(JSON.stringify(current.band)!==JSON.stringify(p.band))return {...prior,current:{...p,band:null},bandValue:null,bandDirection:'WAIT',bandBaseline:null,bandBlinkUntil:0};
    return {...prior}; // Same snapshot cannot create or restart an arrow.
   }
   if(cycle<p.cycle||checked<=p.checked)return empty;
   const gap=cycle-p.cycle;
   if(gap>=period&&gap<=period+30000&&current.expected===p.expected){
    const direction=current.value===p.value?'FLAT':current.value>p.value?'UP':'DOWN';
    const bandMatch=band&&p.band&&band.anchor===p.band.anchor&&band.from===p.band.from&&band.to===p.band.to;
    const bandDirection=!bandMatch?'WAIT':band.value===p.band.value?'FLAT':band.value>p.band.value?'UP':'DOWN';
    return {symbol,expiry,value:current.value,current,baseline:p,direction,blinkUntil:direction==='FLAT'?0:localNow+1800,bandValue:band?.value??null,bandDirection,bandBaseline:bandMatch?p:null,bandBlinkUntil:['UP','DOWN'].includes(bandDirection)?localNow+1800:0};
   }
  }
  return {...empty,value:current.value,current,bandValue:band?.value??null};
 });
 // Spot ticks update independently of the slower PCR snapshot cadence.
 for(const row of rows){
  const matches=live?snapshot.indices.filter((a:any)=>a?.symbol===row.symbol):[],q=matches.length===1?matches[0].spot:null;
  const observed=ms(q?.observedAt),received=ms(q?.receivedAt);
  const valid=q?.identity?.role==='SPOT'&&q.identity.symbol===row.symbol&&q.state==='LIVE'&&num(q.price)&&q.price>0&&day(observed)===snapshot.tradeDate&&day(received)===snapshot.tradeDate&&now-observed>=-5000&&now-observed<=30000&&now-received>=0&&now-received<=30000;
  Object.assign(row,{spotValue:valid?q.price:null,spotAt:valid?q.observedAt:null});
  const a=matches.length===1?matches[0]:null,raw=a?.pcrSnapshot,c=raw?.coverage,checked=ms(raw?.checkedAt);
  const reported=raw?.reportedPcr,reportedLo=ms(reported?.sourceMinAt),reportedHi=ms(reported?.sourceMaxAt),cycleAt=ms(raw?.cycleStartedAt);
  const reportedOk=live&&raw?.source==='KITE_REST_FULL_EXPIRY_SNAPSHOT'&&raw.fetchState==='OK'&&['COMPLETE','INCOMPLETE'].includes(raw.state)&&reported?.basis==='LATEST_REPORTED_MIXED_TIMESTAMPS'&&reported.symbol===row.symbol&&reported.expiry===row.expiry&&Array.isArray(a?.expiries)&&a.expiries.includes(row.expiry)&&reported.checkedAt===raw.checkedAt&&num(checked)&&now-checked>=0&&now-checked<=90000&&num(cycleAt)&&cycleAt<=checked&&checked-cycleAt<=60000&&day(checked)===snapshot.tradeDate&&Number.isInteger(c?.expected)&&c.expected>0&&reported.expected===c.expected&&reported.reported===c.expected&&c.missing===0&&c.invalid===0&&Number.isInteger(reported.olderThan30s)&&reported.olderThan30s>=0&&reported.olderThan30s<=reported.expected&&reported.olderThan30s===c.stale&&Number.isInteger(c.freshOi)&&c.freshOi+c.stale===c.expected&&num(reported.ceTotal)&&reported.ceTotal>0&&num(reported.peTotal)&&reported.peTotal>=0&&num(reported.value)&&reported.value>=0&&Math.abs(reported.value-reported.peTotal/reported.ceTotal)<=Math.max(1,reported.value)*1e-12&&num(reportedLo)&&num(reportedHi)&&day(reportedLo)===snapshot.tradeDate&&reportedLo>=Date.parse(snapshot.tradeDate+'T09:15:00+05:30')&&reportedHi>=reportedLo&&reportedHi<=checked+5000;
  Object.assign(row,{reportedPcr:reportedOk?{...reported}:null});
  // A complete 30-leg band has its own provenance. An unavailable outer
  // contract blocks Full PCR, but must not suppress a separately verified band.
  const b=raw?.bandPcr,lo=ms(b?.sourceMinAt),hi=ms(b?.sourceMaxAt),anchor=ms(b?.anchorAt),cycle=ms(raw?.cycleStartedAt);
  const bandReady=live&&!row.current&&raw?.source==='KITE_REST_FULL_EXPIRY_SNAPSHOT'&&raw.fetchState==='OK'&&['COMPLETE','INCOMPLETE'].includes(raw.state)&&Array.isArray(a?.expiries)&&a.expiries.includes(a.expiry)&&a.expiry===row.expiry&&b?.state==='COMPLETE'&&b.halfWidth===7&&b.strikeCount===15&&b.expected===30&&b.freshOi===30&&num(b.ceTotal)&&b.ceTotal>0&&num(b.peTotal)&&b.peTotal>=0&&num(b.value)&&b.value>=0&&Math.abs(b.value-b.peTotal/b.ceTotal)<=Math.max(1,b.value)*1e-12&&[b.anchorStrike,b.fromStrike,b.toStrike].every(v=>num(v)&&v>0)&&b.fromStrike<b.anchorStrike&&b.anchorStrike<b.toStrike&&[lo,hi,anchor,cycle,checked].every(t=>num(t)&&day(t)===snapshot.tradeDate)&&cycle<=checked&&checked-cycle<=60000&&now-checked>=0&&now-checked<=90000&&lo<=hi&&checked-lo>=-5000&&checked-lo<=30000&&checked-hi>=-5000&&Math.max(hi,anchor)-Math.min(lo,anchor)<=30000;
  if(bandReady)Object.assign(row,{bandValue:b.value,bandCheckedAt:checked});
  const coverageOk=live&&raw?.source==='KITE_REST_FULL_EXPIRY_SNAPSHOT'&&['COMPLETE','INCOMPLETE'].includes(raw.state)&&Array.isArray(a?.expiries)&&a.expiries.includes(a.expiry)&&(!raw.expiry||raw.expiry===a.expiry)&&num(checked)&&day(checked)===snapshot.tradeDate&&now-checked>=0&&now-checked<=90000&&Number.isInteger(c?.expected)&&c.expected>0&&['freshOi','stale','missing','invalid'].every(k=>Number.isInteger(c[k])&&c[k]>=0&&c[k]<=c.expected);
  const reasons=['NO_OPTION_INVENTORY','INVALID_IDENTITY_OR_OI','MISSING_QUOTES','STALE_OI_TIMESTAMPS','OI_TIME_SKEW','CE_OI_ZERO','COMPLETE','INCOMPLETE'];
  const fetchStates=['OK','RATE_LIMITED','REQUEST_REJECTED','SESSION_REQUIRED','IDENTITY_TOO_LONG','UPSTREAM_UNAVAILABLE'];
  const reason=coverageOk?(fetchStates.includes(raw.fetchState)&&raw.fetchState!=='OK'?raw.fetchState:reasons.includes(raw.reason)?raw.reason:c.stale?'STALE_OI_TIMESTAMPS':c.missing?'MISSING_QUOTES':c.invalid?'INVALID_IDENTITY_OR_OI':c.complete?'COMPLETE':'INCOMPLETE'):live?'WAITING_FOR_FRESH_PCR':'FEED_NOT_CONNECTED';
  const unavailable=coverageOk&&Array.isArray(raw.unavailable)?raw.unavailable.slice(0,3).filter((x:any)=>typeof x?.identity==='string'&&['MISSING','STALE_TIMESTAMP','INVALID_IDENTITY_OR_OI'].includes(x.reason)).map((x:any)=>({identity:x.identity,reason:x.reason})):[];
  Object.assign(row,{pcrStatus:reason,coverageInfo:coverageOk?{expected:c.expected,fresh:c.freshOi,stale:c.stale,missing:c.missing,invalid:c.invalid,checked,reason,unavailable}:null});
 }
 const ready=rows.every(r=>r.current&&r.baseline&&r.direction!=='WAIT');
 let alignment='WAIT';
 if(ready){
  const sync=(name:string)=>{
   const samples=rows.map(r=>r[name]);
   return new Set(samples.map(s=>s.cycle)).size===1&&new Set(samples.map(s=>s.period)).size===1&&Math.max(...samples.map(s=>s.sourceMax))-Math.min(...samples.map(s=>s.sourceMin))<=30000;
  };
  alignment=sync('current')&&sync('baseline')?(rows.every(r=>r.direction==='UP')?'ALL_UP':rows.every(r=>r.direction==='DOWN')?'ALL_DOWN':rows.every(r=>r.direction==='FLAT')?'ALL_FLAT':'MIXED'):'TIME_MISMATCH';
 }
 const bandReady=ready&&rows.every(r=>r.bandBaseline&&r.bandDirection!=='WAIT');
 const bandSynced=bandReady&&['current','bandBaseline'].every(key=>Math.max(...rows.map(r=>Math.max(r[key].sourceMax,r[key].band.anchorAt)))-Math.min(...rows.map(r=>Math.min(r[key].sourceMin,r[key].band.anchorAt)))<=30000);
 const bandAlignment=!bandReady?'WAIT':alignment==='TIME_MISMATCH'||!bandSynced?'TIME_MISMATCH':rows.every(r=>r.bandDirection==='UP')?'ALL_UP':rows.every(r=>r.bandDirection==='DOWN')?'ALL_DOWN':rows.every(r=>r.bandDirection==='FLAT')?'ALL_FLAT':'MIXED';
 return {key,serverAt:now,rows,alignment,bandAlignment,live:!!live};
}

export function renderLiveThreeIndexPcr(view:any,localNow=Date.now()) {
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const labels:any={WAIT:'WAIT',ALL_UP:'↑ ALL RISING',ALL_DOWN:'↓ ALL FALLING',ALL_FLAT:'→ ALL FLAT',MIXED:'↕ MIXED',TIME_MISMATCH:'TIME MISMATCH'};
 const glyph:any={UP:'↑',DOWN:'↓',FLAT:'→',WAIT:'—'};
 const time=(ms:number)=>Number.isFinite(ms)?new Date(ms).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 const number=(value:any,direction:string,until:number,kind:string)=>{
  const remaining=Math.max(0,until-localNow),blink=remaining>0&&remaining<=1800;
  return '<div class="mb-pcr-number" data-pcr-metric="'+kind+'"><strong>'+(typeof value==='number'?value.toFixed(4):'—')+'</strong><span data-pcr-direction="'+esc(direction)+'"'+(blink?' class="mb-pcr-blink" style="animation-delay:-'+Math.floor(1800-remaining)+'ms"':'')+' aria-label="'+kind+' PCR '+esc(direction.toLowerCase())+'">'+esc(glyph[direction])+'</span></div>';
 };
 const badge=(label:string,state:string)=>'<span class="mb-pcr-alignment" data-pcr-alignment="'+esc(state||'WAIT')+'" role="status">'+label+' · '+esc(labels[state]||labels.WAIT)+'</span>';
 return '<section class="mb-full-pcr" aria-label="Three-index live full-chain PCR"><div class="mb-full-pcr-heading"><strong>PCR ladder · LIVE snapshots</strong><div class="mb-pcr-badges">'+badge('Full',view.alignment)+badge('Band',view.bandAlignment)+'</div></div><table class="mb-pcr-ladder"><thead><tr><th scope="col">Index / expiry</th><th scope="col">Full OI PCR</th><th scope="col">Band OI PCR<small>ATM ±7 · 15 strikes</small></th></tr></thead><tbody>'+view.rows.map((r:any)=>'<tr data-pcr-index="'+esc(r.symbol)+'"><th scope="row"><span class="mb-pcr-index">'+esc(r.symbol)+'</span><small class="mb-pcr-spot">Spot '+(typeof r.spotValue==='number'?r.spotValue.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'—')+' · '+time(Date.parse(r.spotAt))+' IST</small><small>'+esc(r.expiry||'Expiry unavailable')+(r.symbol==='BANKNIFTY'?' · M':'')+'</small><small>'+esc(r.current?r.current.period/60000+'m · '+time(r.current.checked)+' IST':'UNAVAILABLE')+'</small></th><td>'+number(r.value,r.direction,r.blinkUntil,'full')+(r.reportedPcr&&!r.current?'<div data-pcr-metric="reported"><small>Full-chain reported PCR · MIXED SOURCE TIMES</small><strong>'+r.reportedPcr.value.toFixed(4)+'</strong><small>'+r.reportedPcr.reported+'/'+r.reportedPcr.expected+' contracts · '+r.reportedPcr.olderThan30s+' older than 30s<br>Source '+time(Date.parse(r.reportedPcr.sourceMinAt))+' → '+time(Date.parse(r.reportedPcr.sourceMaxAt))+' IST · checked '+time(Date.parse(r.reportedPcr.checkedAt))+' IST<br>Latest reported OI · no fresh alignment</small></div>':'')+(r.coverageInfo?'<small>OI '+r.coverageInfo.fresh+'/'+r.coverageInfo.expected+' · stale '+r.coverageInfo.stale+' · missing '+r.coverageInfo.missing+' · invalid '+r.coverageInfo.invalid+'<br>'+esc(r.coverageInfo.reason.replaceAll('_',' '))+' · checked '+time(r.coverageInfo.checked)+' IST</small>':'')+'</td><td>'+number(r.bandValue,r.bandDirection||'WAIT',r.bandBlinkUntil||0,'band')+'</td></tr>').join('')+'</tbody></table><details class="mb-pcr-sources" data-live-detail="pcr-ladder"><summary>Source &amp; band range</summary>'+view.rows.map((r:any)=>'<p>'+esc(r.symbol)+' · full coverage '+esc(r.current?.expected)+'/'+esc(r.current?.expected)+' · '+esc(r.baseline?time(r.baseline.checked):'Baseline pending')+' → '+esc(time(r.current?.checked))+'<br>Band: '+esc(r.current?.band?r.current.band.from+' → '+r.current.band.to+' · ATM '+r.current.band.anchor+' · 30/30 contracts · spot '+time(r.current.band.anchorAt):'UNAVAILABLE · complete band and fresh ATM reference required')+'</p>').join('')+'<p>Both ratios use PE OI ÷ CE OI. Full uses the complete expiry; band uses 7 listed strikes each side of snapshot ATM. Changing ATM resets only the band comparison. Arrows describe ratio changes.</p></details></section>';
}

export const LIVE_THREE_INDEX_PCR_CSS=`
.mb-full-pcr{margin:10px 0 14px}.mb-full-pcr-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}.mb-full-pcr-heading>strong{font-size:15px;font-weight:500}.mb-pcr-badges{display:flex;gap:6px;flex-wrap:wrap}.mb-pcr-alignment{font-size:12px;border:1px solid #425252;border-radius:7px;padding:4px 7px;color:#d4e6df}.mb-pcr-alignment[data-pcr-alignment=ALL_UP]{color:#69e9d9}.mb-pcr-alignment[data-pcr-alignment=ALL_DOWN]{color:#ff9f89}.mb-pcr-alignment[data-pcr-alignment=MIXED]{color:#edc86c}.mb-pcr-ladder{width:100%;border-collapse:collapse;table-layout:fixed}.mb-pcr-ladder th,.mb-pcr-ladder td{padding:8px 10px;border-bottom:1px solid #425252;text-align:left;font-weight:400;vertical-align:middle;overflow-wrap:anywhere}.mb-pcr-ladder thead th{font-size:12px;color:#bbcdc7}.mb-pcr-ladder th:first-child{width:37%}.mb-pcr-ladder small{display:block;font-size:11px;color:#bbcdc7}.mb-pcr-index{font-size:13px;font-weight:500}.mb-pcr-number{display:flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums;flex-wrap:wrap}.mb-pcr-number>strong{font-size:23px;font-weight:500;overflow-wrap:anywhere}.mb-pcr-number>span{font-size:21px}.mb-pcr-number [data-pcr-direction=UP]{color:#69e9d9}.mb-pcr-number [data-pcr-direction=DOWN]{color:#ff9f89}.mb-pcr-sources{margin-top:8px;font-size:12px}.mb-pcr-sources p{overflow-wrap:anywhere;color:#bbcdc7}.mb-pcr-blink{animation:mb-pcr-change .6s ease-in-out 3 both}@keyframes mb-pcr-change{0%,100%{opacity:1;transform:translateY(0)}50%{opacity:.35;transform:translateY(-2px)}}@media(max-width:480px){.mb-pcr-ladder th,.mb-pcr-ladder td{padding:7px 4px}.mb-pcr-index{font-size:12px}.mb-pcr-number{gap:3px}.mb-pcr-number>strong{font-size:17px}.mb-pcr-number>span{font-size:17px}.mb-pcr-ladder thead th{font-size:11px}}@media(prefers-reduced-motion:reduce){.mb-pcr-blink{animation:none}}
`;

/** Recorded, nearest-expiry full PCR. Never compare across expiry, session or recorder gaps. */
export function deriveRecordedThreeIndexPcr(state:any,cursor='',previous:any=null,now=Date.now()){
 const key='RECORDED|'+state.date,day=(v:any)=>String(v||'').slice(0,10),cut=cursor?Date.parse(cursor):Infinity;
 const rows=['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>{
  const empty={symbol,expiry:null,value:null,direction:'WAIT',current:null,baseline:null,blinkUntil:0};
  const all=(state.current?.[symbol]?.chain||[]).filter((r:any)=>r.symbol===symbol&&day(r.minute_bucket)===state.date&&Date.parse(r.minute_bucket)<=cut&&day(r.expiry)>=state.date);
  const expiry=[...new Set<string>(all.map((r:any)=>day(r.expiry)))].sort()[0];if(!expiry)return empty;
  const source=all.filter((r:any)=>day(r.expiry)===expiry),times=[...new Set<number>(source.map((r:any)=>Date.parse(r.minute_bucket)))].sort((a,b)=>b-a);
  const sample=(at:number)=>{const matches=source.filter((r:any)=>Date.parse(r.minute_bucket)===at);const r=matches.length===1?matches[0]:null;return r&&r.truth_verdict==='TRUE'&&/^(Exact archived full-chain source|Normalized full-chain source)$/.test(r.full_pcr_source||'')&&typeof r.full_chain_oi_pcr==='number'&&Number.isFinite(r.full_chain_oi_pcr)&&r.full_chain_oi_pcr>=0?{value:r.full_chain_oi_pcr,checked:at,expiry}:null;};
  const current=sample(times[0]);if(!current)return {...empty,expiry};const baseline=times[0]-times[1]===(state.date>='2026-10-19'?60000:180000)?sample(times[1]):null;
  const direction=!baseline?'WAIT':current.value===baseline.value?'FLAT':current.value>baseline.value?'UP':'DOWN',prior=previous?.key===key?previous.rows?.find((r:any)=>r.symbol===symbol&&r.expiry===expiry):null;
  const blinkUntil=prior?.current?.checked===current.checked?prior.blinkUntil:baseline&&prior?.current?.checked===baseline.checked&&['UP','DOWN'].includes(direction)?now+1800:0;
  return {symbol,expiry,value:current.value,direction,current,baseline,blinkUntil};
 });
 for(const row of rows){
  const source=(state.current?.[row.symbol]?.market||[]).filter((r:any)=>r.symbol===row.symbol&&day(r.minute_bucket)===state.date&&Date.parse(r.minute_bucket)<=cut);
  const at=row.current?.checked??Math.max(...source.map((r:any)=>Date.parse(r.minute_bucket)));
  const matches=source.filter((r:any)=>Date.parse(r.minute_bucket)===at),q=matches.length===1?matches[0]:null;
  const valid=q?.truth_verdict==='TRUE'&&typeof q.spot_ltp==='number'&&Number.isFinite(q.spot_ltp)&&q.spot_ltp>0;
  Object.assign(row,{spotValue:valid?q.spot_ltp:null,spotAt:valid?q.minute_bucket:null});
 }
 const ready=rows.every(r=>r.current),synced=ready&&new Set(rows.map(r=>r.current.checked)).size===1;
 return {key,rows,alignment:!ready?'WAIT':synced?'SYNC':'TIME_MISMATCH'};
}
