/** Descriptive comparisons only. Never feeds candidate ranking or execution. */
export function deriveMarketAgreement(input:any) {
 const n=(v:any):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const ms=(v:any)=>typeof v==='string'?Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)?v.replace(' ','T')+'+05:30':v):NaN;
 const day=(v:any)=>Number.isFinite(ms(v))?new Date(ms(v)+19800000).toISOString().slice(0,10):'';
 const categories=[['SUMMARY','Summary'],['PARTICIPATION','Stocks ↔ sectors'],['INDICES','Indices ↔ futures'],['PREMIUM','Premium ↔ DTE'],['POSITIONING','OI / PCR / walls'],['VOLATILITY','VIX ↔ premium']];
 const category=categories.some(c=>c[0]===input.category)?input.category:'SUMMARY',symbol=['NIFTY','SENSEX','BANKNIFTY'].includes(input.symbol)?input.symbol:'NIFTY';
 const models=input.models||{},m=models[symbol]||{},rows:any[]=[];
 const metric=(v:any)=>v||{};
 const pair=(label:string,a:any,b:any,context=false,reason='')=>{
  a=metric(a);b=metric(b);const finite=n(a.percent)!==null&&n(b.percent)!==null;
  const times=[a.at,b.at,a.fromAt,b.fromAt].every(t=>Number.isFinite(ms(t)));
  const aligned=times&&ms(a.at)===ms(b.at)&&ms(a.fromAt)===ms(b.fromAt)&&ms(a.fromAt)<ms(a.at)&&[a.at,b.at,a.fromAt,b.fromAt].every(t=>day(t)===input.date);
  const requested=/^\d+m$/.test(input.window||'')?Number(input.window.slice(0,-1))*60000:null;
  const exact=aligned&&requested!==null&&ms(a.at)-ms(a.fromAt)===requested&&Number.isFinite(ms(input.asOf))&&ms(a.at)<=ms(input.asOf);
  const status=!finite?'MISSING':!exact?'UNSYNCED':a.percent===0||b.percent===0?'FLAT':Math.sign(a.percent)===Math.sign(b.percent)?'SAME':'OPPOSITE';
  return {label,status,left:n(a.percent),right:n(b.percent),at:a.at||null,fromAt:a.fromAt||null,rightAt:b.at||null,rightFromAt:b.fromAt||null,context,reason:reason||(!finite?'Exact values or baseline missing':!exact?'Same session and exact requested endpoints required':'Exact recorded endpoints')};
 };
 const add=(...args:Parameters<typeof pair>)=>rows.push(pair(...args));
 const premiumRows=()=>{
  const side=input.side==='PE'?'PE':'CE',pairs=m.allExpiryPairs||[],base=pairs.find((p:any)=>p.expiry===input.expiry)||pairs[0];
  for(const p of pairs){if(p===base)continue;const a=base?.[side.toLowerCase()],b=p?.[side.toLowerCase()];const identity=!!a?.identity&&!!b?.identity&&a.expiry===base.expiry&&b.expiry===p.expiry&&n(a.strike)!==null&&a.strike>0&&a.symbol===symbol&&b.symbol===symbol&&a.type===side&&b.type===side&&a.strike===b.strike&&a.expiry!==b.expiry;
   const r=pair(`${side} ${a?.strike??'—'} · ${base?.expiry||'—'} (DTE ${a?.dte??'—'}) ↔ ${p.expiry} (DTE ${b?.dte??'—'})`,a,b,true,'Same strike / side across distinct expiries; DTE response is context');if(!identity||n(a?.dte)===null||n(b?.dte)===null||a.dte<0||b.dte<0){r.status='MISSING';r.reason='Exact index, strike, side, DTE and distinct expiry identities required';}rows.push(r);
  }
  if(!pairs.length||pairs.length<2)rows.push({label:'Multi-expiry premium response',status:'MISSING',context:true,reason:'Two exact same-strike / same-side expiry recordings required'});
 };
 const participation=()=>{
  const cap=Number.isFinite(ms(input.asOf))?ms(input.asOf):NaN;
  const source=input.snapshots||[];
  const receipts=new Map<string,number>();for(const s of source)receipts.set(s.timestamp,(receipts.get(s.timestamp)||0)+1);
  const snapshots=source.filter((s:any)=>receipts.get(s.timestamp)===1).filter((s:any)=>s.source==='SERVER_BACKGROUND_KITE_QUOTES'&&s.tradingDate===input.date&&day(s.timestamp)===input.date&&ms(s.timestamp)<=cap).sort((a:any,b:any)=>ms(a.timestamp)-ms(b.timestamp));
  const latest=snapshots.at(-1),end=latest&&cap-ms(latest.timestamp)<=360000?latest:null,mins=[3,6,15,30].includes(Number(input.participationWindow))?Number(input.participationWindow):null;
  const start=mins&&end?snapshots.filter((s:any)=>ms(s.timestamp)<ms(end.timestamp)&&Math.abs(ms(end.timestamp)-ms(s.timestamp)-mins*60000)<=30000).at(-1):null;
  const stocks=end?.stocks?.[symbol]||[],sectors=end?.sectors||[];
  const availableStocks=[...new Set<string>(stocks.map((r:any)=>r.name))],availableSectors=[...new Set<string>(sectors.map((r:any)=>r.name))];
  const stock=availableStocks.includes(input.stock)?input.stock:availableStocks[0],sector=availableSectors.includes(input.sector)?input.sector:availableSectors[0];
  const unique=(rs:any[],name:string)=>rs.filter((r:any)=>r.name===name).length===1?rs.find((r:any)=>r.name===name):null;
  const a=unique(stocks,stock),b=unique(sectors,sector),oldA=unique(start?.stocks?.[symbol]||[],stock),oldB=unique(start?.sectors||[],sector);
  const valid=(r:any,s:any)=>r&&s&&Number.isFinite(ms(r.exchangeTimestamp))&&day(r.exchangeTimestamp)===input.date&&ms(r.exchangeTimestamp)<=ms(s.timestamp)&&ms(s.timestamp)-ms(r.exchangeTimestamp)<=30000;
  const value=(r:any,old:any)=>mins?(n(r?.price)!==null&&n(old?.price)!==null&&old.price>0&&r.price>0?(r.price/old.price-1)*100:null):n(r?.change??r?.pct);
  const av=value(a,oldA),bv=value(b,oldB),complete=av!==null&&bv!==null,qualified=valid(a,end)&&valid(b,end)&&Math.abs(ms(a?.exchangeTimestamp)-ms(b?.exchangeTimestamp))<=30000&&(!mins||(valid(oldA,start)&&valid(oldB,start)&&Math.abs(ms(oldA?.exchangeTimestamp)-ms(oldB?.exchangeTimestamp))<=30000&&Math.abs(ms(a?.exchangeTimestamp)-ms(oldA?.exchangeTimestamp)-mins*60000)<=30000&&Math.abs(ms(b?.exchangeTimestamp)-ms(oldB?.exchangeTimestamp)-mins*60000)<=30000));
  rows.push({label:(stock||'Stock')+' ↔ '+(sector||'sector proxy'),status:!complete?'MISSING':!qualified?'UNSYNCED':av===0||bv===0?'FLAT':Math.sign(av!)===Math.sign(bv!)?'SAME':'OPPOSITE',left:av,right:bv,at:a?.exchangeTimestamp||null,rightAt:b?.exchangeTimestamp||null,fromAt:mins?oldA?.exchangeTimestamp:null,rightFromAt:mins?oldB?.exchangeTimestamp:null,context:true,reason:!complete?'Stored prices / previous-close changes incomplete':!qualified?'Quote source times missing, stale or outside 30s tolerance':mins?'Sampled '+mins+'m response; source endpoints within 30s tolerance':'Day change vs each instrument previous close; quote times within 30s tolerance'});
  const archiveRow=(r:any,kind:string)=>({kind,name:r.name,price:n(r.price),change:n(r.change??r.pct),sourceAt:r.exchangeTimestamp});
  const uniqueRows=(rs:any[],kind:string)=>rs.filter((r:any)=>rs.filter(x=>x.name===r.name).length===1&&valid(r,latest)&&n(r.price)!==null&&r.price>0).map((r:any)=>archiveRow(r,kind));
  const lastVerified=!end&&latest?{receipt:latest.timestamp,stocks:uniqueRows(latest.stocks?.[symbol]||[],'Stock'),sectors:uniqueRows(latest.sectors||[],'Sector proxy')}:null;
  return {availableStocks,availableSectors,stock,sector,receipt:end?.timestamp||null,baselineReceipt:start?.timestamp||null,lastVerified};
 };
 let selection:any={};
 if(category==='PARTICIPATION')selection=participation();
 if(category==='INDICES'){
  for(const other of ['NIFTY','SENSEX','BANKNIFTY'].filter(s=>s!==symbol))add(symbol+' ↔ '+other,m.spot,models[other]?.spot);
  const r=pair(symbol+' spot ↔ futures',m.spot,m.future,true,'Futures expiry continuity is unverified; excluded from agreement');r.status='MISSING';rows.push(r);
 }
 if(category==='PREMIUM')premiumRows();
 if(category==='POSITIONING'){
  add('CE premium ↔ CE OI',m.ce,m.ce?.oi,true);add('PE premium ↔ PE OI',m.pe,m.pe?.oi,true);add('Spot ↔ expiry PCR',m.spot,m.pcr,true,'PCR direction is descriptive; full-chain coverage is unproven');
 }
 if(category==='VOLATILITY'){add('India VIX ↔ CE premium',m.vix,m.ce,true,'One VIX series; no CE / PE directional vote');add('India VIX ↔ PE premium',m.vix,m.pe,true,'One VIX series; no CE / PE directional vote');}
 if(category==='SUMMARY'){
  for(const other of ['NIFTY','SENSEX','BANKNIFTY'].filter(s=>s!==symbol))add(symbol+' ↔ '+other,m.spot,models[other]?.spot);
  add('Spot ↔ CE premium',m.spot,m.ce,true);add('Spot ↔ PE premium',m.spot,m.pe,true);
 }
 const usable=rows.filter(r=>['SAME','OPPOSITE','FLAT'].includes(r.status)).length;
 const result=['SAME','OPPOSITE','FLAT','UNSYNCED','MISSING'].includes(input.result)?input.result:'ALL';
 return {category,categories,symbol,rows:rows.filter(r=>result==='ALL'||r.status===result),total:rows.length,usable,result,selection,expiries:(m.allExpiryPairs||[]).map((p:any)=>p.expiry),walls:category==='POSITIONING'?{call:m.callWall,put:m.putWall}:null};
}

export function renderMarketAgreement(view:any,controls:any={}) {
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const select=(key:string,label:string,values:any[],chosen:any)=>'<label>'+esc(label)+'<select data-agreement-control="'+key+'">'+values.map(v=>{const [id,text]=Array.isArray(v)?v:[v,v];return '<option value="'+esc(id)+'"'+(String(id)===String(chosen)?' selected':'')+'>'+esc(text)+'</option>';}).join('')+'</select></label>';
 const labels:any={SAME:'Same direction',OPPOSITE:'Opposite direction',FLAT:'Flat',UNSYNCED:'Time mismatch',MISSING:'Data incomplete'};
 const pct=(v:any)=>typeof v==='number'&&Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'—';
 const sel=view.selection,part=view.category==='PARTICIPATION';
 let html='<section class="mb-agreement" aria-label="Market agreement comparisons">';
 if(!controls.fixed)html+='<div class="mb-agreement-tabs" role="group" aria-label="Comparison category">'+view.categories.map(([id,label]:string[])=>'<button type="button" data-agreement-category="'+id+'" aria-pressed="'+(view.category===id)+'">'+esc(label)+'</button>').join('')+'</div>';
 html+='<div class="mb-controls">'+select('symbol','Index',['NIFTY','SENSEX','BANKNIFTY'],view.symbol);
 html+=part?select('participationWindow','Response',[['DAY','Day'],['3','3 min'],['6','6 min'],['15','15 min'],['30','30 min']],controls.participationWindow||'DAY'):select('window','Response',['3m','6m','15m','30m'].includes(controls.window)?['3m','6m','15m','30m']:[controls.window,'3m','6m','15m','30m'],controls.window);
 if(part)html+=select('stock','Stock',sel.availableStocks.length?sel.availableStocks:['No synchronized stocks'],sel.stock)+select('sector','Compare sector proxy',sel.availableSectors.length?sel.availableSectors:['No synchronized sectors'],sel.sector)+'<button type="button" data-agreement-load>Load saved quotes</button>';
 if(view.category==='PREMIUM')html+=select('expiry','Reference expiry',view.expiries.length?view.expiries:['Unavailable'],controls.expiry)+select('side','Side',['CE','PE'],controls.side||'CE')+select('strike','Strike',controls.strikes?.length?controls.strikes:['Unavailable'],controls.strike);
 html+='</div><p class="mb-agreement-status" role="status">RECORDED · '+view.usable+'/'+view.total+' comparable pairs · '+esc(controls.date)+' · '+esc(controls.asOf||'Observation time missing')+(controls.loading?' · Loading quotes…':controls.error?' · Saved quotes unavailable':'')+(controls.truncated?' · History limited to latest 256 snapshots':'')+'</p>';
 if(part&&sel.lastVerified){const a=sel.lastVerified,rows=[...a.stocks,...a.sectors];const clock=(v:string)=>new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)?v.replace(' ','T')+'+05:30':v).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',hour12:false});
  html+='<section aria-label="Last verified stock and sector snapshot"><h3>Last verified · '+esc(clock(a.receipt))+' IST</h3><p>'+a.stocks.length+' tracked stocks · '+a.sectors.length+' sector proxies · separate saved snapshot; unavailable for the selected endpoint comparison.</p><details class="mb-event"><summary>Read last verified prices</summary><table><thead><tr><th>Type</th><th>Name</th><th>Price</th><th>Day %</th><th>Quote time · IST</th></tr></thead><tbody>'+rows.map((r:any)=>'<tr><td>'+esc(r.kind)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.price)+'</td><td>'+pct(r.change)+'</td><td>'+esc(clock(r.sourceAt))+'</td></tr>').join('')+'</tbody></table></details></section>';
 }
 html+='<details class="mb-event" data-event-key="agreement-filter"><summary>Filter results</summary>'+select('result','Result',[['ALL','All'],...Object.entries(labels)],view.result)+'</details>';
 html+='<div class="mb-agreement-results">'+view.rows.map((r:any)=>'<article class="mb-agreement-row"><div><strong>'+esc(r.label)+'</strong><span>'+esc(labels[r.status])+(r.context?' · context':'')+'</span></div><b>'+pct(r.left)+' ↔ '+pct(r.right)+'</b><details class="mb-event" data-event-key="agreement-'+esc(r.label)+'"><summary>Evidence</summary><p>'+esc(r.reason)+'</p><p>Left: '+esc(r.fromAt||'Previous close')+' → '+esc(r.at)+'<br>Right: '+esc(r.rightFromAt||'Previous close')+' → '+esc(r.rightAt)+'</p></details></article>').join('')+(view.rows.length?'':'<p>No pairs match this filter.</p>')+'</div>';
 if(view.walls)html+='<details class="mb-event" data-event-key="agreement-walls"><summary>Recorded wall context</summary>'+['call','put'].map(k=>{const w=view.walls[k];return '<p>'+esc(k)+' wall '+esc(w?.strike)+' · strike Δ '+esc(w?.delta)+' · '+esc(w?.fromAt)+' → '+esc(w?.at)+'</p>';}).join('')+'</details>';
 html+='<details class="mb-event" data-event-key="agreement-limits"><summary>Coverage &amp; meaning</summary><p>Observed co-movement only; no trade score or causal claim. PCR, OI, VIX and DTE remain context. Future expiry continuity is unverified.</p><p>Stocks are a tracked subset, not a weighted index. NIFTY and SENSEX lists share four stocks. Selected sector proxies do not establish stock membership; broader-market proxies remain distinct. Day changes use separate previous closes. Saved quote reads do not require a fresh broker login.</p><p>Quotes use their own source times; recording time is not freshness. Intraday quote comparisons allow at most 30s endpoint tolerance. Old sector rows without prices cannot provide intraday returns. Quote receipt '+esc(sel.receipt)+'; baseline '+esc(sel.baselineReceipt)+'.</p></details></section>';
 return html;
}
