/** Institutional layout from the supplied 26 November HTML. Source adapters use existing read-only data, never the embedded offline archive. */
export function installInstitutionalReference(api:any,deps:any){
 const $=(id:string)=>document.getElementById(id) as any,shell=$('rd-shell'),old=$('rd-fit-tools'),root=$('op-one-stop');
 if(!shell||!old||!root||!api?.getState||!document.createElement)return null;
 const node=document.createElement('div');node.id='ip-reference';
 const style=document.createElement('style');
 style.textContent='#rd-shell[data-ip-active=true]>#rd-viewport,#rd-shell[data-ip-active=true]>#rd-fit-tools,#rd-shell[data-ip-active=true]>#rd-bnf-shadow{display:none!important}#rd-shell:not([data-ip-active=true])>#ip-reference{display:none!important}#ip-reference{--ink:#10262e;--muted:#526673;--teal:#16444a;--line:#d6e1e5;--green:#08783c;--red:#c3293e;--bg:#f4f7fa;flex:1;min-height:0;overflow:auto;background:var(--bg);font:14px/1.4 system-ui,Segoe UI,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums}#ip-reference *{box-sizing:border-box}#ip-reference .ip-main{max-width:1800px;margin:auto;padding:12px}#ip-reference .ip-header{background:linear-gradient(100deg,#153f45,#28616a);color:white;padding:12px 16px;border-radius:9px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}#ip-reference h1{font-size:22px;margin:0;color:white}#ip-reference h2{margin:0;background:var(--teal);color:white;font-size:15px;padding:9px 12px;border-radius:8px 8px 0 0}#ip-reference .ip-toolbar,#ip-reference .ip-kpis,#ip-reference .ip-row,#ip-reference .ip-lower{display:grid;gap:9px;margin:10px 0}#ip-reference .ip-toolbar{grid-template-columns:1.4fr 1fr 1fr;align-items:stretch}#ip-reference .ip-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}#ip-reference .ip-row{grid-template-columns:minmax(0,1fr) minmax(0,2.2fr) minmax(0,1.05fr)}#ip-reference .ip-lower{grid-template-columns:1fr 1.2fr 1.1fr 1.1fr}#ip-reference .ip-panel,#ip-reference .ip-tile,#ip-reference .ip-controls{background:white;border:1px solid var(--line);border-radius:9px;box-shadow:0 2px 5px #10262e08;min-width:0}#ip-reference .ip-tile{padding:11px;border-left:4px solid #237781}#ip-reference .ip-big{font-size:24px;font-weight:750;letter-spacing:-.5px}#ip-reference .ip-muted{color:var(--muted);font-size:12px}#ip-reference .ip-content{padding:10px}#ip-reference .ip-positive{color:var(--green)}#ip-reference .ip-negative{color:var(--red)}#ip-reference .ip-neutral{color:var(--muted)}#market-book #ip-reference button,#market-book #ip-reference select{font:inherit;min-height:0;min-width:0;padding:7px 10px;border:1px solid #c5d4da;border-radius:6px;background:white;color:var(--ink);cursor:pointer;box-shadow:none}#market-book #ip-reference button[aria-pressed=true],#market-book #ip-reference .ip-primary{background:var(--teal);color:white;border-color:var(--teal)}#market-book #ip-reference .ip-line select{width:auto;max-width:100%;font-size:14px;min-height:0}#market-book #ip-reference .ip-line label[hidden]{display:none}#ip-reference .ip-line label{display:inline-flex;flex:0 1 auto;align-items:center;gap:5px;margin:0;color:#526673;font-size:12px;min-width:0}#market-book #ip-reference .ip-header small{color:#d6e1e5;font-size:12px}#market-book #ip-reference #ip-band{width:auto;max-width:100%}#ip-reference button:disabled{opacity:.5}#ip-reference input[type=range]{width:100%;accent-color:#1c6b72}#ip-reference .ip-controls{padding:9px}#ip-reference .ip-stat{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #e7edef}#ip-reference .ip-stat:last-child{border-bottom:0}#ip-reference .ip-stat strong{text-align:right}#market-book #ip-reference table{display:table;width:100%;border-collapse:collapse;font-size:12.5px;min-width:0;table-layout:auto;color:var(--ink)}#market-book #ip-reference thead{display:table-header-group;position:static;width:auto;height:auto;clip-path:none}#market-book #ip-reference tbody{display:table-row-group}#market-book #ip-reference tr{display:table-row;border:0}#market-book #ip-reference td,#market-book #ip-reference th{display:table-cell;border:0;border-bottom:1px solid #e5ebef;padding:7px 5px;text-align:right;white-space:nowrap;background:white;color:var(--ink);font-size:12.5px}#market-book #ip-reference th{color:#435c65;background:#f3f7f8;font-size:11px}#market-book #ip-reference td:first-child,#market-book #ip-reference th:first-child{text-align:left}#market-book #ip-reference td:before{display:none!important}#ip-reference .ip-scroll{overflow:auto}#ip-reference .ip-oi{display:inline-block;height:6px;border-radius:4px;max-width:100%}#ip-reference .ip-ce{background:#dc5263}#ip-reference .ip-pe{background:#179260}#ip-reference .ip-notice{border-left:3px solid #258681;padding:7px 9px;background:#f2f8f8;margin:6px 0;font-size:12px}#ip-reference .ip-line{display:flex;gap:5px;align-items:center;flex-wrap:wrap}#ip-reference .ip-chart{display:block;width:100%;height:100px}#ip-reference .ip-foot{padding:10px;color:#415865;font-size:12px}@media(max-width:1150px){#ip-reference .ip-row{grid-template-columns:1fr 2fr}#ip-reference .ip-row>.ip-panel:last-child{grid-column:1/-1}#ip-reference .ip-lower{grid-template-columns:1fr 1fr}#ip-reference .ip-kpis{grid-template-columns:repeat(3,1fr)}#ip-reference .ip-toolbar{grid-template-columns:1fr 1fr}}@media(max-width:650px){#ip-reference .ip-main{padding:7px}#ip-reference .ip-row,#ip-reference .ip-lower,#ip-reference .ip-toolbar{grid-template-columns:minmax(0,1fr)}#ip-reference .ip-kpis{grid-template-columns:1fr 1fr}#ip-reference .ip-big{font-size:20px}#ip-reference .ip-row>.ip-panel:last-child{grid-column:auto}}';
 node.appendChild(style);
 const main=document.createElement('div');main.className='ip-main';
 main.innerHTML='<div class="ip-header"><div><h1>▥ OptionPilot Pro — Institutional Analytics</h1><small>Indian indices · OI · PCR · Greeks · Quant research</small></div><strong id="ip-status" role="status">Loading observations</strong></div><div class="ip-toolbar"><div class="ip-controls"><div class="ip-line"><button id="ip-live">Live</button><button id="ip-saved">Saved</button><label>Session <select id="ip-date" aria-label="Recorded session"></select></label></div><small id="ip-date-note" class="ip-muted"></small></div><div class="ip-controls"><div class="ip-line"><b id="ip-clock">— IST</b><span id="ip-count"></span><button id="ip-play" class="ip-primary">▶ Play</button><button id="ip-prev" aria-label="Previous replay step">◀</button><button id="ip-next" aria-label="Next replay step">▶</button></div><input type="range" id="ip-seek" aria-label="Shared replay cursor" min="0" max="0" value="0"><small class="ip-muted">Exact recorded steps · gaps stay unavailable</small></div><div class="ip-controls"><div class="ip-line" id="ip-tabs"><button data-ip-symbol="NIFTY">NIFTY</button><button data-ip-symbol="SENSEX">SENSEX</button><button data-ip-symbol="BANKNIFTY">BANKNIFTY</button></div><div class="ip-line"><span id="ip-expiry"></span><label id="ip-recorded-expiry" hidden>Expiry <select id="ip-expiry-select" aria-label="Recorded expiry"></select></label><label>Speed <select id="ip-speed"><option value="1">1s / step</option><option value="5">Fast</option><option value="10">Faster</option></select></label><button id="ip-details">Detailed tools</button><button id="ip-copy-html" type="button">Copy dashboard HTML</button><button id="ip-download-html" type="button">Download HTML</button><small id="ip-copy-status" role="status"></small><button id="ip-watch">Watch / Replay</button></div></div></div><div class="ip-kpis" id="ip-kpis"></div><div class="ip-row"><section class="ip-panel"><h2>Market pulse · exact levels</h2><div class="ip-content" id="ip-pulse"></div></section><section class="ip-panel"><h2 id="ip-ladder-title">CE vs PE same-rank OI ladder</h2><div class="ip-content"><div class="ip-line"><button id="ip-rank" aria-pressed="true">Same rank</button><button id="ip-strike" aria-pressed="false">Same strike</button><select id="ip-band" aria-label="Strike band"><option value="2">ATM ±2</option><option value="5">ATM ±5</option><option value="7">ATM ±7</option></select><span class="ip-muted">OI lakh units · ΔOI vs 3m prior</span></div><div class="ip-scroll" id="ip-ladder"></div><div class="ip-muted">Rank compares independently sorted CE and PE strikes; same-strike pairs exact strikes. Missing or unqualified legs excluded.</div></div></section><section class="ip-panel"><h2>Notable now · 15m memory</h2><div class="ip-content" id="ip-signals"></div></section></div><div class="ip-lower"><section class="ip-panel"><h2>Intraday spot path</h2><div class="ip-content" id="ip-spot-path"></div></section><section class="ip-panel"><h2>PCR history · selected expiry</h2><div class="ip-content" id="ip-pcr-path"></div></section><section class="ip-panel"><h2>Sector / heavyweight alignment</h2><div class="ip-content" id="ip-participation"></div></section><section class="ip-panel"><h2>Replay quality · freshness</h2><div class="ip-content" id="ip-quality"></div></section></div><div class="ip-row" style="grid-template-columns:2fr 1fr"><section class="ip-panel"><h2>Option science · ATM ±2 · recorded sensitivities</h2><div class="ip-content ip-scroll" id="ip-greeks"></div><div class="ip-foot">Recorded Greeks only. Unverified third-order sensitivities remain unavailable. Dealer hedge sign unknown.</div></section><section class="ip-panel"><h2>Historical Quant-RAG · research only</h2><div class="ip-content" id="ip-rag"><div class="ip-notice">Historical calibration is not a current-regime match or option win rate.</div><button id="ip-rag-open">Open existing research evidence</button></div></section></div><details class="ip-panel"><summary class="ip-content">Archive audit · full-session completeness and provenance</summary><div class="ip-content ip-scroll" id="ip-audit"></div></details><div class="ip-foot">READ-ONLY · Source-specific timestamps · Missing ≠ zero · No trade signal · <button id="ip-all-tools">All original research tools</button></div>';
 node.appendChild(main);shell.appendChild(node);
 const copyDialog=document.createElement('dialog');
 copyDialog.id='ip-copy-dialog';
 copyDialog.innerHTML='<form method="dialog"><button type="submit">Close</button></form><p>Copy the selected HTML or attach the downloaded file.</p><button id="ip-download-source" type="button">Download HTML instead</button><textarea id="ip-copy-source" aria-label="Dashboard HTML" rows="10" readonly style="width:min(70vw,640px)"></textarea>';
 node.appendChild(copyDialog);
 const back=document.createElement('button');back.id='rd-institutional';back.type='button';back.textContent='Institutional view';old.appendChild(back);
 let expiryScope='',selectedExpiry='';
 let symbol='NIFTY',rankMode=true,frame:any=null,live:any=null,replaying=false,datesKey='',active=true,sourceChoice='AUTO';
 const liveHistory=new Map<string,any[]>();
 const S=['NIFTY','SENSEX','BANKNIFTY'],n=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const fmt=(v:any,d=2)=>n(v)===null?'—':Number(v).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
 const diff=(a:any,b:any)=>n(a)===null||n(b)===null?null:Number(a)-Number(b);
 const val=(v:any,d=2)=>'<span class="ip-'+(n(v)===null?'neutral':Number(v)>0?'positive':Number(v)<0?'negative':'neutral')+'">'+(n(v)!==null&&Number(v)>0?'+':'')+fmt(v,d)+'</span>';
 const stat=(k:string,v:string)=>'<div class="ip-stat"><span>'+esc(k)+'</span><strong>'+v+'</strong></div>';
 const put=(id:string,v:string)=>{const e=$(id);if(e&&e.innerHTML!==v)e.innerHTML=v;};
 const stamp=(v:any)=>typeof v==='string'?Date.parse(v):NaN,iso=(v:number)=>Number.isFinite(v)?new Date(v).toISOString():'';
 const time=(v:any)=>Number.isFinite(stamp(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false}):'—';
 const day=(v:any)=>Number.isFinite(stamp(v))?new Date(stamp(v)+19800000).toISOString().slice(0,10):'';
 const exact=(arr:any[],at:number,s:string,date:string,expiry?:string)=>{const matches=(arr||[]).filter(r=>r.symbol===s&&r.truth_verdict==='TRUE'&&stamp(r.minute_bucket)===at&&day(r.minute_bucket)===date&&(!expiry||String(r.expiry).slice(0,10)===expiry));return matches.length===1?matches[0]:null;};
 const known=(r:any,cut:number)=>stamp(r?.created_at)>=stamp(r?.minute_bucket)&&stamp(r?.created_at)<=cut&&stamp(r?.truth_marker_created_at)>=stamp(r?.minute_bucket)&&stamp(r?.truth_marker_created_at)<=cut;
 const bandRows=(rows:any[],atm:any,band:number)=>{const ids=rows.map(r=>r.strike),index=ids.indexOf(atm);return index<0?[]:rows.slice(Math.max(0,index-band),index+band+1);};
 const ratio=(rows:any[],band:number)=>{if(rows.length!==2*band+1||rows.some(r=>n(r.CE?.oi)===null||n(r.PE?.oi)===null))return null;const ce=rows.reduce((a,r)=>a+Number(r.CE.oi),0),pe=rows.reduce((a,r)=>a+Number(r.PE.oi),0);return ce>0?pe/ce:null;};
 const chart=(rows:any[],key:string,colour:string)=>{const points=rows.filter(r=>n(r[key])!==null).map(r=>({t:stamp(r.minute_bucket),v:Number(r[key])})).filter(r=>Number.isFinite(r.t)).sort((a,b)=>a.t-b.t);if(!points.length)return '<div class="ip-muted">Unavailable at source clock</div>';const lo=Math.min(...points.map(r=>r.v)),hi=Math.max(...points.map(r=>r.v)),start=points[0].t,end=points.at(-1)!.t;let path='',prev=0;for(const p of points){const x=30+255*(p.t-start)/Math.max(60000,end-start),y=75-62*(p.v-lo)/Math.max(.00001,hi-lo);path+=(prev&&p.t-prev<=180000?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' ';prev=p.t;}return '<svg class="ip-chart" viewBox="0 0 300 100" role="img" aria-label="Source history"><path d="M30 8V78H290" stroke="#aabdc4" fill="none"/><path d="'+path+'" stroke="'+colour+'" fill="none" stroke-width="2"/><text x="0" y="10" font-size="9">'+fmt(hi,1)+'</text><text x="0" y="77" font-size="9">'+fmt(lo,1)+'</text><text x="30" y="94" font-size="9">'+time(iso(start))+'</text><text x="235" y="94" font-size="9">'+time(iso(end))+'</text></svg>';};
 function render(){
  if(!active)return;const state=api.getState()||{},recorded=sourceChoice==='RECORDED'||sourceChoice==='AUTO'&&(state.recordedOnly===true||root.dataset.osSource==='RECORDED');
  const date=state.date||'',all=Array.isArray(state.recordedDates)?state.recordedDates.filter((d:any)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)):[],key=all.join('|');
  if(key!==datesKey){datesKey=key;put('ip-date','<option value="">Select session</option>'+all.slice().reverse().map((d:string)=>'<option>'+esc(d)+'</option>').join(''));}
  if(date)$('ip-date').value=date;
  $('ip-date').disabled=!!state.archiveLoading; $('ip-live').setAttribute('aria-pressed',String(!recorded));$('ip-saved').setAttribute('aria-pressed',String(recorded));
  for(const b of node.querySelectorAll('[data-ip-symbol]'))b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.ipSymbol===symbol));
  const timeline=frame?.date===date&&Array.isArray(frame.timeline)?frame.timeline:[],cut=replaying&&frame?.date===date?stamp(frame.at):NaN;
  // The archive publishes exact newest-first windows while loading the rest of the session.
  const available=recorded&&(!replaying||!state.archiveLoading&&Number.isFinite(cut));
  const sessions:any={};for(const s of S){const q=available?state.current?.[s]||{}:{};sessions[s]={symbol:s,date,market:(q.market||[]).filter((r:any)=>r.symbol===s&&r.truth_verdict==='TRUE'&&day(r.minute_bucket)===date&&(!replaying||known(r,cut))),options:(s===symbol?q.options||[]:[]).filter((r:any)=>r.symbol===s&&r.truth_verdict==='TRUE'&&day(r.minute_bucket)===date&&(!replaying||known(r,cut))),chain:(q.chain||[]).filter((r:any)=>r.symbol===s&&r.truth_verdict==='TRUE'&&day(r.minute_bucket)===date&&(!replaying||known(r,cut)))};}
  const latest=available?Math.max(-Infinity,...sessions[symbol].market.map((r:any)=>stamp(r.minute_bucket)).filter(Number.isFinite)):NaN;
  // Historical replay displays exactly the previous completed recorder bucket, never a later or carried observation.
  const steps=timeline.map(stamp).filter(Number.isFinite).sort((a:number,b:number)=>a-b),spacing=steps.slice(1).map((v:number,i:number)=>v-steps[i]);
  const cadence=spacing.includes(60000)?60000:spacing.includes(180000)?180000:null;
  const at=available?(replaying&&cadence!==null?cut-cadence:replaying?NaN:latest):NaN;
  const markets:any={};for(const s of S)markets[s]=available?exact(sessions[s].market,at,s,date):null;
  const m=markets[symbol],session=sessions[symbol];
  const scope=date+'|'+symbol;
  if(scope!==expiryScope){expiryScope=scope;selectedExpiry='';}
  const expiryDate=(row:any)=>typeof row.expiry==='string'?row.expiry.slice(0,10):'';
  const eligibleExpiry=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>=date;
  const knownExpiries=[...new Set<string>(session.chain.filter((r:any)=>stamp(r.minute_bucket)<=at).map(expiryDate))]
   .filter(eligibleExpiry).sort();
  const cursorExpiries=new Set<string>(session.chain.filter((r:any)=>stamp(r.minute_bucket)===at)
   .map(expiryDate).filter(eligibleExpiry));
  const nearestAtCursor=knownExpiries.find(value=>cursorExpiries.has(value))||'';
  const expiry=recorded?(selectedExpiry||nearestAtCursor):'';
  const expirySelect=$('ip-expiry-select');
  $('ip-recorded-expiry').hidden=!recorded;
  $('ip-expiry').hidden=recorded;
  expirySelect.disabled=!available||(!knownExpiries.length&&!selectedExpiry);
  const expiryChoices=selectedExpiry&&!knownExpiries.includes(selectedExpiry)?[...knownExpiries,selectedExpiry].sort():knownExpiries;
  const expiryOptions=expiryChoices.map(value=>'<option value="'+esc(value)+'">'+esc(value)+
   (cursorExpiries.has(value)?'':' · no row at cursor')+'</option>');
  put('ip-expiry-select','<option value="">Nearest'+(nearestAtCursor?' · '+esc(nearestAtCursor):'')+'</option>'+expiryOptions.join(''));
  if(expirySelect.value!==selectedExpiry)expirySelect.value=selectedExpiry;
  const candidate=expiry?exact(session.chain,at,symbol,date,expiry):null,priorMarket=expiry?exact(session.market,at-180000,symbol,date):null,priorCandidate=expiry?exact(session.chain,at-180000,symbol,date,expiry):null;
  const chain=candidate&&m&&candidate.snapshot_id===m.snapshot_id?candidate:null,prior=priorCandidate&&priorMarket&&priorCandidate.snapshot_id===priorMarket.snapshot_id?priorCandidate:null;
  let model:any={rows:[]},atm=n(chain?.atm_strike),liveIndex:any=null,liveFrame:any=null;
  const verifiedLive=!recorded&&deps.validEnvelope?.(live);
  if(available&&expiry&&m){model=deps.deriveRank(deps.recordedRank(session,iso(at),expiry),deps.recordedRank(session,iso(at-180000),expiry),{mode:'RECORDED',minutes:3});}
  if(verifiedLive){
   liveIndex=live.snapshot.indices.find((a:any)=>a.symbol===symbol);liveFrame=deps.liveRank(live,symbol);
   const history=liveHistory.get(symbol)||[],old=liveFrame?history.find(f=>f.runtime===liveFrame.runtime&&f.expiry===liveFrame.expiry&&Math.abs(liveFrame.cycle-f.cycle-180000)<=1000):null;
   if(liveFrame)model=deps.deriveRank(liveFrame,old,{mode:'LIVE',minutes:3});atm=n(liveIndex?.strike);
   for(const s of S){const q=live.snapshot.indices.find((a:any)=>a.symbol===s),spot=deps.validQuote(live,q?.spot,'SPOT',s)?q.spot:null,fut=deps.validQuote(live,q?.future,'FUTURE',s)?q.future:null;markets[s]={spot_ltp:spot?.price,spot_prev_close:spot?.pdc,spot_high:spot?.high,spot_low:spot?.low,future_ltp:fut?.price,future_oi:fut?.oi};}
  }
  const qualifiedBand=(band:number)=>{if(!recorded)return bandRows(model.rows||[],atm,band);if(!chain||!m)return [];const offsets=new Map<number,Set<number>>();for(const r of session.options){if(stamp(r.minute_bucket)!==at||String(r.expiry).slice(0,10)!==expiry||r.snapshot_id!==m.snapshot_id)continue;const o=n(r.atm_offset),k=n(r.strike);if(o===null||k===null||!Number.isInteger(o)||Math.abs(o)>band)continue;if(!offsets.has(o))offsets.set(o,new Set());offsets.get(o)!.add(k);}const rows=[];for(let o=-band;o<=band;o++){const ks=offsets.get(o);if(ks?.size!==1)continue;const strike=[...ks][0],row=(model.rows||[]).find((v:any)=>v.strike===strike);if(row)rows.push(row);}return rows;};
  const mm=markets[symbol],vix=recorded?n(mm?.india_vix):verifiedLive&&deps.validQuote(live,live.snapshot.vix,'VIX')?n(live.snapshot.vix.price):null;
  const vixChange=recorded?n(mm?.india_vix_change):verifiedLive?diff(vix,live.snapshot.vix?.pdc):null,full=recorded?n(chain?.full_chain_oi_pcr):n(model.fullPcr),pcr5=ratio(qualifiedBand(5),5);
  const label=recorded?(state.archiveLoading?'RECORDED · LOADING HISTORY':replaying?'RECORDED REPLAY':'RECORDED · SAVED ENDPOINT'):verifiedLive?'LIVE · KITE':'LIVE · UNAVAILABLE';
  put('ip-status',esc(label));put('ip-clock',time(recorded?iso(at):live?.serverTime)+' IST');put('ip-count',recorded&&timeline.length?esc((replaying?Math.max(0,frame.index+1):timeline.length)+'/'+timeline.length):'');put('ip-expiry','Expiry '+esc(liveFrame?.expiry||'—'));
  const ready=recorded&&!state.archiveLoading&&timeline.length>1;for(const id of ['ip-play','ip-prev','ip-next','ip-seek'])$(id).disabled=!ready;
  $('ip-seek').max=String(Math.max(0,timeline.length-1));$('ip-seek').value=String(replaying?Math.max(0,frame?.index||0):Math.max(0,timeline.length-1));put('ip-play',replaying&&frame?.playing?'Ⅱ Pause':'▶ Play');
  put('ip-date-note',esc(state.archiveLoading?(state.health?.[symbol]?.message||'Waiting for first recorded window…'):all.length+' recorded sessions · '+(date||'No session selected')));
  const tile=(title:string,value:string,sub:string)=>'<div class="ip-tile"><div class="ip-muted">'+esc(title)+'</div><div class="ip-big">'+value+'</div><div class="ip-muted">'+sub+'</div></div>';
  put('ip-kpis',S.map(s=>{const q=markets[s],p=(n(q?.spot_prev_close)??0)>0&&n(q?.spot_ltp)!==null?(Number(q.spot_ltp)/Number(q.spot_prev_close)-1)*100:null;return tile(s,fmt(q?.spot_ltp),val(p)+(p===null?'':'%')+' vs PDC');}).join('')+tile(symbol+' · Full / ATM ±5 PCR',fmt(full,3)+' / '+fmt(pcr5,3),recorded?'Full reported · band qualified':'Fresh full source · band qualified')+tile('Recorded baseline',recorded?String(session.market.length):String(all.length),recorded?'Available market rows'+(replaying?' through cursor':' in session'):'Available recorded sessions'));
  const futuresVwap=recorded&&(n(mm?.future_vwap)??0)>0?n(mm.future_vwap):null;
  put('ip-pulse',stat('Spot',fmt(mm?.spot_ltp))+stat('Futures',fmt(mm?.future_ltp))+stat('Basis',val(diff(mm?.future_ltp,mm?.spot_ltp)))+stat('Futures VWAP',fmt(futuresVwap))+stat('Futures − VWAP',val(diff(mm?.future_ltp,futuresVwap)))+stat('PDH / PDL',fmt(mm?.pdh)+' / '+fmt(mm?.pdl))+stat('Intraday H / L',fmt(mm?.spot_high)+' / '+fmt(mm?.spot_low))+stat('PDC',fmt(mm?.spot_prev_close))+stat('India VIX',fmt(vix)+' ('+val(vixChange)+')')+stat('ATM IV (reported)',n(chain?.atm_iv)===null?'—':fmt(chain.atm_iv)+'%')+stat('Straddle (reported)',fmt(chain?.straddle_ltp))+stat('Futures OI',fmt(mm?.future_oi,0)));
  const band=Number($('ip-band').value)||2,rows=qualifiedBand(band),ce=rows.map(r=>r.CE).filter(Boolean).sort((a,b)=>b.oi-a.oi||a.strike-b.strike),pe=rows.map(r=>r.PE).filter(Boolean).sort((a,b)=>b.oi-a.oi||a.strike-b.strike),max=Math.max(1,...ce.concat(pe).map(r=>r.oi));
  const leg=(r:any,side:string)=>'<td>'+ (r?'<b>'+fmt(r.oi/100000)+'</b><br><span class="ip-oi ip-'+side+'" style="width:'+Math.round(80*r.oi/max)+'px"></span>':'—')+'</td><td>'+val(r&&n(r.delta)!==null?r.delta/100000:null)+'</td><td>'+fmt(r?.price)+'</td>';
  let body='';if(rankMode){for(let i=0;i<Math.max(ce.length,pe.length);i++){const a=ce[i],b=pe[i];body+='<tr><td>#'+(i+1)+'</td><td>'+fmt(a?.strike,0)+'</td>'+leg(a,'ce')+'<td>'+fmt(b?.strike,0)+'</td>'+leg(b,'pe')+'</tr>';}}else for(const r of rows)body+='<tr><td>'+fmt(r.strike,0)+(r.strike===atm?' ATM':'')+'</td>'+leg(r.CE,'ce')+leg(r.PE,'pe')+'</tr>';
  put('ip-ladder-title','CE vs PE '+(rankMode?'same-rank':'same-strike')+' OI ladder · '+symbol);
  put('ip-ladder',body?'<table><thead><tr>'+(rankMode?['Rank','CE strike','CE OI L','ΔOI L','CE LTP','PE strike','PE OI L','ΔOI L','PE LTP']:['Strike','CE OI L','ΔOI L','CE LTP','PE OI L','ΔOI L','PE LTP']).map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>':'<div class="ip-notice">No qualified exact contracts at this source clock.</div>');
  const call=recorded?n(chain?.call_wall_strike):n(liveFrame?.callWall?.strike),putWall=recorded?n(chain?.put_wall_strike):n(liveFrame?.putWall?.strike);
  put('ip-signals',stat('Full PCR Δ (3m)',val(model.fullPcrDelta,3))+stat('Call wall',fmt(call,0))+stat('Put wall',fmt(putWall,0))+stat('Call wall Δ',val(diff(call,prior?.call_wall_strike),0))+stat('Put wall Δ',val(diff(putWall,prior?.put_wall_strike),0))+stat('Dealer gamma sign','UNKNOWN')+'<div class="ip-notice">Exact event-time memory via Watch / Replay. No inferred dealer positioning.</div>');
  const history=available?session.market.filter((r:any)=>stamp(r.minute_bucket)<=at):[];
  put('ip-spot-path',S.map(s=>'<div class="ip-stat"><b>'+s+'</b><b>'+fmt(markets[s]?.spot_ltp)+'</b></div>'+chart(available?sessions[s].market.filter((r:any)=>stamp(r.minute_bucket)<=at):[],'spot_ltp','#17815e')).join(''));
  put('ip-pcr-path',chart(available?session.chain.filter((r:any)=>String(r.expiry).slice(0,10)===expiry&&stamp(r.minute_bucket)<=at):[],'full_chain_oi_pcr','#15834e')+[2,5,7].map(b=>stat('ATM ±'+b+' PCR',fmt(ratio(qualifiedBand(b),b),3))).join('')+stat('Volume PCR (reported)',fmt(chain?.volume_pcr,3)));
  const labels=symbol==='BANKNIFTY'?['NIFTY PSU BANK','HDFCBANK','ICICIBANK','AXISBANK','KOTAKBANK']:['HDFCBANK','RELIANCE','NIFTY IT','NIFTY SMLCAP 100','NIFTY MIDCAP 100'];
  const participation=verifiedLive?(live.snapshot.participation||[]):[];
  put('ip-participation',labels.map(k=>{const q=participation.find((v:any)=>String(v.identity?.label||'').toUpperCase()===k);return stat(k,q&&deps.validQuote(live,q,q.identity.role)?val(q.changePct):'—');}).join('')+'<small class="ip-muted">Historical participation requires exact saved source.</small>');
  const exactLegs=available&&m&&expiry?session.options.filter((r:any)=>stamp(r.minute_bucket)===at&&String(r.expiry).slice(0,10)===expiry&&r.snapshot_id===m.snapshot_id&&['CE','PE'].includes(r.option_type)&&n(r.atm_offset)!==null&&Math.abs(Number(r.atm_offset))<=7):[];
  const unique=exactLegs.filter((r:any)=>exactLegs.filter((v:any)=>v.strike===r.strike&&v.option_type===r.option_type).length===1);
  const qualifiedAge=(r:any,seconds:number)=>{const q=stamp(r.quote_timestamp),receipt=stamp(m?.backend_timestamp),age=(receipt-q)/1000;return r.validation_status==='RESEARCH_ELIGIBLE'&&day(r.quote_timestamp)===date&&Number.isFinite(age)&&age>=0&&age<=seconds;};
  const ages=[30,45,55,180].map(seconds=>{const count=unique.filter((r:any)=>qualifiedAge(r,seconds)).length;return '<div class="ip-stat"><span>Option legs ≤ '+seconds+'s</span><b>'+(available&&m?count+'/30':'—')+'</b></div><div style="height:8px;border-radius:4px;background:#e7ecef;overflow:hidden;margin:4px 0 9px"><div style="height:100%;background:#238b83;width:'+Math.min(100,count/30*100)+'%"></div></div>';}).join('');
  put('ip-quality',stat('Market endpoint',mm&&n(mm.spot_ltp)!==null?'Available':'Missing')+stat('Full PCR clock',recorded?'Reported':'Fresh only')+(recorded?ages:'')+stat('Qualified CE / PE',String(ce.length)+' / '+String(pe.length))+'<div class="ip-notice">Age measured at recorded backend receipt, not bucket close. No 100% freshness claim.</div>');
  const greekRows=unique.filter((r:any)=>Math.abs(Number(r.atm_offset))<=2&&qualifiedAge(r,30)).sort((a:any,b:any)=>Number(a.strike)-Number(b.strike)||String(a.option_type).localeCompare(String(b.option_type)));
  put('ip-greeks',greekRows.length?'<table><thead><tr>'+['Strike','Side','Premium','IV %','Delta','Gamma','Theta','Speed','Zomma / IV pt','Color / day'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+greekRows.map((r:any)=>'<tr><td>'+fmt(r.strike,0)+'</td><td>'+esc(r.option_type)+'</td><td>'+fmt(r.ltp)+'</td><td>'+fmt(r.iv)+'</td><td>'+fmt(r.delta,4)+'</td><td>'+fmt(r.gamma,6)+'</td><td>'+fmt(r.theta)+'</td><td>—</td><td>—</td><td>—</td></tr>').join('')+'</tbody></table>':'<div class="ip-notice">No qualified recorded Greek rows at this endpoint.</div>');
  put('ip-audit','<table><thead><tr><th>Index</th><th>Recorded market minutes'+(replaying?' through cursor':'')+'</th><th>Qualified market endpoint</th></tr></thead><tbody>'+S.map(s=>'<tr><td>'+s+'</td><td>'+new Set(sessions[s].market.filter((r:any)=>stamp(r.minute_bucket)<=at).map((r:any)=>stamp(r.minute_bucket))).size+'</td><td>'+ (markets[s]&&n(markets[s].spot_ltp)!==null?'Available':'Missing')+'</td></tr>').join('')+'</tbody></table><p class="ip-muted">Counts reflect loaded source scope only. Archive hash and full-session coverage not inferred.</p>');
 }
 const source=(v:string)=>{sourceChoice=v;const c=$('os-source');if(c){c.value=v;c.onchange?.({target:c});}};
 const stop=()=>{if(replaying){replaying=false;api.referenceReplay?.setEmbeddedActive(false);}};
 const show=(on:boolean)=>{active=on;shell.dataset.ipActive=String(on);if(!on)stop();else render();};
 const enter=()=>{if(!replaying){source('RECORDED');replaying=true;api.referenceReplay?.setEmbeddedActive(true);}};
 $('ip-live').onclick=()=>{stop();source('LIVE');render();};$('ip-saved').onclick=()=>{stop();source('RECORDED');render();};
 $('ip-date').onchange=async()=>{const d=$('ip-date').value;if(!d||!api.getState()?.recordedDates?.includes(d))return;stop();source('RECORDED');await api.setDate?.(d,{fullSession:true});render();};
 $('ip-tabs').onclick=(e:any)=>{const s=e.target.closest?.('[data-ip-symbol]')?.dataset.ipSymbol;if(S.includes(s)){symbol=s;render();}};
 $('ip-rank').onclick=()=>{rankMode=true;$('ip-rank').setAttribute('aria-pressed','true');$('ip-strike').setAttribute('aria-pressed','false');render();};
 $('ip-strike').onclick=()=>{rankMode=false;$('ip-rank').setAttribute('aria-pressed','false');$('ip-strike').setAttribute('aria-pressed','true');render();};$('ip-band').onchange=render;
 $('ip-expiry-select').onchange=()=>{selectedExpiry=$('ip-expiry-select').value;render();};
 $('ip-speed').onchange=()=>api.referenceReplay?.speed(Number($('ip-speed').value));$('ip-play').onclick=()=>{enter();api.referenceReplay?.playPause();};$('ip-prev').onclick=()=>{enter();api.referenceReplay?.step(-1);};$('ip-next').onclick=()=>{enter();api.referenceReplay?.step(1);};$('ip-seek').oninput=()=>{const i=Number($('ip-seek').value);enter();api.referenceReplay?.seek(i);};
 $('ip-rag-open').onclick=()=>{show(false);$('rd-settings')?.click();};$('ip-details').onclick=()=>show(false);$('ip-all-tools').onclick=()=>show(false);back.onclick=()=>show(true);$('ip-watch').onclick=()=>{show(false);$('rd-watch')?.click();};
 const dashboardHtml=()=>{
  const preview=main.cloneNode(true) as HTMLElement;
  preview.querySelector('#ip-copy-html')?.remove();
  preview.querySelector('#ip-download-html')?.remove();
  preview.querySelector('#ip-copy-status')?.remove();
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OptionPilot dashboard layout</title><style>'+
   'body{margin:0}'+style.textContent+'</style></head><body><main id="rd-shell" data-ip-active="true"><div id="ip-reference">'+preview.outerHTML+'</div></main></body></html>';
 };
 const downloadHtml=(html:string)=>{
  const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='OptionPilot_Dashboard_Layout.html';
  link.hidden=true;
  node.appendChild(link);
  try{link.click();}finally{
   link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
 };
 $('ip-download-html').onclick=()=>downloadHtml(dashboardHtml());
 $('ip-download-source').onclick=()=>downloadHtml($('ip-copy-source').value);
 $('ip-copy-html').onclick=async()=>{
  const html=dashboardHtml();
  try{
   await navigator.clipboard.writeText(html);
   $('ip-copy-status').textContent='Dashboard HTML copied.';
  }catch{
   const code=$('ip-copy-source');
   code.value=html;
   copyDialog.showModal();
   code.select();
  }
 };
 api.referenceReplay?.subscribe((v:any)=>{frame=v;render();});
 show(true);
 return {refresh:render,updateLive(d:any){live=d;if(deps.validEnvelope?.(d))for(const s of S){const f=deps.liveRank(d,s);if(!f)continue;const old=liveHistory.get(s)||[];if(!old.some(v=>v.cycle===f.cycle&&v.runtime===f.runtime&&v.expiry===f.expiry)){liveHistory.set(s,old.filter(v=>v.runtime===f.runtime&&v.expiry===f.expiry&&f.cycle-v.cycle<=240000).concat(f).slice(-8));}}render();}};
}
