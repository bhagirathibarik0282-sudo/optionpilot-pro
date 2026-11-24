/** Read-only projection of saved memory. Storage-row time is not a
 * guarantee of transaction commit or executable quote availability.
 * Recovered records saved after the cursor intentionally stay hidden. */
export function projectSharedEventMemory(body:any,date:string,at:string|null,symbol='ALL'){
 const empty={events:[] as any[],responses:[] as any[]};
 const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const cutoff=stamp(at),open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(body?.ok!==true||body.tradeDate!==date||!(cutoff>=open&&cutoff<=close)||!Array.isArray(body.events)||!Array.isArray(body.responses))return empty;
 const identity=(e:any)=>['NIFTY','SENSEX','BANKNIFTY'].includes(e?.symbol)&&typeof e.expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.expiry)&&e.expiry>=date&&Number.isFinite(e.strike)&&e.strike>0;
 const safe=(e:any)=>e?.affectsVerdict===false&&e.affectsTelegram===false&&e.affectsExecution===false;
 const qualified=(observed:any,stored:any)=>{const t=stamp(observed),s=stamp(stored);return t>=open&&t<=close&&t<=cutoff&&s>=t&&s<=cutoff;};
 const quoteSafe=(p:any,time:any)=>!p||stamp(p.at)===stamp(time)&&Number.isFinite(stamp(p.quoteAt))&&stamp(p.quoteAt)<=cutoff;
 const pairSafe=(pair:any,time:any)=>!!pair&&quoteSafe(pair.ce,time)&&quoteSafe(pair.pe,time);
 const counts=new Map<string,number>();for(const e of body.events)counts.set(e?.memoryKey,(counts.get(e?.memoryKey)||0)+1);
 const events=body.events.filter((e:any)=>e?.version==='INTRADAY_NOTABLE_EVENT_V1'&&typeof e.memoryKey==='string'&&counts.get(e.memoryKey)===1&&e.tradeDate===date&&identity(e)&&safe(e)&&(symbol==='ALL'||e.symbol===symbol)&&qualified(e.at,body.availability?.events?.[e.memoryKey])&&pairSafe(e.pair,e.at)&&Array.isArray(e.facts)&&e.facts.every((f:any)=>Number.isFinite(stamp(f.from))&&stamp(f.from)<stamp(e.at)));
 const byKey=new Map(events.map((e:any)=>[e.memoryKey,e]));
 const seen=new Map<string,number>();for(const r of body.responses){const key=r?.eventKey+'|'+r?.minutes;seen.set(key,(seen.get(key)||0)+1);}
 const responses=body.responses.filter((r:any)=>{const e:any=byKey.get(r?.eventKey);return !!e&&r.version==='INTRADAY_PREMIUM_RESPONSE_V1'&&typeof r.memoryKey==='string'&&r.tradeDate===date&&safe(r)&&r.symbol===e.symbol&&r.expiry===e.expiry&&r.strike===e.strike&&stamp(r.eventAt)===stamp(e.at)&&[3,15,30].includes(r.minutes)&&seen.get(r.eventKey+'|'+r.minutes)===1&&stamp(r.targetAt)===stamp(e.at)+r.minutes*60000&&qualified(r.targetAt,body.availability?.responses?.[r.memoryKey])&&pairSafe(r.pair,r.targetAt)&&['QUALIFIED','MISSING'].includes(r.status);});
 return {events,responses};
}

export const SHARED_EVENT_MEMORY_HTML='<details id="mb-shared-memory" hidden><summary>Event Memory · shared replay</summary><p class="mb-note">Saved event facts and separate +3/+15/+30m responses. Load once for the selected session; moving the master clock does not request data.</p><div class="mb-controls"><label>Index<select id="mb-shared-memory-index"><option>ALL</option><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><button id="mb-shared-memory-load" type="button">Load saved events</button></div><p id="mb-shared-memory-status" role="status"></p><div id="mb-shared-memory-results"></div></details>';

/** Browser-only display. No automatic requests, timers, persistence or order authority. */
export function installSharedEventMemory(getClock:()=>any,project:typeof projectSharedEventMemory){
 const $=(id:string)=>document.getElementById('mb-shared-memory'+id) as any,root=$(''),button=$('-load'),status=$('-status'),results=$('-results'),index=$('-index');
 if(!root||!button||!status||!results||!index)return null;
 let body:any=null,selectedDate='',version=0,busy=false,error='',active:AbortController|null=null;
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const time=(v:any)=>Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+19800000).toISOString().slice(11,16):'—';
 const value=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'—';
 function render(){
  const c=getClock(),date=c?.active?c.date||'':'';
  if(date!==selectedDate){selectedDate=date;version++;active?.abort();active=null;busy=false;body=null;error='';}
  root.hidden=!c?.active;button.disabled=busy||!date||!c?.at;
  if(!c?.active||!c.at){results.innerHTML='';status.textContent='Select a valid shared replay timestamp.';return;}
  if(!body){results.innerHTML='';status.textContent=busy?'Loading saved memory…':error||'Load saved events for '+date+'.';return;}
  const p=project(body,date,c.at,index.value||'ALL'),byKey=new Map(p.responses.map(r=>[r.eventKey+'|'+r.minutes,r]));
  status.textContent=date+' · '+time(c.at)+' IST · '+p.events.length+' saved events available by cutoff · archive read limit '+(body.readLimitEvents??'unknown')+' · recovered/late records excluded'+(error?' · '+error:'');
  results.innerHTML=p.events.slice(0,40).map(e=>'<details class="mb-box"><summary>'+esc(time(e.at)+' · '+e.symbol+' · '+e.expiry+' · '+e.strike+' CE/PE')+'</summary><p>Event CE ₹'+value(e.pair?.ce?.ltp)+' · PE ₹'+value(e.pair?.pe?.ltp)+'</p><p>'+e.facts.map((f:any)=>esc(f.field)+' '+esc(f.before)+' → '+esc(f.after)).join('<br>')+'</p><p class="mb-note">After-event observations only · not entry evidence</p><div class="mb-scroll"><table><thead><tr><th>Window</th><th>CE %</th><th>PE %</th><th>Status</th></tr></thead><tbody>'+[3,15,30].map(m=>{const r=byKey.get(e.memoryKey+'|'+m);return '<tr><td>+'+m+'m</td><td>'+value(r?.ceReturnPct)+'</td><td>'+value(r?.peReturnPct)+'</td><td>'+esc(r?.status||'Not available at cursor')+'</td></tr>';}).join('')+'</tbody></table></div></details>').join('')||'<p>No saved events qualified at this cursor. This does not establish no market events occurred.</p>';
  if(p.events.length>40)results.innerHTML+='<p class="mb-note">Showing first 40 qualified events. Select an index to narrow.</p>';
 }
 button.onclick=async()=>{const c=getClock();if(!c?.active||!c.at||busy)return;const date=c.date,mine=++version;busy=true;error='';const controller=new AbortController();active=controller;render();
  try{const res=await fetch('/api/research/intraday-memory?date='+encodeURIComponent(date),{cache:'no-store',signal:controller.signal});const d=await res.json();if(mine!==version)return;if(!res.ok||d.ok!==true||d.tradeDate!==date||!d.availability||!Array.isArray(d.events)||!Array.isArray(d.responses))throw Error('Unqualified memory archive');body=d;}
  catch{if(mine===version){body=null;error='Saved event memory unavailable. Load to retry.';}}
  finally{if(mine===version){busy=false;active=null;render();}}
 };
 index.onchange=render;render();return {render};
}
