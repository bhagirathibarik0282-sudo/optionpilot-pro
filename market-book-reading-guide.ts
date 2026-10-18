/** Display-only chapter context. Does not modify live, recorded or candidate models. */
export function renderMarketBookReadingGuide(a:any,state:any,page:number,window:string){
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const num=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const fmt=(v:any,d=2)=>num(v)===null?'—':v.toLocaleString('en-IN',{maximumFractionDigits:d});
 const sign=(v:any,d=2)=>num(v)===null?'—':(v>0?'+':'')+fmt(v,d);
 const when=(v:any)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST':'ସମୟ ମିଳିନି';
 const guides:any={
  0:{order:['spot','pcr','oi','vix'],focus:'ଏକ ନଜରରେ index, premium ଓ market context ପଢ଼ନ୍ତୁ।'},
  1:{order:['spot'],focus:'Spot, PDH / PDL / PDC ଓ verified daily pivots ପଢ଼ନ୍ତୁ।'},
  2:{order:['premium','oi'],focus:'Expiry ଓ strike ପ୍ରଥମେ ମେଳାନ୍ତୁ; ପରେ premium ଓ OIର ପରିବର୍ତ୍ତନ ଏକାଠି ପଢ଼ନ୍ତୁ।'},
  3:{order:['premium','oi'],focus:'ପ୍ରତ୍ୟେକ expiryର DTE ଓ contract ପରିଚୟ ଅଲଗା ରଖି ତୁଳନା କରନ୍ତୁ।'},
  4:{order:['future'],focus:'Futures ଦାମ, OI, volume ଓ basis ପଢ଼ନ୍ତୁ; expiry continuity ଅଲଗା ଯାଞ୍ଚ କରନ୍ତୁ।'},
  5:{order:['oi','pcr','walls'],focus:'OI → PCR → wall strike ବଦଳ → premium response କ୍ରମରେ ପଢ଼ନ୍ତୁ। OI ବଦଳ ଏକାକୀ buyer/seller exitର ପ୍ରମାଣ ନୁହେଁ।'},
  6:{order:['premium'],focus:'ଘଟଣାର exact ସମୟ ବାଛନ୍ତୁ; ପୂର୍ବ ଓ ପରବର୍ତ୍ତୀ recorded response ଅଲଗା ପଢ଼ନ୍ତୁ। ତଳର context ହେଉଛି latest recorded endpoint।'},
  7:{order:['premium','oi'],focus:'Premiumର ନିଜ PDH/PDL break, recovery ବା rejection ପଢ଼ନ୍ତୁ; ପରେ ଅନ୍ୟ expiry ସହ ସମୟ ମେଳାନ୍ତୁ।'},
  8:{order:['stocks','sectors'],focus:'Stock/sector % ହେଉଛି previous close ସହ ତୁଳନା; ଏହା selected replay windowର % ନୁହେଁ। Up/Down count ହେଉଛି unweighted subset।'},
  9:{order:['spot','pcr'],focus:'PCR ଓ spotର exact from/to ସମୟ ମେଳିଲେ ତୁଳନା କରନ୍ତୁ। Dual-axis line cross ହେବା correlationର ପ୍ରମାଣ ନୁହେଁ।'},
  10:{order:['cash'],focus:'FII/DIIର cash-session date ପ୍ରଥମେ ପଢ଼ନ୍ତୁ; EOD cashକୁ intraday tick ସହ ମିଶାନ୍ତୁନି।'},
  11:{order:['vix'],focus:'India VIX value, ପରିବର୍ତ୍ତନ ଓ ନିଜ recorded chart ପଢ଼ନ୍ତୁ।'},
  12:{order:['spot','pcr','oi','sectors'],focus:'ପ୍ରଥମେ ସମୟ ଓ contract ମେଳାନ୍ତୁ; ପରେ ତଥ୍ୟ ଏକମତ କି ଅଲଗା ଚଳୁଛି ଦେଖନ୍ତୁ। Missing dataକୁ vote ଭାବେ ଗଣନ୍ତୁନି।'}
 };
 const g=guides[page]||guides[0],pcr=a.pcr||{},spot=a.spot||{},ce=a.ce||{},pe=a.pe||{},vix=a.vix||{},future=a.future||{};
 const validPcr=/^(Exact archived full-chain source|Normalized full-chain source)$/.test(pcr.source||'');
 const endpoint=(m:any,d=2)=>fmt(m?.from,d)+' → '+fmt(m?.value,d)+' · Δ '+sign(m?.delta,d)+' · '+when(m?.fromAt)+' → '+when(m?.at);
 const quoteBreadth=(snapshot:any,rows:any[],field:string,label:string)=>{
  const valid=(Array.isArray(rows)?rows:[]).filter(r=>num(r?.[field])!==null);
  return {label,value:valid.length?valid.filter(r=>r[field]>0).length+' ↑ / '+valid.filter(r=>r[field]<0).length+' ↓ / '+valid.filter(r=>r[field]===0).length+' ↔':'—',detail:valid.length+'/'+(Array.isArray(rows)?rows.length:0)+' usable quotes · vs previous close · '+when(snapshot?.timestamp),basis:'SEPARATE QUOTE SNAPSHOT · replay ସହ alignment ଅଜଣା'};
 };
 const data:any={
  spot:{label:'Spot · points',value:fmt(spot.value),detail:endpoint(spot),basis:'RECORDED · '+window},
  premium:{label:'Exact premium · ₹',value:'CE '+fmt(ce.value)+' / PE '+fmt(pe.value),detail:'CE '+(ce.expiry||'—')+' / '+(ce.strike??'—')+' · '+endpoint(ce)+' | PE '+(pe.expiry||'—')+' / '+(pe.strike??'—')+' · '+endpoint(pe),basis:'RECORDED · separate exact contracts'},
  pcr:{label:'Full PCR · ratio',value:validPcr?fmt(pcr.value,4):'—',detail:validPcr?endpoint(pcr,4):'Full-chain source ଯାଞ୍ଚ ହୋଇନି',basis:'RECORDED · expiry '+(a.expiry||'—')},
  oi:{label:'Exact option OI · source units',value:'CE '+fmt(ce.oi?.value,0)+' / PE '+fmt(pe.oi?.value,0),detail:'CE '+(ce.expiry||'—')+' / '+(ce.strike??'—')+' · Δ '+sign(ce.oi?.delta,0)+' · '+when(ce.oi?.fromAt)+' → '+when(ce.oi?.at)+' | PE '+(pe.expiry||'—')+' / '+(pe.strike??'—')+' · Δ '+sign(pe.oi?.delta,0)+' · '+when(pe.oi?.fromAt)+' → '+when(pe.oi?.at),basis:'RECORDED · '+window+' · lots ନୁହେଁ'},
  vix:{label:'India VIX',value:fmt(vix.value),detail:endpoint(vix)+' · Δ '+sign(vix.percent)+'%',basis:'RECORDED · ଏକ VIX series; ଯୋଗ କରନ୍ତୁନି'},
  future:{label:'Futures · price / OI',value:fmt(future.value)+' / '+fmt(future.oi?.value,0),detail:endpoint(future)+' · OI Δ '+sign(future.oi?.delta,0)+' · basis '+fmt(future.basis),basis:'RECORDED · expiry continuity unverified'},
  walls:{label:'OI wall · strike',value:'CE '+fmt(a.callWall?.strike,0)+' / PE '+fmt(a.putWall?.strike,0),detail:'CE '+fmt(a.callWall?.from,0)+' → '+fmt(a.callWall?.strike,0)+' · '+when(a.callWall?.fromAt)+' → '+when(a.callWall?.at)+' | PE '+fmt(a.putWall?.from,0)+' → '+fmt(a.putWall?.strike,0)+' · '+when(a.putWall?.fromAt)+' → '+when(a.putWall?.at),basis:'RECORDED · exact selected expiry'},
  sectors:quoteBreadth(state.sectors,state.sectors?.sectors,'pct','Sectors · unweighted quotes'),
  stocks:quoteBreadth(state.stocks?.[a.symbol],state.stocks?.[a.symbol]?.stocks,'change','Heavyweight subset · unweighted'),
  cash:{label:'FII / DII · net ₹ crore',value:sign(state.cash?.windows?.[0]?.fiiNetCrore)+' / '+sign(state.cash?.windows?.[0]?.diiNetCrore),detail:'Cash session '+(state.cash?.latestStoredSessionDate||'—')+' · '+(state.cash?.windows?.[0]?.window||'—'),basis:'EOD CASH · intraday tick ନୁହେଁ'}
 };
 return '<section class="mb-reading-guide" aria-label="Chapter reading guide" data-op-explanation><h3>ଏହି chapter କେମିତି ପଢ଼ିବେ</h3><p>'+esc(g.focus)+'</p><p class="mb-note">'+esc(a.symbol+' · selected recorded session '+(a.tradeDate||'—')+' · '+window+' · latest endpoint context; historical event-time values ନୁହେଁ')+'</p><div class="mb-reading-facts">'+g.order.map((key:string)=>{const r=data[key];return '<div class="mb-reading-fact" data-reading-kind="'+key+'"><span>'+esc(r.label)+'</span><strong>'+esc(r.value)+'</strong><small>'+esc(r.basis)+'</small><details data-event-key="reading-'+page+'-'+esc(a.symbol)+'-'+key+'"><summary>ପୂର୍ବ → ଏବେ · ସମୟ</summary><p>'+esc(r.detail)+'</p></details></div>';}).join('')+'</div><p class="mb-note">↑ ବଢ଼ିଛି · ↓ କମିଛି · — ତଥ୍ୟ ମିଳିନି। ପ୍ରତ୍ୟେକ parameter ନିଜ sourceର ସମୟରେ; ଏହି guide buy/sell score ନୁହେଁ।</p></section>';
}

/** Chapter-specific projection of the existing Kite stream. Never reads recorded values. */
export function renderMarketBookLiveContext(payload:any,symbol:string,page=0,hidePcr=false,display:any={}){
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const n=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const formats=(renderMarketBookLiveContext as any).formats||((renderMarketBookLiveContext as any).formats={numbers:new Map(),time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})});
 const fmt=(v:any,d=2)=>{if(n(v)===null)return '—';if(!formats.numbers.has(d))formats.numbers.set(d,new Intl.NumberFormat('en-IN',{maximumFractionDigits:d}));return formats.numbers.get(d).format(v);};
 const time=(v:any)=>v&&Number.isFinite(Date.parse(v))?formats.time.format(new Date(v))+' IST':'—';
 const note=(text:string)=>'<p class="mb-note">'+esc(text)+'</p>';
 if([3,6,7,10].includes(page))return ''; // These chapters have their own expiry, event, premium or EOD content.
 const snapshot=payload?.connected===true?payload.snapshot:null,now=Date.parse(payload?.serverTime||'');
 const date=(at:number)=>Number.isFinite(at)?new Date(at+19800000).toISOString().slice(0,10):'';
 const age=(at:any)=>now-Date.parse(at||'');
 const source=payload?.source||snapshot?.source;
 const valid=source==='KITE_WEBSOCKET_FULL'&&Number.isFinite(now)&&snapshot?.tradeDate===date(now)&&age(snapshot?.asOf)>=-5000&&age(snapshot?.asOf)<=4000;
 if(!valid||!Array.isArray(snapshot?.indices))return '<p class="mb-live-state" role="status">'+esc(symbol+' · '+(payload?.connectionState||'disconnected / unavailable'))+'</p>'+note('Fresh values unavailable. Recorded chapter values remain separate.');
 const card=(key:string,label:string,value:string,detail:string,stamp='')=>'<div data-live-kind="'+esc(key)+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(stamp?'<small class="mb-live-stamp">'+esc(stamp)+'</small>':'')+'<small data-mb-detail>'+esc(detail)+'</small></div>';
 const validExpiry=(expiry:any)=>typeof expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expiry)&&expiry>=snapshot.tradeDate;
 const fresh=(q:any,role:string,index?:string,side?:string,expiry?:string,strike?:number)=>q?.state==='LIVE'&&q.identity?.role===role&&(!index||q.identity.symbol===index)&&(role!=='FUTURE'||validExpiry(q.identity.expiry))&&(!side||validExpiry(expiry)&&typeof strike==='number'&&Number.isFinite(strike)&&strike>0&&q.identity.side===side&&q.identity.expiry===expiry&&q.identity.strike===strike)&&age(q.observedAt)>=-5000&&age(q.observedAt)<=30000&&age(q.receivedAt)>=0&&age(q.receivedAt)<=30000&&date(Date.parse(q.observedAt))===snapshot.tradeDate&&date(Date.parse(q.receivedAt))===snapshot.tradeDate;
 const orders:any={0:['spot','future','ce','pe','pcr','vix'],1:['spot','pdc','spotChange'],2:['ce','pe','ceOi','peOi'],4:['future','futureOi','futureVolume','basis'],5:['ceOi','peOi','pcr','callWall','putWall'],8:['stocks','sectors'],9:['spot','pcr'],11:['vix'],12:['spot','future','basis','ce','pe','pcr','vix']};
 const notes:any={1:'PDH / PDL / pivots ତଳର recorded sectionରେ reference levels; ଏହି live cards spot ଓ previous-close change ଦେଖାଏ।',12:'Live values ପ୍ରତ୍ୟେକର ନିଜ source timeରେ; ଏଠାରେ ନୂଆ agreement score ବା candidate ତିଆରି ହୁଏନି।'};
 const indices=[0,9].includes(page)?['NIFTY','SENSEX','BANKNIFTY']:[symbol];
 const blocks=indices.map(index=>{
  const a=snapshot.indices.find((r:any)=>r?.symbol===index);
  if(!a)return note(index+' · live inventory unavailable');
  const spot=a.spot||{},future=a.future||{},ce=a.ce||{},pe=a.pe||{},vix=snapshot.vix||{};
  const flags:any={spot:fresh(spot,'SPOT',index),future:fresh(future,'FUTURE',index),ce:fresh(ce,'OPTION',index,'CE',a.expiry,a.strike),pe:fresh(pe,'OPTION',index,'PE',a.expiry,a.strike),vix:fresh(vix,'VIX')};
  const price=(q:any,on:boolean)=>on&&n(q.price)!==null&&q.price>0?q.price:null;
  const field=(q:any,on:boolean,key:string)=>on&&n(q[key])!==null&&q[key]>=0?q[key]:null;
  const detail=(q:any,on:boolean)=>String(on?'LIVE':'WITHHELD · '+(q.state||'UNAVAILABLE'))+' · source '+time(q.observedAt)+' · received '+time(q.receivedAt);
  const quoteCard=(key:string,label:string,q:any,on:boolean,d=2,keyField='price')=>card(key,label,fmt(keyField==='price'?price(q,on):field(q,on,keyField),d),detail(q,on),on?'LIVE · '+time(q.observedAt):'UNAVAILABLE');
  const contract=(q:any)=>index+' · '+(q.identity?.expiry||a.expiry||'—')+' · '+(q.identity?.strike??a.strike??'—')+' · '+(q.identity?.side||'—');
  const usesSample=Object.prototype.hasOwnProperty.call(payload,'pcrDisplay'),sample=payload.pcrDisplay?.[index];
  const coverage=usesSample?sample?.coverage:a.coverage;
  const complete=validExpiry(a.expiry)&&coverage?.complete===true&&Number.isInteger(coverage.expected)&&coverage.expected>0&&coverage.freshOi===coverage.expected;
  const sampleOk=usesSample&&complete&&sample?.state==='COMPLETE'&&sample.expiry===a.expiry&&[60000,180000].includes(sample.periodMs)&&date(Date.parse(sample.checkedAt))===snapshot.tradeDate&&date(Date.parse(sample.sourceMinAt))===snapshot.tradeDate&&date(Date.parse(sample.sourceMaxAt))===snapshot.tradeDate&&age(sample.checkedAt)>=0&&age(sample.checkedAt)<=sample.periodMs+30000&&Date.parse(sample.checkedAt)-Date.parse(sample.sourceMinAt)>=-5000&&Date.parse(sample.checkedAt)-Date.parse(sample.sourceMinAt)<=30000&&Date.parse(sample.checkedAt)-Date.parse(sample.sourceMaxAt)>=-5000&&Date.parse(sample.sourceMaxAt)>=Date.parse(sample.sourceMinAt)&&Date.parse(sample.sourceMaxAt)-Date.parse(sample.sourceMinAt)<=30000;
  const tickOk=!usesSample&&complete&&age(a.pcrAt)>=-5000&&age(a.pcrAt)<=30000&&n(coverage.sourceSkewMs)!==null&&coverage.sourceSkewMs>=0&&coverage.sourceSkewMs<=30000;
  const pcr=sampleOk?sample:tickOk?a:null;
  const pcrDetail=usesSample?(sampleOk?sample.periodMs/60000+' min snapshot · checked '+time(sample.checkedAt)+' · source '+time(sample.sourceMinAt)+' → '+time(sample.sourceMaxAt)+' · '+coverage.freshOi+'/'+coverage.expected+' verified OI':'Complete snapshot unavailable'):(a.coverage?.freshOi??0)+'/'+(a.coverage?.expected??0)+' fresh OI · expiry '+(a.expiry||'—')+' · source '+time(a.pcrAt);
  const wall=(side:string)=>{const w=pcr?.[side+'Wall'];return card(side+'Wall',(side==='call'?'CE':'PE')+' wall · strike',fmt(n(w?.strike)!==null&&w.strike>0&&n(w?.oi)!==null&&w.oi>0?w.strike:null,0),(w?'OI '+fmt(w.oi,0)+' · ties '+(Array.isArray(w.tiedStrikes)?w.tiedStrikes.join(', '):'—')+' · ':'')+pcrDetail);};
  const breadth=(role:string)=>{
   const rows=(Array.isArray(snapshot.participation)?snapshot.participation:[]).filter((q:any)=>q?.identity?.role===role),quotes=rows.filter((q:any)=>fresh(q,role)&&n(q.changePct)!==null);
   const label=role==='SECTOR'?'Sector quotes':'Heavyweight quote subset';
   const summary=card(role==='SECTOR'?'sectors':'stocks',label,quotes.length?quotes.filter((q:any)=>q.changePct>0).length+' ↑ / '+quotes.filter((q:any)=>q.changePct<0).length+' ↓ / '+quotes.filter((q:any)=>q.changePct===0).length+' ↔':'—',quotes.length+'/'+rows.length+' fresh unweighted quotes · vs previous close · shared universe, not '+index+' weights',quotes.length+'/'+rows.length+' fresh');const details='<details data-live-detail="'+esc(index+'-'+role)+'"><summary>'+esc(label)+' · source times</summary>'+rows.map((q:any)=>note((q.identity?.label||'—')+' · '+fmt(fresh(q,role)?q.changePct:null)+'% · '+detail(q,fresh(q,role)))).join('')+'</details>';const up=quotes.filter((q:any)=>q.changePct>0).length,down=quotes.filter((q:any)=>q.changePct<0).length,flat=quotes.length-up-down,total=rows.length;
   const wheel=display.wheel&&total?'<div class="mb-breadth-wheel-row"><div class="mb-breadth-wheel" style="--up:'+up/total*360+'deg;--down:'+(up+down)/total*360+'deg;--flat:'+(up+down+flat)/total*360+'deg" role="img" aria-label="'+esc(label+' unweighted breadth: '+up+' up, '+down+' down, '+flat+' unchanged, '+(total-quotes.length)+' unavailable')+'"><span>'+quotes.length+'/'+total+'</span></div><small>↑ '+up+' · ↓ '+down+' · → '+flat+' · unavailable '+(total-quotes.length)+'<br>Equal quote counts · not index-weight contribution</small></div>':'';
   return summary.slice(0,-6)+wheel+details+'</div>';
  };
  const data:any={
   spot:()=>quoteCard('spot','Spot · points',spot,flags.spot),future:()=>quoteCard('future','Futures · '+(future.identity?.expiry||'—'),future,flags.future),
   ce:()=>quoteCard('ce',contract(ce)+' · ₹',ce,flags.ce),pe:()=>quoteCard('pe',contract(pe)+' · ₹',pe,flags.pe),
   ceOi:()=>quoteCard('ceOi',contract(ce)+' · OI',ce,flags.ce,0,'oi'),peOi:()=>quoteCard('peOi',contract(pe)+' · OI',pe,flags.pe,0,'oi'),
   futureOi:()=>quoteCard('futureOi','Futures OI · '+(future.identity?.expiry||'—'),future,flags.future,0,'oi'),futureVolume:()=>quoteCard('futureVolume','Futures volume',future,flags.future,0,'volume'),
   vix:()=>quoteCard('vix','India VIX',vix,flags.vix),
   pdc:()=>card('pdc','Spot previous close · reference',fmt(flags.spot&&n(spot.pdc)!==null&&spot.pdc>0?spot.pdc:null),detail(spot,flags.spot)),
   spotChange:()=>card('spotChange','Spot day change · %',fmt(flags.spot?spot.changePct:null),detail(spot,flags.spot)+' · vs previous close'),
   basis:()=>card('basis','Futures − spot · points',fmt(price(spot,flags.spot)!==null&&price(future,flags.future)!==null&&Math.abs(Date.parse(spot.observedAt)-Date.parse(future.observedAt))<=5000?a.futuresBasis:null),'Spot '+time(spot.observedAt)+' / futures '+time(future.observedAt)+' · maximum source skew 5s'),
   pcr:()=>card('pcr','Full PCR'+(usesSample?' · snapshot':''),fmt(pcr&&n(pcr.fullPcr)!==null&&pcr.fullPcr>=0?pcr.fullPcr:null,4),pcrDetail,pcr?(usesSample?sample.periodMs/60000+' min · '+time(sample.checkedAt):time(a.pcrAt)):'UNAVAILABLE'),
   callWall:()=>wall('call'),putWall:()=>wall('put'),stocks:()=>breadth('STOCK'),sectors:()=>breadth('SECTOR')
  };
  return '<section class="mb-live-index" aria-label="'+esc((page===11?'India VIX':page===8?'Shared stocks and sectors':index)+' chapter live values')+'"><h3>'+esc(page===11?'India VIX':page===8?'Stocks & sectors':index)+([0,2,5,9,12].includes(page)?' · '+esc(a.expiry||'No live expiry')+' / '+esc(a.strike??'No live strike'):'')+'</h3><div class="mb-live-facts">'+(orders[page]||orders[0]).filter((key:string)=>(!hidePcr||key!=='pcr')&&(!display.metric||display.metric==='ALL'||key===display.metric)).map((key:string)=>data[key]()).join('')+'</div></section>';
 });
 return '<div class="mb-live-heading" data-mb-detail>Kite feed · server '+esc(time(payload.serverTime))+'</div>'+blocks.join('')+(notes[page]?note(notes[page]):'')+note('LIVE selection follows the live panel above; recorded chapter expiry/strike may differ. Parameters carry independent source times. OI is in source units.');
}
