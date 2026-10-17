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
  const empty={symbol,expiry:typeof expiry==='string'?expiry:null,value:null,direction:'WAIT',current:null,baseline:null,blinkUntil:0};
  if(!valid)return empty;
  const current={value:q.fullPcr,expiry,period,checked,cycle,sourceMin,sourceMax,ceTotal:q.ceTotal,peTotal:q.peTotal,expected:c.expected};
  const prior=old?.find((r:any)=>r.symbol===symbol);
  if(prior?.current&&prior.expiry===expiry&&prior.current.period===period){
   const p=prior.current;
   if(cycle===p.cycle){
    if(['value','checked','sourceMin','sourceMax','ceTotal','peTotal','expected'].some(k=>current[k]!==p[k]))return empty;
    return {...prior}; // Same snapshot cannot create or restart an arrow.
   }
   if(cycle<p.cycle||checked<=p.checked)return empty;
   const gap=cycle-p.cycle;
   if(gap>=period&&gap<=period+30000&&current.expected===p.expected){
    const direction=current.value===p.value?'FLAT':current.value>p.value?'UP':'DOWN';
    return {symbol,expiry,value:current.value,current,baseline:p,direction,blinkUntil:direction==='FLAT'?0:localNow+1800};
   }
  }
  return {...empty,value:current.value,current};
 });
 const ready=rows.every(r=>r.current&&r.baseline&&r.direction!=='WAIT');
 let alignment='WAIT';
 if(ready){
  const sync=(name:string)=>{
   const samples=rows.map(r=>r[name]);
   return new Set(samples.map(s=>s.cycle)).size===1&&new Set(samples.map(s=>s.period)).size===1&&Math.max(...samples.map(s=>s.sourceMax))-Math.min(...samples.map(s=>s.sourceMin))<=30000;
  };
  alignment=sync('current')&&sync('baseline')?(rows.every(r=>r.direction==='UP')?'ALL_UP':rows.every(r=>r.direction==='DOWN')?'ALL_DOWN':rows.every(r=>r.direction==='FLAT')?'ALL_FLAT':'MIXED'):'TIME_MISMATCH';
 }
 return {key,serverAt:now,rows,alignment,live:!!live};
}

export function renderLiveThreeIndexPcr(view:any,localNow=Date.now()) {
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const labels:any={WAIT:'WAIT · comparison pending',ALL_UP:'↑ ALL RISING',ALL_DOWN:'↓ ALL FALLING',ALL_FLAT:'→ ALL FLAT',MIXED:'↕ MIXED',TIME_MISMATCH:'TIME MISMATCH'};
 const glyph:any={UP:'↑',DOWN:'↓',FLAT:'→',WAIT:'—'};
 const time=(ms:number)=>Number.isFinite(ms)?new Date(ms).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 return '<section class="mb-full-pcr" aria-label="Three-index live full-chain PCR"><div class="mb-full-pcr-heading"><strong>Full PCR · LIVE snapshots</strong><span class="mb-pcr-alignment" data-pcr-alignment="'+esc(view.alignment)+'" role="status">'+esc(labels[view.alignment]||labels.WAIT)+'</span></div><div class="mb-full-pcr-grid">'+view.rows.map((r:any)=>{
  const remaining=Math.max(0,r.blinkUntil-localNow),blink=remaining>0&&remaining<=1800;
  const label=typeof r.value==='number'?r.value.toFixed(4):'—';
  return '<article data-pcr-index="'+esc(r.symbol)+'"><span class="mb-pcr-index">'+esc(r.symbol)+'</span><div class="mb-pcr-number"><strong>'+label+'</strong><span data-pcr-direction="'+esc(r.direction)+'"'+(blink?' class="mb-pcr-blink" style="animation-delay:-'+Math.floor(1800-remaining)+'ms"':'')+' aria-label="PCR '+esc(r.direction.toLowerCase())+'">'+esc(glyph[r.direction])+'</span></div><small>'+esc(r.expiry||'Expiry unavailable')+(r.symbol==='BANKNIFTY'?' · M':'')+'</small><small>'+esc(r.current?r.current.period/60000+'m · '+time(r.current.checked)+' IST':'UNAVAILABLE')+'</small><details data-live-detail="pcr-'+esc(r.symbol)+'"><summary>Source</summary><small>Coverage '+esc(r.current?.expected)+'/'+esc(r.current?.expected)+' · '+esc(r.baseline?time(r.baseline.checked):'Baseline pending')+' → '+esc(time(r.current?.checked))+'</small><small>Arrow = PCR change. Same-period baseline and current cycles must match across indices for alignment.</small></details></article>';
 }).join('')+'</div></section>';
}

export const LIVE_THREE_INDEX_PCR_CSS=`
.mb-full-pcr{margin:10px 0 14px}.mb-full-pcr-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px}.mb-full-pcr-heading>strong{font-size:15px;font-weight:500}.mb-pcr-alignment{font-size:12px;border:1px solid #425252;border-radius:7px;padding:5px 8px;color:#d4e6df}.mb-pcr-alignment[data-pcr-alignment=ALL_UP]{color:#69e9d9}.mb-pcr-alignment[data-pcr-alignment=ALL_DOWN]{color:#ff9f89}.mb-pcr-alignment[data-pcr-alignment=MIXED]{color:#edc86c}.mb-full-pcr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mb-full-pcr-grid>article{min-width:0;border-radius:10px;background:#192829;padding:12px}.mb-pcr-index{font-size:13px}.mb-pcr-number{display:flex;align-items:center;gap:7px;margin:6px 0;font-variant-numeric:tabular-nums}.mb-pcr-number>strong{font-size:27px;font-weight:500;overflow-wrap:anywhere}.mb-pcr-number>span{font-size:24px}.mb-pcr-number [data-pcr-direction=UP]{color:#69e9d9}.mb-pcr-number [data-pcr-direction=DOWN]{color:#ff9f89}.mb-full-pcr-grid small{display:block;font-size:12px;color:#bbcdc7;overflow-wrap:anywhere}.mb-full-pcr-grid details{margin-top:7px;font-size:12px}.mb-pcr-blink{animation:mb-pcr-change .6s ease-in-out 3 both}@keyframes mb-pcr-change{0%,100%{opacity:1;transform:translateY(0)}50%{opacity:.35;transform:translateY(-2px)}}@media(max-width:480px){.mb-full-pcr-grid{gap:5px}.mb-full-pcr-grid>article{padding:8px 5px}.mb-pcr-index{font-size:11px}.mb-pcr-number{gap:3px}.mb-pcr-number>strong{font-size:19px}.mb-pcr-number>span{font-size:19px}.mb-full-pcr-grid small{font-size:11px}}@media(prefers-reduced-motion:reduce){.mb-pcr-blink{animation:none}}
`;
