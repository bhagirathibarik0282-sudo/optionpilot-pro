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
 const responses=body.responses.filter((r:any)=>{const e:any=byKey.get(r?.eventKey);return !!e&&r.version==='INTRADAY_PREMIUM_RESPONSE_V1'&&typeof r.memoryKey==='string'&&r.tradeDate===date&&safe(r)&&r.symbol===e.symbol&&r.expiry===e.expiry&&r.strike===e.strike&&stamp(r.eventAt)===stamp(e.at)&&[3,15,30].includes(r.minutes)&&seen.get(r.eventKey+'|'+r.minutes)===1&&stamp(r.targetAt)===stamp(e.at)+r.minutes*60000&&qualified(r.targetAt,body.availability?.responses?.[r.memoryKey])&&pairSafe(r.pair,r.targetAt)&&((r.status==='QUALIFIED'&&r.pair.ce&&r.pair.pe&&[r.ceReturnPct,r.peReturnPct,r.straddleReturnPct].every(Number.isFinite))||(r.status==='MISSING'&&[r.ceReturnPct,r.peReturnPct,r.straddleReturnPct].every(v=>v===null)));});
 return {events,responses};
}

/** Exact checkpoints, frozen at the saved event's storage time for before/at
 * and at the master cursor for after. Storage time is not execution time.
 * Only previously admitted event identities may be supplied by the caller. */
export function buildSharedEventTimeline(state:any,event:any,eventStoredAt:string){
 const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const date=state?.date,at=stamp(event?.at),known=stamp(eventStoredAt),cutoff=stamp(state?.replay?.at);
 const open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!state?.replay?.active||event?.tradeDate!==date||!['NIFTY','SENSEX','BANKNIFTY'].includes(event?.symbol)||
 !Number.isSafeInteger(event.strike)||event.strike<=0||!/^\d{4}-\d{2}-\d{2}$/.test(event.expiry)||event.expiry<date||
 !(at>=open&&at<=close&&known>=at&&known<=cutoff&&cutoff<=close))return [];
 const data=state.current?.[event.symbol]||{},offsets=[-15,-10,-5,-3,-1,0,1,3,5,10,15,30];
 const number=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
 const group=(rows:any[],time:number,filter:(r:any)=>boolean)=>rows.filter(r=>r.symbol===event.symbol&&stamp(r.minute_bucket)===time&&filter(r));
 const one=(rows:any[])=>rows.length===1&&rows[0].truth_verdict==='TRUE'?rows[0]:null;
 return offsets.map(offset=>{
  const t=at+offset*60000,limit=offset<=0?known:cutoff;
  const row:any={offset,phase:offset<0?'BEFORE':offset===0?'EVENT':'AFTER',at:new Date(t).toISOString(),status:'GAP',spot:null,vix:null,futures:null,pdh:null,pdl:null,ce:null,pe:null,fullPcr:null,ceWall:null,peWall:null};
  if(t<open||t>close){row.status='OUTSIDE_SESSION';return row;}
  if(t>cutoff){row.status='FUTURE';return row;}
  const m=one(group(data.market||[],t,()=>true)),receipt=stamp(m?.backend_timestamp);
  if(!m||!m.snapshot_id||!(receipt>=t&&receipt<t+60000&&receipt<=limit))return row;
  for(const [field,source] of [['spot','spot_ltp'],['vix','india_vix'],['futures','future_ltp'],['pdh','pdh'],['pdl','pdl']])row[field]=number(m[source]);
  for(const side of ['CE','PE']){
   const q=one(group(data.options||[],t,r=>String(r.expiry).slice(0,10)===event.expiry&&number(r.strike)===event.strike&&r.option_type===side));
   const quoteAt=stamp(q?.quote_timestamp),age=number(q?.quote_age_seconds),price=number(q?.ltp);
   if(q&&q.snapshot_id===m.snapshot_id&&price!==null&&price>0&&age!==null&&age>=0&&age<=30&&quoteAt>=open&&quoteAt<=receipt&&quoteAt<=limit&&receipt-quoteAt<=30000)
    row[side.toLowerCase()]={price,oi:number(q.oi),pdh:number(q.pdh),pdl:number(q.pdl),quoteAt:q.quote_timestamp};
  }
  const c=one(group(data.chain||[],t,r=>String(r.expiry).slice(0,10)===event.expiry));
  // Chain without its own source timestamp/snapshot linkage remains a gap.
  const source=stamp(c?.source_timestamp);
  if(c&&c.snapshot_id===m.snapshot_id&&source>=t&&source<=receipt&&source<=limit&&['Exact archived full-chain source','Normalized full-chain source'].includes(c.full_pcr_source)){
   row.fullPcr=number(c.full_chain_oi_pcr);row.ceWall=number(c.call_wall_strike);row.peWall=number(c.put_wall_strike);
  }
  row.status=row.ce&&row.pe?'PAIR_OBSERVED':'PARTIAL';return row;
 });
}

export const SHARED_EVENT_MEMORY_HTML='<details id="mb-shared-memory" hidden><summary>Event Intelligence · Before / Event / After</summary><p class="mb-note">Saved event facts and separate +3/+15/+30m responses. Load once for the selected session; moving the master clock does not request data.</p><div class="mb-controls"><label>Index<select id="mb-shared-memory-index"><option>ALL</option><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><button id="mb-shared-memory-load" type="button">Load saved events</button></div><p id="mb-shared-memory-status" role="status"></p><label>Selected event<select id="mb-shared-memory-event"></select></label><div id="mb-shared-memory-timeline"></div><details><summary>Saved event list and responses</summary><div id="mb-shared-memory-results"></div></details></details>';

/** Browser-only display. No automatic requests, timers, persistence or order authority. */
export function installSharedEventMemory(getClock:()=>any,project:typeof projectSharedEventMemory,getState?:()=>any,build?:typeof buildSharedEventTimeline){
 const $=(id:string)=>document.getElementById('mb-shared-memory'+id) as any,root=$(''),button=$('-load'),status=$('-status'),results=$('-results'),index=$('-index');
 if(!root||!button||!status||!results||!index)return null;
 const eventSelect=$('-event'),timeline=$('-timeline');let chosen='';
 const clearTimeline=()=>{chosen='';if(eventSelect)eventSelect.innerHTML='';if(timeline)timeline.innerHTML='';};
 let body:any=null,selectedDate='',version=0,busy=false,error='',active:AbortController|null=null;
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const time=(v:any)=>Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+19800000).toISOString().slice(11,16):'—';
 const value=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'—';
 function render(){
  const c=getClock(),date=c?.active?c.date||'':'';
  if(date!==selectedDate){selectedDate=date;version++;active?.abort();active=null;busy=false;body=null;error='';clearTimeline();}
  root.hidden=!c?.active;button.disabled=busy||!date||!c?.at;
  if(!c?.active||!c.at){clearTimeline();results.innerHTML='';status.textContent='Select a valid shared replay timestamp.';return;}
  if(!body){clearTimeline();results.innerHTML='';status.textContent=busy?'Loading saved memory…':error||'Load saved events for '+date+'.';return;}
  const p=project(body,date,c.at,index.value||'ALL'),byKey=new Map(p.responses.map(r=>[r.eventKey+'|'+r.minutes,r]));
  if(eventSelect&&timeline&&getState&&build){
   const es=p.events;
   if(!es.some(e=>e.memoryKey===chosen))chosen=es[0]?.memoryKey||'';
   const options=es.map(e=>'<option value="'+esc(e.memoryKey)+'">'+esc(time(e.at)+' · '+e.symbol+' · '+e.strike+' · '+e.expiry)+'</option>').join('');
   if(eventSelect.innerHTML!==options)eventSelect.innerHTML=options;eventSelect.value=chosen;
   const e=es.find(e=>e.memoryKey===chosen),rows=e?build(getState(),e,body.availability?.events?.[e.memoryKey]):[];
   const cells=(r:any)=>[r.spot,r.vix,r.futures,r.pdh,r.pdl,r.fullPcr,r.ceWall,r.peWall,r.ce?.price,r.pe?.price,r.ce?.oi,r.pe?.oi,r.ce?.pdh,r.ce?.pdl,r.pe?.pdh,r.pe?.pdl].map(v=>'<td>'+value(v)+'</td>').join('');
   const lane=(phase:string)=>'<details'+(phase==='EVENT'?' open':'')+'><summary>'+phase+' · exact checkpoints</summary><div class="mb-scroll"><table><thead><tr>'+['IST / offset','Spot','VIX','Futures','Spot PDH','Spot PDL','Full PCR','CE wall','PE wall','CE ₹','PE ₹','CE OI','PE OI','CE PDH','CE PDL','PE PDH','PE PDL','Evidence'].map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody>'+rows.filter(r=>r.phase===phase).map(r=>'<tr><th>'+esc(time(r.at)+' / '+(r.offset>0?'+':'')+r.offset+'m')+'</th>'+cells(r)+'<td>'+esc(r.status)+'</td></tr>').join('')+'</tbody></table></div></details>';
   const html=e?'<p class="mb-note">Event '+esc(time(e.at))+' IST · saved '+esc(time(body.availability?.events?.[e.memoryKey]))+' IST · exact fixed expiry and strike. Before/event evidence freezes at saved-event time; after is separate.</p><p><strong>WHY track:</strong> '+e.facts.map((f:any)=>esc(f.field)+' '+esc(f.before)+' → '+esc(f.after)).join(' · ')+'</p><p><strong>WHY NOT trade yet:</strong> no validated entry/exit model, fill evidence or risk gate. Missing quote/receipt/chain provenance stays blank.</p>'+lane('BEFORE')+lane('EVENT')+lane('AFTER'):'<p>Choose a qualified saved event.</p>';
   if(timeline.innerHTML!==html)timeline.innerHTML=html;
  }
  status.textContent=date+' · '+time(c.at)+' IST · '+p.events.length+' saved events available by cutoff · archive read limit '+(body.readLimitEvents??'unknown')+' · recovered/late records excluded'+(error?' · '+error:'');
  let html=p.events.slice(0,40).map(e=>'<details class="mb-box"><summary>'+esc(time(e.at)+' · '+e.symbol+' · '+e.expiry+' · '+e.strike+' CE/PE')+'</summary><p>Event CE ₹'+value(e.pair?.ce?.ltp)+' · PE ₹'+value(e.pair?.pe?.ltp)+'</p><p>'+e.facts.map((f:any)=>esc(f.field)+' '+esc(f.before)+' → '+esc(f.after)).join('<br>')+'</p><p class="mb-note">After-event observations only · not entry evidence</p><div class="mb-scroll"><table><thead><tr><th>Window</th><th>CE %</th><th>PE %</th><th>Status</th></tr></thead><tbody>'+[3,15,30].map(m=>{const r=byKey.get(e.memoryKey+'|'+m);return '<tr><td>+'+m+'m</td><td>'+value(r?.ceReturnPct)+'</td><td>'+value(r?.peReturnPct)+'</td><td>'+esc(r?.status||'Not available at cursor')+'</td></tr>';}).join('')+'</tbody></table></div></details>').join('')||'<p>No saved events qualified at this cursor. This does not establish no market events occurred.</p>';
  if(p.events.length>40)html+='<p class="mb-note">Showing first 40 qualified events. Select an index to narrow.</p>';
  if(results.innerHTML!==html)results.innerHTML=html;
 }
 button.onclick=async()=>{const c=getClock();if(!c?.active||!c.at||busy)return;const date=c.date,mine=++version;busy=true;error='';const controller=new AbortController();active=controller;render();
  try{const res=await fetch('/api/research/intraday-memory?date='+encodeURIComponent(date),{cache:'no-store',signal:controller.signal});const d=await res.json();if(mine!==version)return;if(!res.ok||d.ok!==true||d.tradeDate!==date||!d.availability||!Array.isArray(d.events)||!Array.isArray(d.responses))throw Error('Unqualified memory archive');body=d;}
  catch{if(mine===version){body=null;error='Saved event memory unavailable. Load to retry.';}}
  finally{if(mine===version){busy=false;active=null;render();}}
 };
 index.onchange=render;if(eventSelect)eventSelect.onchange=()=>{chosen=eventSelect.value;render();};render();return {render};
}
