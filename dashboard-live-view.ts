export const DASHBOARD_LIVE_HTML=`<section id="dashboard-live" class="panel op-live" aria-label="Live Kite market data"><div class="op-live-heading"><h2>LIVE · Kite market</h2><button id="op-live-toggle" type="button" aria-pressed="true">Live view ON</button></div><p id="op-live-status" role="status">Connecting to the live data service…</p><div id="op-live-body"><p data-op-explanation>Spot · premiums · OI · expiry-specific full PCR · walls · futures · VIX · heavyweight / sector quotes</p><div id="op-live-vix"></div><div id="op-live-indices" class="op-live-grid"></div><details><summary>Heavyweights & sectors · live quotes</summary><div id="op-live-participation"></div></details><p class="op-live-note" data-op-explanation>Live prices update from incoming Kite FULL packets. Live numbers follow incoming snapshots at up to 10 updates/second (100ms target, not guaranteed end-to-end latency). Charts redraw at up to 4 frames/second and retain actual received samples. All figures carry source times; stale values become unavailable. Full PCR / walls require every instrument in the subscribed expiry inventory. IV / Greeks are not supplied by these packets. Recorded research remains below; live ticks are not inserted into historical evidence.</p></div></section>`;
export const DASHBOARD_LIVE_CSS=`#dashboard-live{display:block}#op-live-body{width:100%;min-width:0}.op-live{font-size:18px;order:-5;border-top:3px solid #edc86c;background:#091528}.op-live-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}.op-live-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.op-live-card{min-width:0;padding:12px;border:1px solid #344b69;border-radius:10px;background:#0b1c33}.op-live-card h3{font-size:24px;margin:6px 0}.op-live-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.op-live-kpis>div{min-width:0}.op-live-kpis strong{display:block;font-size:26px;color:#66f1e2;font-variant-numeric:tabular-nums}.op-live-card select{width:100%;font-size:18px;min-height:48px;margin:6px 0}.op-live-card label{display:block;font-size:17px}.op-live-note,.op-live-card small{display:block;font-size:16px;color:#b7c9df;overflow-wrap:anywhere}.op-live-chart{display:block;width:100%;height:auto;background:#071121;margin:8px 0}.op-live-chart text{font-size:16px}.op-live-stale{color:#f3c577}.op-live-quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.op-live-quotes>div{padding:8px;border-bottom:1px solid #344b69}.op-live-quotes strong{display:block;font-size:21px}.op-live-layers{display:flex;flex-wrap:wrap;gap:6px}.op-live-layers button{font-size:16px;min-height:44px}.op-live-layers button[aria-pressed=true]{border-color:#edc86c;color:#edc86c}@media(max-width:1100px){.op-live-grid{grid-template-columns:1fr}.op-live-kpis strong{font-size:30px}}@media(max-width:480px){.op-live-kpis{grid-template-columns:1fr}}`;

/** Browser only: one stream, bounded chart buffers, no broker credentials. */
export function installDashboardLive(){
 const root=document.getElementById('dashboard-live');if(!root)return;
 const get=(id:string)=>document.getElementById(id)!;
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const numberFormats=new Map<number,Intl.NumberFormat>();
 const fmt=(v:any,d=2)=>{if(typeof v!=='number'||!Number.isFinite(v))return '—';if(!numberFormats.has(d))numberFormats.set(d,new Intl.NumberFormat('en-IN',{maximumFractionDigits:d}));return numberFormats.get(d)!.format(v);};
 const timeFormats=[new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}),new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3})];
 const time=(v:any,milliseconds=false)=>v&&Number.isFinite(Date.parse(v))?timeFormats[milliseconds?1:0].format(new Date(v)):'—';
 const cardShapes:any={},chartPaints:any={};
 const renderedHtml=new WeakMap<object,string>();
 const writeHtml=(node:any,html:string)=>{if(node&&renderedHtml.get(node)!==html){node.innerHTML=html;renderedHtml.set(node,html);}};
 const indices=['NIFTY','SENSEX','BANKNIFTY'];
 const selection:any={},buffers:any={},layers:any={},cadences:any={},sampled:any={},levelSettings:any={};let recorded:any=null;for(const symbol of indices){layers[symbol]={spot:true,pcr:true,ce:false,pe:false};cadences[symbol]=60000;levelSettings[symbol]={};}
 let source:any=null,on=true,lastReceived=0,latest:any=null,runtime:string|null=null,disposed=false;
 if(typeof window.addEventListener==='function')window.addEventListener('optionpilot:recorded-levels',((event:any)=>{recorded=event.detail;render();}) as EventListener);
 function references(a:any,kind:string){
  const row=recorded?.indices?.[a.symbol];if(!row||recorded.date!==latest?.snapshot?.tradeDate)return null;
  const ref=row[kind];if(!ref)return null;
  if((kind==='pcr'&&ref.expiry!==a.expiry)||(['ce','pe'].includes(kind)&&(ref.expiry!==a.expiry||ref.strike!==a.strike||ref.type!==kind.toUpperCase())))return null;
  return ref;
 }
 function pcrSample(a:any){
  const q=a.pcrSnapshot,at=Date.parse(q?.checkedAt||''),cycleAt=Date.parse(q?.cycleStartedAt||q?.checkedAt||''),now=Date.parse(latest?.serverTime||''),period=cadences[a.symbol];
  const valid=latest?.connected&&q?.state==='COMPLETE'&&q.coverage?.complete&&typeof q.fullPcr==='number'&&Number.isFinite(q.fullPcr)&&at<=now&&now-at<=90000&&Number.isFinite(cycleAt)&&cycleAt<=at&&at-cycleAt<=60000;
  if(!valid){delete sampled[a.symbol];const rows=buffers[a.symbol+'|pcr'];if(rows?.length&&rows.at(-1).value!==null){rows.push({value:null,at:latest.serverTime});if(rows.length>600)rows.shift();}return null;}
  let old=sampled[a.symbol];
  if(!old||old.expiry!==a.expiry||cycleAt-Date.parse(old.cycleStartedAt||old.checkedAt)>=period){old={...q,expiry:a.expiry,periodMs:period};sampled[a.symbol]=old;append(a.symbol,'pcr',old.fullPcr,old.checkedAt);}
  if(now-Date.parse(old.checkedAt)>period+30000){delete sampled[a.symbol];return null;}return old;
 }
 function close(){if(source){source.close();source=null;}}
 function connect(){
  close();if(!on||document.hidden||disposed)return;
  if(typeof EventSource==='undefined'){get('op-live-status').textContent='Live streaming is not supported by this browser.';return;}
  const q=new URLSearchParams();for(const symbol of indices){const s=selection[symbol];if(s?.expiry)q.set(symbol+'_expiry',s.expiry);if(s?.strike)q.set(symbol+'_strike',String(s.strike));for(const field of ['ceStrike','peStrike'])if(s?.[field])q.set(symbol+'_'+field,String(s[field]));}
  const active=new EventSource('/api/research/dashboard-live/stream?'+q.toString());source=active;
  get('op-live-status').textContent='Connecting · historical data below is recorded data';
  active.addEventListener('snapshot',(event:any)=>{
   if(source!==active||!on||disposed)return;
   try{const d=JSON.parse(event.data);if(!d||typeof d.connectionState!=='string')throw Error();
    if(d.snapshot){
     for(const a of d.snapshot.indices){const q=a.pcrSnapshot;if(q?.strikeRowsUnchanged){const prior=latest?.snapshot?.runtimeId===d.snapshot.runtimeId?latest.snapshot.indices.find((r:any)=>r.symbol===a.symbol&&r.expiry===a.expiry)?.pcrSnapshot:null;a.pcrSnapshot={...q,strikeRows:prior?.cycleStartedAt===q.cycleStartedAt&&prior?.checkedAt===q.checkedAt?prior.strikeRows||[]:[]};}}
     if(runtime&&runtime!==d.snapshot.runtimeId){for(const key of Object.keys(buffers))delete buffers[key];for(const key of Object.keys(sampled))delete sampled[key];}runtime=d.snapshot.runtimeId;}
    let pin=false;if(d.snapshot)for(const a of d.snapshot.indices){if(!selection[a.symbol]&&a.expiry&&a.strike){selection[a.symbol]={expiry:a.expiry,strike:a.strike};pin=true;}}
    if(pin){latest=null;render();connect();return;}
    latest=d;lastReceived=Date.now();render();
   }catch{get('op-live-status').textContent='Invalid live update · values withheld';latest=null;render();}
  });
  active.onerror=()=>{if(source!==active)return;latest=null;get('op-live-status').textContent='Disconnected · reconnecting automatically · live values withheld';render();};
 }
 function append(symbol:string,kind:string,value:any,at:any){
  if(typeof value!=='number'||!Number.isFinite(value)||!at||!Number.isFinite(Date.parse(at)))return;
  const key=symbol+'|'+kind,rows=buffers[key]||(buffers[key]=[]),last=rows.at(-1),point={value,at};
  if(last&&Date.parse(at)<Date.parse(last.at))return;
  if(last?.at===at)rows[rows.length-1]=point;else rows.push(point);
  if(rows.length>600)rows.splice(0,rows.length-600);
 }
 function chart(symbol:string,kind:string,title:string,digits:number,a:any){
  const ref=references(a,kind),cfg=levelSettings[symbol],levels:any[]=[];
  if(cfg[kind+'Opening']&&ref?.opening?.complete&&Date.parse(ref.opening.at)<=Date.parse(latest.serverTime))levels.push(['15m H',ref.opening.high,'#ffad66'],['15m L',ref.opening.low,'#ffad66']);
  if(cfg[kind+'Fib']&&ref?.pivot)for(const key of ['R3','R2','R1','P','S1','S2','S3'])if(typeof ref.pivot[key]==='number'&&Number.isFinite(ref.pivot[key])&&ref.pivot[key]>0)levels.push(['Fib '+key,ref.pivot[key],'#c2b2ff']);
  const safeLevels=levels.filter(l=>typeof l[1]==='number'&&Number.isFinite(l[1])&&l[1]>0);
  const points=buffers[symbol+'|'+kind]||[];if(!points.some((p:any)=>typeof p.value==='number'&&Number.isFinite(p.value)))return '<p class="op-live-note">'+esc(title)+' · waiting for fresh ticks</p>';
  const rows=points.slice(-600),start=Date.parse(rows[0].at),end=Date.parse(rows.at(-1).at),values=[...rows.filter((p:any)=>typeof p.value==='number'&&Number.isFinite(p.value)).map((p:any)=>p.value),...safeLevels.map(l=>l[1])],lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.1,kind==='pcr'?.0001:1),x=(at:string)=>60+(Date.parse(at)-start)/Math.max(end-start,1000)*340,y=(v:number)=>180-(v-lo+pad)/(hi-lo+2*pad)*145,color=kind==='pcr'?'#ff9f89':kind==='pe'?'#ff81cb':'#62eee0';
  let svg='<svg class="op-live-chart" viewBox="0 0 550 220" role="img" aria-label="'+esc(symbol+' '+title+' live chart')+'"><text x="60" y="19" fill="'+color+'">'+esc(title)+'</text>';
  for(let i=0;i<3;i++){const v=lo-pad+(hi-lo+2*pad)*i/2;svg+='<text x="54" y="'+(y(v)+4)+'" text-anchor="end" fill="#b7c9df">'+esc(fmt(v,digits))+'</text><line x1="60" x2="400" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#293e59"/>';}
  let previous:any=null;for(const p of rows){if(p.value===null){previous=null;continue;}if(previous&&Date.parse(p.at)-Date.parse(previous.at)<=(kind==='pcr'?cadences[symbol]+10000:5000))svg+='<line x1="'+x(previous.at)+'" x2="'+x(p.at)+'" y1="'+y(previous.value)+'" y2="'+y(p.value)+'" stroke="'+color+'" stroke-width="2"/>';svg+='<circle cx="'+x(p.at)+'" cy="'+y(p.value)+'" r="2" fill="'+color+'"><title>'+esc(time(p.at,true)+' · '+fmt(p.value,digits))+'</title></circle>';previous=p;}
  const labels=safeLevels.map(l=>({label:l[0],value:l[1],color:l[2],actual:y(l[1]),pos:y(l[1])})).sort((a,b)=>a.pos-b.pos);
  for(let i=1;i<labels.length;i++)labels[i].pos=Math.max(labels[i].pos,labels[i-1].pos+17);
  if(labels.at(-1)?.pos>185){labels.at(-1).pos=185;for(let i=labels.length-2;i>=0;i--)labels[i].pos=Math.min(labels[i].pos,labels[i+1].pos-17);}
  for(const l of labels)svg+='<line x1="60" x2="400" y1="'+l.actual+'" y2="'+l.actual+'" stroke="'+l.color+'" stroke-dasharray="3 5"/><path d="M400 '+l.actual+' L411 '+l.pos+'" fill="none" stroke="'+l.color+'"/><text x="414" y="'+(l.pos+4)+'" fill="'+l.color+'">'+esc(l.label+' '+fmt(l.value,digits))+'</text>';
  return svg+'<text x="60" y="210" fill="#b7c9df">'+esc(time(rows[0].at))+'</text><text x="400" y="210" text-anchor="end" fill="#b7c9df">'+esc(time(rows.at(-1).at))+'</text></svg>';
 }
 function render(){
  const d=latest,s=d?.snapshot;
  const publish=()=>{if(typeof CustomEvent!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('optionpilot:live-context',{detail:d?{...d,pcrDisplay:{...sampled}}:null}));};
  if(!d||!s){for(const id of ['op-live-indices','op-live-participation','op-live-vix'])renderedHtml.delete(get(id));for(const key of Object.keys(sampled))delete sampled[key];for(const key of Object.keys(cardShapes))delete cardShapes[key];publish();get('op-live-indices').innerHTML='<p class="op-live-stale">'+esc(d?'Feed '+d.connectionState+' · live values unavailable':'Waiting for a fresh live connection')+'</p>';get('op-live-participation').textContent='Live values unavailable';get('op-live-vix').textContent='India VIX: unavailable';if(d)get('op-live-status').textContent='Feed '+d.connectionState+' · live values unavailable';return;}
  get('op-live-status').textContent='Feed '+d.connectionState+' · server '+time(d.serverTime,true)+' IST · '+(s.omittedExpiries.length?s.omittedExpiries.length+' whole expiries outside subscription capacity · ':'')+'Live packet times below';
  const focused=document.activeElement as HTMLElement|null,editing=!!focused&&root!.contains(focused)&&focused.tagName==='SELECT';
  const quote=(label:string,q:any)=>'<div><span>'+esc(label)+'</span><strong>'+fmt(q.price)+'</strong><small>'+esc(q.state+' · '+time(q.observedAt)+' IST · received '+time(q.receivedAt,true))+'</small></div>';
  let mountedAll=true;const desiredShapes:any={};const cards=s.indices.map((a:any)=>{
   const pcr=pcrSample(a);append(a.symbol,'spot',a.spot.price,a.spot.receivedAt);append(a.symbol,'ce',a.ce.price,a.ce.receivedAt);append(a.symbol,'pe',a.pe.price,a.pe.receivedAt);
   const selected=selection[a.symbol]||{},expiry=selected.expiry||a.expiry,strike=selected.strike||a.strike;
   const select=(field:string,values:any[],value:any)=>'<label>'+field+'<select data-live-index="'+a.symbol+'" data-live-field="'+field.toLowerCase()+'">'+(!values.length?'<option value="">Unavailable</option>':values.map(v=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(v)+'</option>').join(''))+'</select></label>';
   const metric=(label:string,value:any,digits=2)=>'<div>'+esc(label)+'<strong>'+fmt(value,digits)+'</strong></div>';
   const valuesInner=quote('SPOT',a.spot)+quote('FUTURES · '+(a.future.identity?.expiry||'unavailable'),a.future)+quote('CE · '+(a.strike||'—'),a.ce)+quote('PE · '+(a.strike||'—'),a.pe)+'<div>FULL PCR · '+cadences[a.symbol]/60000+' min snapshot<strong>'+fmt(pcr?.fullPcr,4)+'</strong><small>'+esc(pcr?'Snapshot checked '+time(pcr.checkedAt)+' IST · source '+time(pcr.sourceMinAt)+' → '+time(pcr.sourceMaxAt):'Waiting for a complete Kite snapshot')+'</small><small>'+esc((pcr?.coverage?.freshOi??a.pcrSnapshot?.coverage?.freshOi??0)+'/'+(pcr?.coverage?.expected??a.pcrSnapshot?.coverage?.expected??a.coverage.expected)+' verified OI · '+(pcr?'VERIFIED SNAPSHOT':a.pcrSnapshot?.state||'WAITING'))+'</small></div>'+metric('Futures basis',a.futuresBasis)+metric('Futures OI',a.future.oi,0)+metric('Futures volume',a.future.volume,0)+metric('CE OI',a.ce.oi,0)+metric('PE OI',a.pe.oi,0)+metric('Snapshot CE wall strike',pcr?.callWall?.strike,0)+metric('Snapshot CE wall OI',pcr?.callWall?.oi,0)+metric('Snapshot PE wall strike',pcr?.putWall?.strike,0)+metric('Snapshot PE wall OI',pcr?.putWall?.oi,0)+metric('CE volume',a.ce.volume,0)+metric('PE volume',a.pe.volume,0)+metric('CE bid',a.ce.bid)+metric('CE ask',a.ce.ask)+metric('PE bid',a.pe.bid)+metric('PE ask',a.pe.ask);
   const valuesHtml='<div class="op-live-kpis" data-live-values="'+a.symbol+'">'+valuesInner+'</div>';
   const referenceNotes=['spot','pcr','ce','pe'].filter(key=>layers[a.symbol][key]&&(levelSettings[a.symbol][key+'Opening']||levelSettings[a.symbol][key+'Fib'])).map(key=>{const r=references(a,key),opening=r?.opening;return '<p class="op-live-note">'+esc(key.toUpperCase()+' references · '+(levelSettings[a.symbol][key+'Opening']?'15m '+(opening?.complete?'sampled '+time(opening.fromAt)+' → '+time(opening.at):'unavailable / incomplete')+' · ':'')+(levelSettings[a.symbol][key+'Fib']?'FIB '+(r?.pivot?'previous stored session '+r.pivot.at:'unavailable; load exact previous session'):'') )+'</p>';}).join('');
   const layerControls='<div class="op-live-layers">'+['spot','pcr','ce','pe'].map(key=>'<button type="button" data-live-layer="'+key+'" data-live-index="'+a.symbol+'" aria-pressed="'+layers[a.symbol][key]+'">'+key.toUpperCase()+' chart · '+(layers[a.symbol][key]?'ON':'OFF')+'</button>').join('')+'</div>';
   const referenceControls='<div class="op-live-layers" aria-label="'+a.symbol+' reference controls">'+['spot','pcr','ce','pe'].filter(key=>layers[a.symbol][key]).flatMap(key=>[['Opening','15m H / L'],...(key==='pcr'?[]:[['Fib','FIB P / R / S']])].map(([suffix,label])=>'<button type="button" data-live-reference="'+key+suffix+'" data-live-index="'+a.symbol+'" aria-pressed="'+!!levelSettings[a.symbol][key+suffix]+'">'+key.toUpperCase()+' '+label+' · '+(levelSettings[a.symbol][key+suffix]?'ON':'OFF')+'</button>')).join('')+'</div>';
   const chartKey=JSON.stringify([layers[a.symbol],levelSettings[a.symbol],['spot','pcr','ce','pe'].map(key=>references(a,key)),runtime]);
   let paint=chartPaints[a.symbol];
   if(!paint||paint.key!==chartKey||Date.now()-paint.at>=250){
    const html=['spot','pcr','ce','pe'].filter(key=>layers[a.symbol][key]).map(key=>chart(a.symbol,key,key==='pcr'?'Full PCR · '+cadences[a.symbol]/60000+' min snapshots':key.toUpperCase()+' · ₹ / points',key==='pcr'?4:2,a)).join('')+referenceNotes;paint=chartPaints[a.symbol]={key:chartKey,at:Date.now(),html};
   }
   const chartsHtml=paint.html;
   const shape=JSON.stringify([expiry,strike,a.expiries,a.strikes]);
   const mounted=root!.querySelector('[data-live-card="'+a.symbol+'"]');
   if(mounted&&(cardShapes[a.symbol]===shape||editing)){
    writeHtml(root!.querySelector('[data-live-values="'+a.symbol+'"]'),valuesInner);
    writeHtml(root!.querySelector('[data-live-charts="'+a.symbol+'"]'),chartsHtml);
    writeHtml(root!.querySelector('[data-live-controls="'+a.symbol+'"]'),layerControls+referenceControls);
   }
   if(!mounted||cardShapes[a.symbol]!==shape)mountedAll=false;
   desiredShapes[a.symbol]=shape;
   return '<article class="op-live-card" data-live-card="'+a.symbol+'"><h3>'+a.symbol+(a.symbol==='BANKNIFTY'?' · monthly observation':'')+'</h3>'+select('Expiry',a.expiries,expiry)+select('Strike',a.strikes,strike)+'<label>PCR update<select data-live-index="'+a.symbol+'" data-live-field="cadence"><option value="60000"'+(cadences[a.symbol]===60000?' selected':'')+'>1 min</option><option value="180000"'+(cadences[a.symbol]===180000?' selected':'')+'>3 min</option></select></label>'+valuesHtml+'<div data-live-controls="'+a.symbol+'">'+layerControls+referenceControls+'</div>'+'<div data-live-charts="'+a.symbol+'">'+chartsHtml+'</div><small>IV / Greeks: unavailable from Kite tick. Chart time = backend receipt, including milliseconds. History starts when this view connects; gaps stay disconnected. PCR is a periodic full-expiry snapshot, not tick PCR. Source checks run each minute; this view samples at your selected 1/3 min cadence. 15m = five recorded opening samples; FIB = existing previous-session pivots for Spot/CE/PE only. References require the same session and exact contract; load recorded data/earlier sessions below.</small></article>';
  }).join('');
  publish();if(!mountedAll&&!editing){writeHtml(get('op-live-indices'),cards);for(const key of Object.keys(desiredShapes))cardShapes[key]=desiredShapes[key];}
  writeHtml(get('op-live-vix'),'<div class="op-live-kpis">'+quote('INDIA VIX',s.vix)+'</div>');
  writeHtml(get('op-live-participation'),'<div class="op-live-quotes">'+s.participation.map((q:any)=>'<div>'+esc(q.identity?.label)+'<strong>'+fmt(q.price)+' · '+fmt(q.changePct)+'%</strong><small>'+esc(q.state+' · '+time(q.observedAt)+' IST · received '+time(q.receivedAt,true))+'</small></div>').join('')+'</div>');
 }
 if(typeof window.addEventListener==='function')window.addEventListener('optionpilot:live-selection',((event:any)=>{
  const next=event.detail,index=next?.symbol;if(!indices.includes(index)||!latest?.snapshot)return;
  const a=latest.snapshot.indices.find((r:any)=>r.symbol===index);if(!a)return;
  if(next.expiry&&!a.expiries.includes(next.expiry))return;
  if(['ceStrike','peStrike'].some(field=>next[field]!==undefined&&!a.strikes.includes(next[field])))return;
  const changed=Object.keys(next).some(field=>field!=='symbol'&&selection[index]?.[field]!==next[field]);if(!changed)return;
  selection[index]={...selection[index],...(next.expiry?{expiry:next.expiry}:{}),...(next.ceStrike!==undefined?{ceStrike:next.ceStrike}:{}),...(next.peStrike!==undefined?{peStrike:next.peStrike}:{})};
  if(next.expiry&&next.expiry!==a.expiry){delete selection[index].strike;delete selection[index].ceStrike;delete selection[index].peStrike;}
  delete sampled[index];delete chartPaints[index];latest=null;render();connect();
 }) as EventListener);
 get('op-live-indices').onchange=(event:any)=>{const e=event.target,index=e.dataset.liveIndex,field=e.dataset.liveField;if(indices.includes(index)&&field==='cadence'){if(!['60000','180000'].includes(e.value))return;cadences[index]=Number(e.value);delete sampled[index];delete buffers[index+'|pcr'];delete chartPaints[index];render();return;}if(!indices.includes(index)||!['expiry','strike'].includes(field)||!e.value)return;delete sampled[index];delete chartPaints[index];selection[index]={...selection[index],[field]:field==='strike'?Number(e.value):e.value};if(field==='expiry')delete selection[index].strike;for(const key of ['pcr','ce','pe'])delete buffers[index+'|'+key];latest=null;render();connect();};
 get('op-live-indices').onclick=(event:any)=>{const ref=event.target.closest?.('[data-live-reference]');if(ref){const index=ref.dataset.liveIndex,key=ref.dataset.liveReference;if(indices.includes(index)&&/^(spot|pcr|ce|pe)Opening$|^(spot|ce|pe)Fib$/.test(key)){levelSettings[index][key]=!levelSettings[index][key];render();}return;}const e=event.target.closest?.('[data-live-layer]');if(!e||!indices.includes(e.dataset.liveIndex)||!['spot','pcr','ce','pe'].includes(e.dataset.liveLayer))return;layers[e.dataset.liveIndex][e.dataset.liveLayer]=!layers[e.dataset.liveIndex][e.dataset.liveLayer];render();};
 get('op-live-toggle').onclick=()=>{on=!on;get('op-live-toggle').setAttribute('aria-pressed',String(on));get('op-live-toggle').textContent=on?'Live view ON':'Live view OFF';get('op-live-body').hidden=!on;if(on)connect();else{close();latest=null;render();get('op-live-status').textContent='Live stream paused';}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){close();latest=null;render();}else connect();});
 window.addEventListener('online',connect);window.addEventListener('pageshow',()=>{disposed=false;connect();});window.addEventListener('pagehide',()=>{disposed=true;close();latest=null;render();});
 setInterval(()=>{if(latest&&Date.now()-lastReceived>4000){latest=null;get('op-live-status').textContent='Live updates delayed · values withheld';render();}},1000);
 if(typeof CustomEvent!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('optionpilot:request-recorded-levels',{detail:null}));
 connect();
}
