/** Display-only chapter context. Does not modify live, recorded or candidate models. */
export function renderMarketBookReadingGuide(a:any,state:any,page:number,window:string){
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const num=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const fmt=(v:any,d=2)=>num(v)===null?'—':v.toLocaleString('en-IN',{maximumFractionDigits:d});
 const sign=(v:any,d=2)=>num(v)===null?'—':(v>0?'+':'')+fmt(v,d);
 const when=(v:any)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})+' IST':'ସମୟ ମିଳିନି';
 const guides:any={
  0:{order:['spot','pcr','oi','vix'],focus:'ପ୍ରଥମେ spotର ପରିବର୍ତ୍ତନ; ତା’ପରେ PCR, exact option OI ଓ VIXର ସେହି ସମୟର ତଥ୍ୟ ପଢ଼ନ୍ତୁ।'},
  1:{order:['spot','pcr','vix','sectors'],focus:'Spot କେଉଁ levelରେ ଅଛି ଦେଖନ୍ତୁ; PCR ଓ VIXର ସମୟ ମେଳାନ୍ତୁ। Sector quoteର ସମୟ ଅଲଗା ହୋଇପାରେ।'},
  2:{order:['premium','oi','pcr','vix'],focus:'Expiry ଓ strike ପ୍ରଥମେ ମେଳାନ୍ତୁ; ପରେ premium ଓ OIର ପରିବର୍ତ୍ତନ ଏକାଠି ପଢ଼ନ୍ତୁ।'},
  3:{order:['premium','oi','pcr','vix'],focus:'ପ୍ରତ୍ୟେକ expiryର DTE ଓ contract ପରିଚୟ ଅଲଗା ରଖି ତୁଳନା କରନ୍ତୁ।'},
  4:{order:['future','spot','pcr','sectors'],focus:'Futures ଦାମ, OI ଓ basis ଦେଖନ୍ତୁ; ଅଲଗା futures expiryକୁ ଏକେ series ଭାବେ ଯୋଡ଼ନ୍ତୁନି।'},
  5:{order:['oi','pcr','walls','premium'],focus:'OI → PCR → wall strike ବଦଳ → premium response କ୍ରମରେ ପଢ଼ନ୍ତୁ। OI ବଦଳ ଏକାକୀ buyer/seller exitର ପ୍ରମାଣ ନୁହେଁ।'},
  6:{order:['premium','pcr','oi','vix'],focus:'ଘଟଣାର exact ସମୟ ବାଛନ୍ତୁ; ପୂର୍ବ ଓ ପରବର୍ତ୍ତୀ recorded response ଅଲଗା ପଢ଼ନ୍ତୁ। ତଳର context ହେଉଛି latest recorded endpoint।'},
  7:{order:['premium','oi','pcr','vix'],focus:'Premiumର ନିଜ PDH/PDL break, recovery ବା rejection ପଢ଼ନ୍ତୁ; ପରେ ଅନ୍ୟ expiry ସହ ସମୟ ମେଳାନ୍ତୁ।'},
  8:{order:['stocks','sectors','spot','vix'],focus:'Stock/sector % ହେଉଛି previous close ସହ ତୁଳନା; ଏହା selected replay windowର % ନୁହେଁ। Up/Down count ହେଉଛି unweighted subset।'},
  9:{order:['pcr','spot','oi','vix'],focus:'PCR ଓ spotର exact from/to ସମୟ ମେଳିଲେ ତୁଳନା କରନ୍ତୁ। Dual-axis line cross ହେବା correlationର ପ୍ରମାଣ ନୁହେଁ।'},
  10:{order:['cash','spot','pcr','vix'],focus:'FII/DIIର cash-session date ପ୍ରଥମେ ପଢ଼ନ୍ତୁ; EOD cashକୁ intraday tick ସହ ମିଶାନ୍ତୁନି।'},
  11:{order:['vix','spot','premium','pcr'],focus:'VIX କେତେ ବଦଳିଲା ଓ ସେହି ସମୟର spot/premium କଣ କଲା ଦେଖନ୍ତୁ। VIX ବଢ଼ିବା ଏକାକୀ market direction କୁହେନି।'},
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
 return '<section class="mb-reading-guide" aria-label="Chapter reading guide"><h3>ଏହି chapter କେମିତି ପଢ଼ିବେ</h3><p>'+esc(g.focus)+'</p><p class="mb-note">'+esc(a.symbol+' · selected recorded session '+(a.tradeDate||'—')+' · '+window+' · latest endpoint context; historical event-time values ନୁହେଁ')+'</p><div class="mb-reading-facts">'+g.order.map((key:string)=>{const r=data[key];return '<div class="mb-reading-fact" data-reading-kind="'+key+'"><span>'+esc(r.label)+'</span><strong>'+esc(r.value)+'</strong><small>'+esc(r.basis)+'</small><details data-event-key="reading-'+page+'-'+esc(a.symbol)+'-'+key+'"><summary>ପୂର୍ବ → ଏବେ · ସମୟ</summary><p>'+esc(r.detail)+'</p></details></div>';}).join('')+'</div><p class="mb-note">↑ ବଢ଼ିଛି · ↓ କମିଛି · — ତଥ୍ୟ ମିଳିନି। ପ୍ରତ୍ୟେକ parameter ନିଜ sourceର ସମୟରେ; ଏହି guide buy/sell score ନୁହେଁ।</p></section>';
}

/** Shared live strip: explicit source/scope; never reused in recorded calculations. */
export function renderMarketBookLiveContext(payload:any,symbol:string){
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const n=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const fmt=(v:any,d=2)=>n(v)===null?'—':v.toLocaleString('en-IN',{maximumFractionDigits:d});
 const time=(v:any)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';
 const snapshot=payload?.connected?payload.snapshot:null,a=snapshot?.indices?.find((r:any)=>r.symbol===symbol);
 if(!a)return '<span class="mb-note">LIVE context · '+esc(symbol)+' · disconnected / unavailable. Recorded chapter values remain separate.</span>';
 const sectors=(snapshot.participation||[]).filter((q:any)=>q.identity?.role==='SECTOR'&&q.state==='LIVE'&&n(q.changePct)!==null);
 const vix=snapshot.vix,latest=payload.serverTime;
 const facts=[['Full PCR',a.coverage?.complete===true?fmt(a.fullPcr,4):'—',a.coverage.freshOi+'/'+a.coverage.expected+' fresh OI · expiry '+(a.expiry||'—')+' · source '+time(a.pcrAt)],['Exact option OI','CE '+fmt(a.ce.state==='LIVE'?a.ce.oi:null,0)+' / PE '+fmt(a.pe.state==='LIVE'?a.pe.oi:null,0),(a.expiry||'—')+' / '+(a.strike??'—')+' · CE '+time(a.ce.observedAt)+' / PE '+time(a.pe.observedAt)],['India VIX',fmt(vix?.state==='LIVE'?vix.price:null),vix?.state+' · source '+time(vix?.observedAt)],['Sector quotes',sectors.length?sectors.filter((q:any)=>q.changePct>0).length+' ↑ / '+sectors.filter((q:any)=>q.changePct<0).length+' ↓ / '+sectors.filter((q:any)=>q.changePct===0).length+' ↔':'—',sectors.length+' fresh unweighted quotes · vs previous close']];
 return '<div class="mb-live-heading">LIVE context · '+esc(symbol)+' · server '+esc(time(latest))+' IST</div><div class="mb-live-facts">'+facts.map(([label,value,detail])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></div>').join('')+'</div><small>LIVE selection follows the live panel above; recorded chapter expiry/strike may differ. Parameters carry independent source times.</small>';
}
