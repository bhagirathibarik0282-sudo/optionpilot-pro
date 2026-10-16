export const DASHBOARD_LIVE_HTML=`<section id="dashboard-live" class="panel op-live" aria-label="Live Kite market data"><div class="op-live-heading"><h2>LIVE · Kite market</h2><button id="op-live-toggle" type="button" aria-pressed="true">Live view ON</button></div><p id="op-live-status" role="status">Connecting to the live data service…</p><div id="op-live-body"><p>Spot · premiums · OI · expiry-specific full PCR · walls · futures · VIX · heavyweight / sector quotes</p><div id="op-live-vix"></div><div id="op-live-indices" class="op-live-grid"></div><details><summary>Heavyweights & sectors · live quotes</summary><div id="op-live-participation"></div></details><p class="op-live-note">Live prices update from incoming Kite FULL packets. New ticks are flushed at up to 10 updates/second (100ms target, not guaranteed end-to-end latency). All figures carry source times; stale values become unavailable. Full PCR / walls require every instrument in the subscribed expiry inventory. IV / Greeks are not supplied by these packets. Recorded research remains below; live ticks are not inserted into historical evidence.</p></div></section>`;
export const DASHBOARD_LIVE_CSS=`#dashboard-live{display:block}#op-live-body{width:100%;min-width:0}.op-live{order:-5;border-top:3px solid #edc86c;background:#091528}.op-live-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}.op-live-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.op-live-card{min-width:0;padding:12px;border:1px solid #344b69;border-radius:10px;background:#0b1c33}.op-live-card h3{font-size:24px;margin:6px 0}.op-live-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.op-live-kpis>div{min-width:0}.op-live-kpis strong{display:block;font-size:26px;color:#66f1e2;font-variant-numeric:tabular-nums}.op-live-card select{width:100%;font-size:18px;min-height:48px;margin:6px 0}.op-live-card label{display:block;font-size:17px}.op-live-note,.op-live-card small{display:block;font-size:15px;color:#b7c9df;overflow-wrap:anywhere}.op-live-chart{display:block;width:100%;height:auto;background:#071121;margin:8px 0}.op-live-chart text{font-size:13px}.op-live-stale{color:#f3c577}.op-live-quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.op-live-quotes>div{padding:8px;border-bottom:1px solid #344b69}.op-live-quotes strong{display:block;font-size:21px}.op-live-layers{display:flex;flex-wrap:wrap;gap:6px}.op-live-layers button{font-size:16px;min-height:44px}.op-live-layers button[aria-pressed=true]{border-color:#edc86c;color:#edc86c}@media(max-width:1100px){.op-live-grid{grid-template-columns:1fr}.op-live-kpis strong{font-size:30px}}@media(max-width:480px){.op-live-kpis{grid-template-columns:1fr}}`;

/** Browser only: one stream, bounded chart buffers, no broker credentials. */
export function installDashboardLive(){
 const root=document.getElementById('dashboard-live');if(!root)return;
 const get=(id:string)=>document.getElementById(id)!;
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const fmt=(v:any,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:d}):'—';
 const time=(v:any,milliseconds=false)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit',...(milliseconds?{fractionalSecondDigits:3 as const}:{})}):'—';
 const indices=['NIFTY','SENSEX','BANKNIFTY'];
 const selection:any={},buffers:any={},layers:any={};for(const symbol of indices)layers[symbol]={spot:true,pcr:true,ce:false,pe:false};
 let source:any=null,on=true,lastReceived=0,latest:any=null,runtime:string|null=null,disposed=false;
 function close(){if(source){source.close();source=null;}}
 function connect(){
  close();if(!on||document.hidden||disposed)return;
  if(typeof EventSource==='undefined'){get('op-live-status').textContent='Live streaming is not supported by this browser.';return;}
  const q=new URLSearchParams();for(const symbol of indices){const s=selection[symbol];if(s?.expiry)q.set(symbol+'_expiry',s.expiry);if(s?.strike)q.set(symbol+'_strike',String(s.strike));}
  const active=new EventSource('/api/research/dashboard-live/stream?'+q.toString());source=active;
  get('op-live-status').textContent='Connecting · historical data below is recorded data';
  active.addEventListener('snapshot',(event:any)=>{
   if(source!==active||!on||disposed)return;
   try{const d=JSON.parse(event.data);if(!d||typeof d.connectionState!=='string')throw Error();
    if(d.snapshot){if(runtime&&runtime!==d.snapshot.runtimeId){for(const key of Object.keys(buffers))delete buffers[key];}runtime=d.snapshot.runtimeId;}
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
 function chart(symbol:string,kind:string,title:string,digits:number){
  const points=buffers[symbol+'|'+kind]||[];if(!points.length)return '<p class="op-live-note">'+esc(title)+' · waiting for fresh ticks</p>';
  const rows=points.slice(-600),start=Date.parse(rows[0].at),end=Date.parse(rows.at(-1).at),values=rows.map((p:any)=>p.value),lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.1,kind==='pcr'?.0001:1),x=(at:string)=>60+(Date.parse(at)-start)/Math.max(end-start,1000)*340,y=(v:number)=>180-(v-lo+pad)/(hi-lo+2*pad)*145,color=kind==='pcr'?'#ff9f89':kind==='pe'?'#ff81cb':'#62eee0';
  let svg='<svg class="op-live-chart" viewBox="0 0 460 220" role="img" aria-label="'+esc(symbol+' '+title+' live chart')+'"><text x="60" y="19" fill="'+color+'">'+esc(title)+'</text>';
  for(let i=0;i<3;i++){const v=lo-pad+(hi-lo+2*pad)*i/2;svg+='<text x="54" y="'+(y(v)+4)+'" text-anchor="end" fill="#b7c9df">'+esc(fmt(v,digits))+'</text><line x1="60" x2="400" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#293e59"/>';}
  let previous:any=null;for(const p of rows){if(previous&&Date.parse(p.at)-Date.parse(previous.at)<=5000)svg+='<line x1="'+x(previous.at)+'" x2="'+x(p.at)+'" y1="'+y(previous.value)+'" y2="'+y(p.value)+'" stroke="'+color+'" stroke-width="2"/>';svg+='<circle cx="'+x(p.at)+'" cy="'+y(p.value)+'" r="2" fill="'+color+'"><title>'+esc(time(p.at,true)+' · '+fmt(p.value,digits))+'</title></circle>';previous=p;}
  return svg+'<text x="60" y="210" fill="#b7c9df">'+esc(time(rows[0].at))+'</text><text x="400" y="210" text-anchor="end" fill="#b7c9df">'+esc(time(rows.at(-1).at))+'</text></svg>';
 }
 function render(){
  const d=latest,s=d?.snapshot;
  if(typeof CustomEvent!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('optionpilot:live-context',{detail:d}));
  if(!d||!s){get('op-live-indices').innerHTML='<p class="op-live-stale">'+esc(d?'Feed '+d.connectionState+' · live values unavailable':'Waiting for a fresh live connection')+'</p>';get('op-live-participation').textContent='Live values unavailable';get('op-live-vix').textContent='India VIX: unavailable';if(d)get('op-live-status').textContent='Feed '+d.connectionState+' · live values unavailable';return;}
  get('op-live-status').textContent='Feed '+d.connectionState+' · server '+time(d.serverTime,true)+' IST · '+(s.omittedExpiries.length?s.omittedExpiries.length+' whole expiries outside subscription capacity · ':'')+'Live packet times below';
  const focused=document.activeElement as HTMLElement|null,editing=!!focused&&root!.contains(focused)&&focused.tagName==='SELECT';
  const quote=(label:string,q:any)=>'<div><span>'+esc(label)+'</span><strong>'+fmt(q.price)+'</strong><small>'+esc(q.state+' · '+time(q.observedAt)+' IST · received '+time(q.receivedAt,true))+'</small></div>';
  const cards=s.indices.map((a:any)=>{
   append(a.symbol,'spot',a.spot.price,a.spot.receivedAt);append(a.symbol,'pcr',a.fullPcr,a.pcrReceivedAt);append(a.symbol,'ce',a.ce.price,a.ce.receivedAt);append(a.symbol,'pe',a.pe.price,a.pe.receivedAt);
   const selected=selection[a.symbol]||{},expiry=selected.expiry||a.expiry,strike=selected.strike||a.strike;
   const select=(field:string,values:any[],value:any)=>'<label>'+field+'<select data-live-index="'+a.symbol+'" data-live-field="'+field.toLowerCase()+'">'+(!values.length?'<option value="">Unavailable</option>':values.map(v=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(v)+'</option>').join(''))+'</select></label>';
   const metric=(label:string,value:any,digits=2)=>'<div>'+esc(label)+'<strong>'+fmt(value,digits)+'</strong></div>';
   const valuesHtml='<div class="op-live-kpis" data-live-values="'+a.symbol+'">'+quote('SPOT',a.spot)+quote('FUTURES · '+(a.future.identity?.expiry||'unavailable'),a.future)+quote('CE · '+(a.strike||'—'),a.ce)+quote('PE · '+(a.strike||'—'),a.pe)+'<div>FULL PCR<strong>'+fmt(a.fullPcr,4)+'</strong><small>'+a.coverage.freshOi+'/'+a.coverage.expected+' fresh OI instruments · '+esc(time(a.pcrAt))+' IST</small></div>'+metric('Futures basis',a.futuresBasis)+metric('Futures OI',a.future.oi,0)+metric('Futures volume',a.future.volume,0)+metric('CE OI',a.ce.oi,0)+metric('PE OI',a.pe.oi,0)+metric('CE wall strike',a.callWall?.strike,0)+metric('CE wall OI',a.callWall?.oi,0)+metric('PE wall strike',a.putWall?.strike,0)+metric('PE wall OI',a.putWall?.oi,0)+metric('CE volume',a.ce.volume,0)+metric('PE volume',a.pe.volume,0)+metric('CE bid',a.ce.bid)+metric('CE ask',a.ce.ask)+metric('PE bid',a.pe.bid)+metric('PE ask',a.pe.ask)+'</div>';
   const chartsHtml=['spot','pcr','ce','pe'].filter(key=>layers[a.symbol][key]).map(key=>chart(a.symbol,key,key==='pcr'?'Full PCR · ratio':key.toUpperCase()+' · ₹ / points',key==='pcr'?4:2)).join('');
   // Keep an open selector intact while numbers and charts continue to update.
   if(editing){const values=root!.querySelector('[data-live-values="'+a.symbol+'"]');if(values)values.outerHTML=valuesHtml;const charts=root!.querySelector('[data-live-charts="'+a.symbol+'"]');if(charts)charts.innerHTML=chartsHtml;}
   return '<article class="op-live-card"><h3>'+a.symbol+(a.symbol==='BANKNIFTY'?' · monthly observation':'')+'</h3>'+select('Expiry',a.expiries,expiry)+select('Strike',a.strikes,strike)+valuesHtml+'<div class="op-live-layers">'+['spot','pcr','ce','pe'].map(key=>'<button type="button" data-live-layer="'+key+'" data-live-index="'+a.symbol+'" aria-pressed="'+layers[a.symbol][key]+'">'+key.toUpperCase()+' chart · '+(layers[a.symbol][key]?'ON':'OFF')+'</button>').join('')+'</div><div data-live-charts="'+a.symbol+'">'+chartsHtml+'</div><small>IV / Greeks: unavailable from Kite tick. Chart time = backend receipt, including milliseconds. History starts when this view connects; gaps stay disconnected.</small></article>';
  }).join('');
  if(!editing)get('op-live-indices').innerHTML=cards;
  get('op-live-vix').innerHTML='<div class="op-live-kpis">'+quote('INDIA VIX',s.vix)+'</div>';
  get('op-live-participation').innerHTML='<div class="op-live-quotes">'+s.participation.map((q:any)=>'<div>'+esc(q.identity?.label)+'<strong>'+fmt(q.price)+' · '+fmt(q.changePct)+'%</strong><small>'+esc(q.state+' · '+time(q.observedAt)+' IST · received '+time(q.receivedAt,true))+'</small></div>').join('')+'</div>';
 }
 get('op-live-indices').onchange=(event:any)=>{const e=event.target,index=e.dataset.liveIndex,field=e.dataset.liveField;if(!indices.includes(index)||!['expiry','strike'].includes(field)||!e.value)return;selection[index]={...selection[index],[field]:field==='strike'?Number(e.value):e.value};if(field==='expiry')delete selection[index].strike;for(const key of ['pcr','ce','pe'])delete buffers[index+'|'+key];latest=null;render();connect();};
 get('op-live-indices').onclick=(event:any)=>{const e=event.target.closest?.('[data-live-layer]');if(!e||!indices.includes(e.dataset.liveIndex)||!['spot','pcr','ce','pe'].includes(e.dataset.liveLayer))return;layers[e.dataset.liveIndex][e.dataset.liveLayer]=!layers[e.dataset.liveIndex][e.dataset.liveLayer];render();};
 get('op-live-toggle').onclick=()=>{on=!on;get('op-live-toggle').setAttribute('aria-pressed',String(on));get('op-live-toggle').textContent=on?'Live view ON':'Live view OFF';get('op-live-body').hidden=!on;if(on)connect();else{close();latest=null;render();get('op-live-status').textContent='Live stream paused';}};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){close();latest=null;render();}else connect();});
 window.addEventListener('online',connect);window.addEventListener('pageshow',()=>{disposed=false;connect();});window.addEventListener('pagehide',()=>{disposed=true;close();latest=null;render();});
 setInterval(()=>{if(latest&&Date.now()-lastReceived>4000){latest=null;get('op-live-status').textContent='Live updates delayed · values withheld';render();}},1000);
 connect();
}
