import { createRecordedPlayback, recordedFrame, recordedSession } from './recorded-playback.js';
import { standardIndexObservationClose } from './index-observation-session.js';

export function renderRecordedDashboard(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OptionPilot · Recorded Replay</title><style>
:root{font-family:system-ui,sans-serif;color:#17221d;background:#f3f6f3;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:14px}header,.controls,.metrics{display:flex;align-items:center;gap:8px;flex-wrap:wrap}header{justify-content:space-between}h1{font-size:23px;margin:5px 0}h2{font-size:17px;margin:0 0 8px}p{margin:8px 0;line-height:1.5}a{color:#075e40}.tag{font-size:12px;font-weight:750;letter-spacing:.05em;color:#075e40}.note{font-size:12px;color:#53625a}.panel{background:white;border:1px solid #d1dcd4;border-radius:10px;padding:12px;margin:10px 0}.notice{border-left:4px solid #008755;background:#e8f4ec;padding:10px;font-size:13px}button,select{font:inherit;min-height:40px;border:1px solid #b0c2b6;border-radius:6px;padding:7px 10px;background:#fff;color:#17221d}button{cursor:pointer}button.primary{background:#075e40;color:white;border-color:#075e40}button:disabled{opacity:.5;cursor:default}button[aria-pressed=true]{box-shadow:inset 0 0 0 2px #075e40}label{font-size:13px;display:flex;gap:5px;align-items:center}select[multiple]{min-width:180px;max-width:100%;width:100%}details summary{cursor:pointer;padding:5px;font-size:13px}input[type=range]{width:100%;min-height:38px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.metric{border:1px solid #e1e8e2;padding:8px;border-radius:6px;min-width:0}.metric small{display:block;color:#53625a;font-size:11px}.metric strong{display:block;font-size:20px;overflow-wrap:anywhere}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}th,td{text-align:right;padding:8px;border-bottom:1px solid #e2e9e3}th{background:#eef3ee;font-size:12px}th:first-child,td:first-child{text-align:left}.up{color:#08723b}.down{color:#b62135}.pdh{color:#08723b}.pdl{color:#b62135}.pdc{color:#796000}.gap{color:#a53026;font-weight:650}.chart{width:100%;height:175px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}#error{color:#a51828;font-weight:650}#clock{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}#progress{min-height:18px}#queue{font-size:12px}@media(max-width:600px){main{padding:8px}h1{font-size:20px}.panel{padding:9px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pair{grid-template-columns:1fr}button,select{font-size:13px}.controls{gap:6px}.metric strong{font-size:19px}}@media(prefers-reduced-motion:no-preference){.changed{animation:change .7s ease-out}@keyframes change{from{background:#d9f7e4}to{background:transparent}}}
</style></head><body><main><header><div><span class="tag">OPTIONPILOT / RECORDED DATA</span><h1>Saved sessions & Replay</h1></div><a href="/api/research/business-dashboard/view">Dashboard ↗</a></header>
<p class="notice">RECORDED · Read-only. Market collection keeps its 08:45–16:15 IST schedule. Replay uses saved samples, including after market close.</p>
<section class="panel"><div class="controls"><label>Index <select id="ar-index"><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><button id="ar-latest">Latest saved data</button><button id="ar-last1">▶ 1 day</button><button id="ar-last3">▶ Last 3 days</button><button id="ar-last5">▶ Last 5 days</button><button id="ar-all">▶ All recorded days</button></div><details><summary>Choose individual recorded days</summary><label for="ar-dates">Select dates; then Replay selected</label><select id="ar-dates" multiple size="5" aria-label="Recorded days"></select><button id="ar-selected" class="primary">▶ Replay selected</button></details><p id="queue">Loading recorded dates…</p><p id="progress" class="note" role="status"></p><p id="error" role="alert"></p></section>
<section class="panel"><div class="controls"><button id="ar-play" class="primary" disabled>▶ Play</button><button id="ar-prev" disabled>← Record</button><button id="ar-next" disabled>Record →</button><button id="ar-reset" disabled>Reset day</button><label>Speed <select id="ar-speed"><option value="1">1×</option><option value="5">5×</option><option value="10">10×</option></select></label></div><input type="range" id="ar-seek" min="0" max="0" value="0" disabled aria-label="Replay recorded time"><p id="clock">No saved session loaded</p><p id="ar-coverage" class="note"></p></section>
<section class="panel"><h2>Spot · Futures · Positioning</h2><div id="ar-metrics" class="metrics"></div><div class="controls"><label>Contract <select id="ar-contract-mode"><option value="SESSION">Session ATM · reset each day</option><option value="PINNED">Same contract across days</option></select></label><label>Expiry <select id="ar-expiry" aria-label="Pinned exact expiry"></select></label><label>Strike <select id="ar-strike" aria-label="Pinned CE and PE strike"></select></label><button id="ar-atm">Pin ATM at cursor</button></div><p id="ar-contract" class="note"></p><div id="ar-charts"></div></section>
<section class="panel"><h2>CE / PE ladder · ATM ±7 saved strikes</h2><p class="note">Exact replay timestamp only · PDH green / PDC yellow / PDL red · ΔOI uses the preceding saved bucket only when ≤3 minutes apart.</p><div id="ar-ladder" class="scroll"></div></section><footer class="note">1× = one recorded step / second. Gaps remain gaps; samples are not OHLC candles. Session ATM pins the opening saved contract separately each day. Choose Same contract to keep expiry / strike across days; missing contracts remain unavailable. BANKNIFTY is monthly research only. No orders or Telegram messages.</footer>
</main><script>const __name=(fn,_name)=>fn;const recordedSession=${recordedSession.toString()};const recordedFrame=${recordedFrame.toString()};const createRecordedPlayback=${createRecordedPlayback.toString()};const standardIndexObservationClose=${standardIndexObservationClose.toString()};(${installRecordedDashboard.toString()})();</script></body></html>`;}

export function installRecordedDashboard(){
 const $=(id:string)=>document.getElementById(id) as any;
 let dates:string[]=[],dateRows:any[]=[],symbol='NIFTY',expiry='',strike:number|null=null,controller:any=null,latest:any=null,requestVersion=0,renderedDate='';
 const number=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const fmt=(v:any)=>number(v)===null?'—':v.toLocaleString('en-IN',{maximumFractionDigits:2});
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const clock=(at:string)=>new Date(at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false});
 const controls=['ar-latest','ar-last1','ar-last3','ar-last5','ar-all','ar-selected'];
 function available(){dates=[...new Set<string>(dateRows.filter(row=>row.symbol===symbol&&Number(row.markerCount)>0).map(row=>row.tradeDate))].sort();$('ar-dates').innerHTML=[...dates].reverse().map(date=>'<option value="'+date+'">'+date+'</option>').join('');for(const id of controls)$(id).disabled=!dates.length;$('queue').textContent=dates.length+' recorded days for '+symbol+(symbol==='BANKNIFTY'?' · monthly research':'')+'.';}
 async function json(url:string,signal?:AbortSignal){
  const timeout=new AbortController(),id=setTimeout(()=>timeout.abort(),65000);
  const combined=signal?AbortSignal.any([signal,timeout.signal]):timeout.signal;
  try{const response=await fetch(url,{signal:combined,cache:'no-store'}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||result.reason||'HTTP '+response.status);return result;}
  catch(error:any){if(combined.aborted)throw new Error(signal?.aborted?'Playback cancelled.':'Saved-data request timed out. Retry this day.');throw error;}
  finally{clearTimeout(id);}
 }
 async function load(date:string,signal:AbortSignal){
  const parts:any[]=[],end=standardIndexObservationClose(date),minute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3)),text=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const total=Math.ceil((minute(end)-555)/60);
  for(let start=555,part=0;start<minute(end);start+=60){
   if(signal.aborted)throw new Error('Playback cancelled.');
   $('progress').textContent='Loading '+symbol+' · '+date+' · '+(++part)+' / '+total+' saved windows…';
   const query=new URLSearchParams({symbol,date,from:text(start),to:text(Math.min(start+60,minute(end)))});
   parts.push(await json('/api/research/recorded-dashboard/replay?'+query,signal));
  }
  // Inclusive boundary rows repeat between windows. Drop only byte-identical copies;
  // conflicting same-key evidence fails visibly instead of picking a value.
  const merged:any={};
  for(const kind of ['market','options','chain']){
   const rows=new Map<string,any>();
   for(const part of parts){const table=part[kind];for(const values of table?.rows||[]){const row=Object.fromEntries(table.columns.map((key:string,i:number)=>[key,values[i]]));const key=JSON.stringify([row.symbol,row.minute_bucket,row.expiry,row.strike,row.option_type]);const prior=rows.get(key);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new Error('Conflicting saved '+kind+' rows at '+row.minute_bucket+'. Replay stopped.');rows.set(key,row);}}
   merged[kind]=[...rows.values()];
  }
  $('progress').textContent='Loaded '+date+' · '+merged.market.length+' market / '+merged.options.length+' option / '+merged.chain.length+' chain rows.';
  return recordedSession(merged,symbol,date);
 }
 function pin(frame:any,force=false){
  const first=latest?.session,rows=force?frame.options:(first?.options||[]),at=force?frame.at:rows[0]?.minute_bucket;
  const initial=rows.filter((r:any)=>r.minute_bucket===at),ex=[...new Set<string>(initial.map((r:any)=>String(r.expiry).slice(0,10)))].sort();
  if(!expiry||force)expiry=ex[0]||'';
  const strikes=[...new Set<number>(initial.filter((r:any)=>String(r.expiry).slice(0,10)===expiry).map((r:any)=>r.strike).filter((v:any)=>number(v)!==null))].sort((a,b)=>a-b);
  const spot=(force?frame.market:(first?.market||[]).filter((r:any)=>r.minute_bucket===at))[0]?.spot_ltp;
  if(strike===null||force)strike=strikes.length?strikes.reduce((best,k)=>number(spot)!==null&&Math.abs(k-spot)<Math.abs(best-spot)?k:best,strikes[0]):null;
 }
 function graph(rows:any[],field:string,title:string,color:string,at:string){
  const points=rows.filter(r=>r.minute_bucket<=at).sort((a,b)=>a.minute_bucket.localeCompare(b.minute_bucket)),valid=points.filter(r=>number(r[field])!==null);
  if(!valid.length)return '<p class="note">'+title+' · — at or before cursor</p>';
  const lo=Math.min(...valid.map(r=>r[field])),hi=Math.max(...valid.map(r=>r[field])),start=Date.parse(latest.session.timeline[0]),end=Date.parse(at),span=Math.max(180000,end-start),y=(v:number)=>140-(v-lo)/Math.max(hi-lo,.01)*110,x=(t:string)=>60+(Date.parse(t)-start)/span*490;
  let prev:any=null,lines='',dots='';for(const row of points){if(number(row[field])===null){prev=null;continue;}if(prev&&Date.parse(row.minute_bucket)-Date.parse(prev.minute_bucket)<=180000)lines+='<path d="M '+x(prev.minute_bucket)+' '+y(prev[field])+' L '+x(row.minute_bucket)+' '+y(row[field])+'"/>';dots+='<circle cx="'+x(row.minute_bucket)+'" cy="'+y(row[field])+'" r="2"/>';prev=row;}
  return '<h2>'+esc(title)+'</h2><svg class="chart" viewBox="0 0 580 175" role="img" aria-label="'+esc(title)+' recorded sample graph"><g fill="'+color+'" stroke="'+color+'" stroke-width="2">'+lines+dots+'</g><g fill="#53625a" font-size="11"><text x="0" y="30">'+fmt(hi)+'</text><text x="0" y="145">'+fmt(lo)+'</text><text x="60" y="170">'+clock(latest.session.timeline[0])+'</text><text x="490" y="170">'+clock(at)+'</text></g></svg>';
 }
 function render(state:any){
  latest=state;const frame=state.frame,session=state.session,at=frame.at;
  $('error').textContent=state.error;$('ar-play').textContent=state.playing?'Ⅱ Pause':'▶ Play';
  $('ar-play').disabled=state.loading||!session?.timeline?.length;$('ar-prev').disabled=state.loading||!at||state.index===0;$('ar-next').disabled=state.loading||!at||(!state.playing&&state.index===session.timeline.length-1&&state.dayIndex===state.days.length-1);$('ar-reset').disabled=state.loading||!at;
  $('ar-seek').disabled=state.loading||!at;$('ar-seek').max=String(Math.max(0,(session?.timeline?.length||1)-1));$('ar-seek').value=String(state.index);
  if(state.days.length)$('queue').textContent='Day '+(state.dayIndex+1)+' / '+state.days.length+' · '+state.days.join(' → ');
  $('clock').textContent=state.loading?'Loading recorded '+state.days[state.dayIndex]+'…':at?frame.date+' · '+clock(at)+' IST · '+(state.playing?'REPLAY':'SAVED / PAUSED'):'No TRUE saved samples loaded';
  $('ar-coverage').innerHTML=at?(state.index+1)+' / '+session.timeline.length+' saved steps · '+session.cadenceMinutes+'m recorder cadence'+(frame.gapMinutes>session.cadenceMinutes?' · <span class="gap">Gap '+frame.gapMinutes+' minutes since previous step; no values filled</span>':''):'Missing data stays unavailable.';
  if(!at){$('ar-metrics').innerHTML='';$('ar-charts').innerHTML='';$('ar-ladder').innerHTML='';$('ar-contract').textContent='';return;}
  if(renderedDate!==frame.date){if($('ar-contract-mode').value!=='PINNED'){expiry='';strike=null;}renderedDate=frame.date;}
  pin(frame);
  const ex=[...new Set<string>([expiry,...session.options.map((r:any)=>String(r.expiry).slice(0,10))])].filter(Boolean).sort();$('ar-expiry').innerHTML=ex.map(v=>'<option>'+esc(v)+'</option>').join('');$('ar-expiry').value=expiry;
  const strikes=[...new Set<number>([strike,...session.options.filter((r:any)=>String(r.expiry).slice(0,10)===expiry).map((r:any)=>r.strike)])].filter((v:any)=>number(v)!==null).sort((a:any,b:any)=>a-b);$('ar-strike').innerHTML=strikes.map(v=>'<option>'+v+'</option>').join('');$('ar-strike').value=String(strike);
  const market=frame.market.length===1?frame.market[0]:{},chainRows=frame.chain.filter((r:any)=>String(r.expiry).slice(0,10)===expiry),chain=chainRows.length===1?chainRows[0]:{};
  const metric=(label:string,value:any)=>'<div class="metric"><small>'+label+'</small><strong>'+fmt(value)+'</strong></div>';
  $('ar-metrics').innerHTML=[['Spot',market.spot_ltp],['Future',market.future_ltp],['Basis',market.future_basis],['VIX',market.india_vix],['PDH',market.pdh],['PDC',market.spot_prev_close],['PDL',market.pdl],['Full PCR · pinned expiry',chain.full_chain_oi_pcr]].map(([label,v])=>metric(String(label),v)).join('');
  $('ar-contract').textContent='Pinned '+symbol+' · '+expiry+' · '+strike+' CE / PE. '+(chain.full_pcr_source||'Full PCR provenance unavailable.')+' Walls CE '+fmt(chain.call_wall_strike)+' / PE '+fmt(chain.put_wall_strike)+'.';
  const selected=(side:string)=>session.options.filter((r:any)=>String(r.expiry).slice(0,10)===expiry&&r.strike===strike&&r.option_type===side);
  $('ar-charts').innerHTML=graph(session.market,'spot_ltp','Spot · sampled line','#075e40',at)+'<div class="pair"><div>'+graph(selected('CE'),'ltp','Pinned CE premium','#08723b',at)+'</div><div>'+graph(selected('PE'),'ltp','Pinned PE premium','#b62135',at)+'</div></div>';
  const nowRows=frame.options.filter((r:any)=>String(r.expiry).slice(0,10)===expiry),levels=[...new Set<number>(session.options.filter((r:any)=>String(r.expiry).slice(0,10)===expiry).map((r:any)=>r.strike))].sort((a,b)=>a-b),spot=number(market.spot_ltp),center=spot===null?strike:levels.reduce((best,k)=>Math.abs(k-spot)<Math.abs(best-spot)?k:best,levels[0]);
  const mid=levels.indexOf(center as number),band=mid<0?[]:levels.slice(Math.max(0,mid-7),mid+8),previous=state.index>0?session.timeline[state.index-1]:null;
  const value=(k:number,side:string)=>{const matches=nowRows.filter((r:any)=>r.strike===k&&r.option_type===side);return matches.length===1?matches[0]:{};};
  const cells=(r:any)=>{const old=previous&&frame.gapMinutes<=3?session.options.filter((q:any)=>q.minute_bucket===previous&&q.strike===r.strike&&q.option_type===r.option_type&&String(q.expiry).slice(0,10)===expiry):[],delta=old.length===1&&number(old[0].oi)!==null&&number(r.oi)!==null?r.oi-old[0].oi:null;
   const event=number(r.ltp)!==null?(number(r.pdh)!==null&&r.ltp>r.pdh?'Above PDH':number(r.pdl)!==null&&r.ltp<r.pdl?'Below PDL':''):'';
   return '<td>'+fmt(r.ltp)+'</td><td>'+fmt(r.oi)+'</td><td class="'+(delta>0?'up changed':delta<0?'down changed':'')+'">'+(delta>0?'+':'')+fmt(delta)+'</td><td class="pdh">'+fmt(r.pdh)+'</td><td class="pdc">'+fmt(r.pdc)+'</td><td class="pdl">'+fmt(r.pdl)+'</td><td>'+event+'</td>';};
  $('ar-ladder').innerHTML=band.length?'<table><thead><tr><th>Strike</th><th>CE ₹</th><th>CE OI</th><th>CE ΔOI</th><th>CE PDH</th><th>CE PDC</th><th>CE PDL</th><th>CE state</th><th>PE ₹</th><th>PE OI</th><th>PE ΔOI</th><th>PE PDH</th><th>PE PDC</th><th>PE PDL</th><th>PE state</th></tr></thead><tbody>'+band.map(k=>'<tr><th>'+fmt(k)+'</th>'+cells(value(k,'CE'))+cells(value(k,'PE'))+'</tr>').join('')+'</tbody></table>':'No saved strikes for this pinned expiry.';
 }
 controller=createRecordedPlayback({load,render,setTimeout,clearTimeout});
 async function start(days:string[],play=true){const version=++requestVersion;await controller.start(days,play);if(version===requestVersion&&!play){const state=controller.snapshot();if(state.session?.timeline.length){const optionTimes=new Set(state.session.options.map((r:any)=>r.minute_bucket));let index=state.session.timeline.length-1;for(let i=index;i>=0;i--)if(optionTimes.has(state.session.timeline[i])){index=i;break;}controller.seek(index);}}}
 for(const count of [1,3,5])$('ar-last'+count).onclick=()=>void start(dates.slice(-count));
 $('ar-all').onclick=()=>void start(dates);$('ar-selected').onclick=()=>void start(Array.from($('ar-dates').selectedOptions).map((o:any)=>o.value));$('ar-latest').onclick=()=>void start(dates.slice(-1),false);
 $('ar-play').onclick=()=>controller.toggle();$('ar-prev').onclick=()=>controller.seek(controller.snapshot().index-1);$('ar-next').onclick=()=>void controller.next();$('ar-reset').onclick=()=>controller.seek(0);$('ar-seek').oninput=()=>controller.seek(Number($('ar-seek').value));$('ar-speed').onchange=()=>controller.speed(Number($('ar-speed').value));
 $('ar-index').onchange=()=>{controller.pause();symbol=$('ar-index').value;expiry='';strike=null;available();void start(dates.slice(-1),false);};
 $('ar-contract-mode').onchange=()=>{controller.pause();if($('ar-contract-mode').value!=='PINNED'){expiry='';strike=null;}render(controller.snapshot());};
 $('ar-expiry').onchange=()=>{expiry=$('ar-expiry').value;strike=null;render(controller.snapshot());};$('ar-strike').onchange=()=>{strike=Number($('ar-strike').value);render(controller.snapshot());};$('ar-atm').onclick=()=>{pin(controller.snapshot().frame,true);render(controller.snapshot());};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.pause();});window.addEventListener('pagehide',()=>controller.pause());
 for(const id of controls)$(id).disabled=true;
 json('/api/research/recorded-dashboard/dates').then(result=>{dateRows=result.dates||[];available();if(dates.length)void start(dates.slice(-1),false);else $('error').textContent='No recorded dates exist for this index.';}).catch(error=>{$('error').textContent=error.message;$('queue').textContent='Recorded dates unavailable. Reload to retry.';});
}
