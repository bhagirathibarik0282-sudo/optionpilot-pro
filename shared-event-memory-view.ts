import {eventParticipationContext} from './event-participation-context.js';
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
export function buildSharedEventTimeline(state:any,event:any,eventStoredAt:string,requestedOffsets?:number[]){
 const stamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
 const date=state?.date,at=stamp(event?.at),known=stamp(eventStoredAt),cutoff=stamp(state?.replay?.at);
 const open=Date.parse(date+'T09:15:00+05:30'),close=Date.parse(date+'T15:30:00+05:30');
 if(!state?.replay?.active||event?.tradeDate!==date||!['NIFTY','SENSEX','BANKNIFTY'].includes(event?.symbol)||
 !Number.isSafeInteger(event.strike)||event.strike<=0||!/^\d{4}-\d{2}-\d{2}$/.test(event.expiry)||event.expiry<date||
 !(at>=open&&at<=close&&known>=at&&known<=cutoff&&cutoff<=close))return [];
 const data=state.current?.[event.symbol]||{},offsets=requestedOffsets??[-15,-10,-5,-3,-1,0,1,3,5,10,15,30];
 if(offsets.length>40||offsets.some(n=>!Number.isInteger(n)||Math.abs(n)>60)||new Set(offsets).size!==offsets.length)return [];
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
   row.fullPcr=number(c.full_chain_oi_pcr);row.fullPcrSource=c.full_pcr_source;row.ceWall=number(c.call_wall_strike);row.peWall=number(c.put_wall_strike);
  }
  row.status=row.ce&&row.pe?'PAIR_OBSERVED':'PARTIAL';return row;
 });
}

/** Compare explicit fixed contracts using the same qualified checkpoint builder.
 * Event identity and event-time freeze never change. No ATM substitution, expiry
 * classification, causal claim, or trade signal. */
export function buildSharedEventComparison(state:any,event:any,eventStoredAt:string,secondStrike:unknown,secondExpiry:unknown,build:typeof buildSharedEventTimeline){
 const validDate=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(Date.parse(v+'T00:00:00Z')).toISOString().slice(0,10)===v;
 const strike=(v:any)=>typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v)?Number(v):NaN;
 const first=strike(event?.strike),other=strike(secondStrike),date=event?.tradeDate,expiry=event?.expiry;
 if(!validDate(date)||!validDate(expiry)||expiry<date||!Number.isSafeInteger(first)||first<=0)return [];
 const strikes=[first],expiries=[expiry];
 if(Number.isSafeInteger(other)&&other>0&&other<=1000000&&other!==first)strikes.push(other);
 if(validDate(secondExpiry)&&String(secondExpiry)>=date&&secondExpiry!==expiry)expiries.push(String(secondExpiry));
 return expiries.flatMap(exp=>strikes.map(k=>{
  const rows=build(state,{...event,expiry:exp,strike:k},eventStoredAt);
  const before=rows.find(r=>r.offset===-3),now=rows.find(r=>r.offset===0);
  const crossing=(side:'ce'|'pe')=>{
   const a=before?.[side],b=now?.[side];
   if(!a||!b||typeof a.pdl!=='number'||!Number.isFinite(a.pdl)||a.pdl<=0||a.pdl!==b.pdl)return 'UNAVAILABLE';
   return a.price>=a.pdl&&b.price<a.pdl?'OBSERVED_PDL_CROSSING':b.price<b.pdl?'ALREADY_BELOW_PDL':'NO_DOWN_CROSSING';
  };
  return {symbol:event.symbol,expiry:exp,strike:k,dte:(Date.parse(exp+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000,rows,ceCrossing:crossing('ce'),peCrossing:crossing('pe')};
 }));
}

export const SHARED_EVENT_MEMORY_HTML='<details id="mb-shared-memory" hidden><summary>Event Intelligence · Before / Event / After</summary><p class="mb-note">Saved event facts and separate +3/+15/+30m responses. Load once for the selected session; moving the master clock does not request data.</p><div class="mb-controls"><label>Index<select id="mb-shared-memory-index"><option>ALL</option><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><button id="mb-shared-memory-load" type="button">Load saved events</button></div><p id="mb-shared-memory-status" role="status"></p><label>Selected event<select id="mb-shared-memory-event"></select></label><div id="mb-shared-memory-timeline"></div><details><summary>Preferred teams · sector / heavyweight / FII &amp; DII</summary><button type="button" id="mb-shared-memory-context-load">Load saved market participation</button><div id="mb-shared-memory-context"></div></details><details id="mb-shared-memory-compare"><summary>Fixed premium pairs · Multi-DTE</summary><p class="mb-note">Event strike and expiry stay locked. Enter an optional second strike and exact expiry. No automatic ATM replacement.</p><div class="mb-controls"><label>Second strike<input id="mb-shared-memory-strike" type="number" min="1" max="1000000" step="1" placeholder="Optional"></label><label>Second expiry<input id="mb-shared-memory-expiry" type="date"></label><label>Checkpoint<select id="mb-shared-memory-offset"><option value="-15">-15m</option><option value="-10">-10m</option><option value="-5">-5m</option><option value="-3">-3m</option><option value="-1">-1m</option><option value="0" selected>0m</option><option value="1">+1m</option><option value="3">+3m</option><option value="5">+5m</option><option value="10">+10m</option><option value="15">+15m</option><option value="30">+30m</option></select></label></div><div id="mb-shared-memory-comparison"></div><details><summary>Option buyer hypothesis · research only</summary><div id="mb-shared-memory-buyer"></div></details></details><details><summary>Saved event list and responses</summary><div id="mb-shared-memory-results"></div></details></details>';

/** Browser-only display. No automatic requests, timers, persistence or order authority. */
export function installSharedEventMemory(getClock:()=>any,project:typeof projectSharedEventMemory,getState?:()=>any,build?:typeof buildSharedEventTimeline,compare?:typeof buildSharedEventComparison,buyer?:Function,getCash?:()=>any){
 const $=(id:string)=>document.getElementById('mb-shared-memory'+id) as any,root=$(''),button=$('-load'),status=$('-status'),results=$('-results'),index=$('-index');
 if(!root||!button||!status||!results||!index)return null;
 const contextLoad=$('-context-load'),contextView=$('-context');let contextBody:any=null,contextBusy=false,contextError=false,contextVersion=0,contextAbort:AbortController|null=null;
 const eventSelect=$('-event'),timeline=$('-timeline'),secondStrike=$('-strike'),secondExpiry=$('-expiry'),checkpoint=$('-offset'),comparison=$('-comparison'),buyerView=$('-buyer');let chosen='',comparisonIdentity='';
 const resetComparison=()=>{comparisonIdentity='';if(secondStrike)secondStrike.value='';if(secondExpiry)secondExpiry.value='';if(checkpoint)checkpoint.value='0';if(comparison)comparison.innerHTML='';if(buyerView)buyerView.innerHTML='';};
 const clearTimeline=()=>{chosen='';if(eventSelect)eventSelect.innerHTML='';if(timeline)timeline.innerHTML='';resetComparison();};
 let body:any=null,selectedDate='',version=0,busy=false,error='',active:AbortController|null=null;
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const time=(v:any)=>Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+19800000).toISOString().slice(11,16):'—';
 const value=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'—';
 function render(){
  const c=getClock(),date=c?.active?c.date||'':'';
  if(date!==selectedDate){contextVersion++;contextAbort?.abort();contextAbort=null;contextBody=null;contextBusy=false;contextError=false;if(contextView)contextView.innerHTML='';selectedDate=date;version++;active?.abort();active=null;busy=false;body=null;error='';clearTimeline();}
  root.hidden=!c?.active;button.disabled=busy||!date||!c?.at;
  if(!c?.active||!c.at){clearTimeline();results.innerHTML='';status.textContent='Select a valid shared replay timestamp.';return;}
  if(contextLoad)contextLoad.disabled=!body||contextBusy||!date||!c?.at;
  if(!body){if(contextView)contextView.innerHTML='';clearTimeline();results.innerHTML='';status.textContent=busy?'Loading saved memory…':error||'Load saved events for '+date+'.';return;}
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
   if(contextView){
    const ctx=e?eventParticipationContext(date,e.symbol,e.at,body.availability?.events?.[e.memoryKey],c.at,contextBody?.date===date?contextBody.snapshots:[],getCash?.()):null;
    const pct=(v:any)=>typeof v==='number'&&Number.isFinite(v)?'<span class="'+(v>0?'mb-up':v<0?'mb-down':'')+'">'+(v>0?'+':'')+v.toFixed(2)+'%</span>':'—';
    const align=(a:any)=>esc(a.state+' · '+a.up+' ↑ / '+a.down+' ↓ / '+a.flat+' ↔ · '+a.available+'/'+a.required);
    const display=ctx?'<p class="mb-note">Priority order by selected index; HDFC listed once. Banking and broad teams share HDFC; do not add their votes. Day % vs PDC; Δ vs -3m price. Latest saved receipt at/before checkpoint within 3m; quote ≤30s old at receipt. No official weights or contribution.</p><p class="mb-note">'+esc(contextBusy?'Loading saved quotes…':contextError?'Saved quote read failed':contextBody?'Saved quotes loaded'+(contextBody.truncated?' · limited history':''):'Load saved participation for this date')+'</p>'+ctx.checkpoints.map(r=>'<details'+(r.offset===0?' open':'')+'><summary>'+esc((r.offset>0?'+':'')+r.offset+'m · '+time(r.at)+' IST · '+r.status)+'</summary><p class="mb-note">Receipt '+esc(time(r.receiptAt))+' · Banks '+align(r.banks)+' · Broad '+align(r.broad)+'</p><table><thead><tr><th>Instrument</th><th>Day %</th><th>Δ vs -3m</th><th>Quote IST</th></tr></thead><tbody>'+r.moves.map(m=>'<tr><th>'+esc(m.label)+'</th><td>'+pct(m.dayPct)+'</td><td>'+pct(m.deltaFromBeforePct)+'</td><td>'+esc(time(m.quoteAt))+'</td></tr>').join('')+'</tbody></table></details>').join('')+'<h4>FII / DII · prior stored sessions · ₹ crore</h4><p class="mb-note">No same-day cash data in intraday replay; actual publication/storage availability unknown. Context only, not an entry gate. Totals are over available stored dates, not proof of consecutive trading sessions.</p><div class="mb-scroll"><table><thead><tr><th>Sessions</th><th>Dates</th><th>FII</th><th>DII</th><th>Combined</th></tr></thead><tbody>'+ctx.cashWindows.map(w=>'<tr><th>'+w.available+'/'+w.sessions+'</th><td>'+esc(w.dates.join(', '))+'</td><td>'+value(w.fii)+'</td><td>'+value(w.dii)+'</td><td>'+value(w.combined)+'</td></tr>').join('')+'</tbody></table></div>':'<p>Choose a qualified saved event.</p>';
    if(contextView.innerHTML!==display)contextView.innerHTML=display;
   }
   if(comparison&&secondStrike&&secondExpiry&&checkpoint&&compare){
    if(comparisonIdentity!==(e?.memoryKey||'')){resetComparison();comparisonIdentity=e?.memoryKey||'';}
    const offset=Number(checkpoint.value||0),pairs=e?compare(getState(),e,body.availability?.events?.[e.memoryKey],secondStrike.value,secondExpiry.value,build):[];
    const fmtCross=(x:string)=>x==='OBSERVED_PDL_CROSSING'?'Observed own-PDL crossing':x==='ALREADY_BELOW_PDL'?'Already below own PDL':x==='NO_DOWN_CROSSING'?'No down-crossing':'PDL evidence missing';
    const groups=[...new Set(pairs.map(p=>p.expiry))];
    let view=e?'<p class="mb-note">Locked event '+esc(e.symbol+' '+e.strike+' · '+e.expiry)+' · '+esc(time(e.at))+' IST. Each expiry is separate; DTE is calendar days, not weekly/monthly classification.</p>':'<p>Choose a qualified event.</p>';
    for(const exp of groups){
     const items=pairs.filter(p=>p.expiry===exp);
     view+='<details class="mb-box" open><summary>'+esc(exp)+' · DTE '+esc(items[0].dte)+'</summary>'+items.map(p=>{
      const row=p.rows.find(r=>r.offset===offset);
      return '<section class="mb-box"><strong>'+esc(p.strike)+' CE / PE · '+esc(row?time(row.at):'—')+' IST</strong><table><thead><tr><th>Side</th><th>Premium ₹</th><th>Own PDH</th><th>Own PDL</th><th>OI</th></tr></thead><tbody>'+['ce','pe'].map(side=>{const q=row?.[side];return '<tr><th>'+side.toUpperCase()+'</th><td>'+value(q?.price)+'</td><td>'+value(q?.pdh)+'</td><td>'+value(q?.pdl)+'</td><td>'+value(q?.oi)+'</td></tr>';}).join('')+'</tbody></table><p class="mb-note">Evidence: '+esc(row?.status||'GAP')+' · event -3m → 0m: CE '+esc(fmtCross(p.ceCrossing))+'; PE '+esc(fmtCross(p.peCrossing))+'</p></section>';
     }).join('')+'</details>';
    }
    if(e&&groups.length===2)for(const k of [...new Set(pairs.map(p=>p.strike))]){
     const ps=pairs.filter(p=>p.strike===k),ce=ps.filter(p=>p.ceCrossing==='OBSERVED_PDL_CROSSING').length,pe=ps.filter(p=>p.peCrossing==='OBSERVED_PDL_CROSSING').length;
     view+='<p class="mb-note">'+esc(k)+' · same-strike observed PDL crossings across selected expiries: CE '+ce+'/'+ps.length+' · PE '+pe+'/'+ps.length+'. Missing is not a negative signal; no buyer entry authorized.</p>';
    }
    if(comparison.innerHTML!==view)comparison.innerHTML=view;
    if(buyerView&&buyer){
     const decisions=e?buyer(getState(),e,body.availability?.events?.[e.memoryKey],pairs,build):[];
     const html='<p class="mb-note">Unvalidated V1: two-expiry own-PDL crossing, opposite premium strengthening, spot/full PCR agreement, next exact sample confirmation. 0–4 DTE; structural sampled stop, +1R then half-R trail, maximum 15m. No fill, lot size or net P&L.</p>'+decisions.map((d:any)=>'<section class="mb-box"><strong>'+esc(d.strike+' '+(d.side||'—')+' · '+(d.expiry||'—')+' · '+d.status)+'</strong><p>WHY: '+esc(d.why.join(' · ')||'No qualified hypothesis')+'</p><p>WHY NOT: '+esc(d.whyNot.join(' · '))+'</p><p>Sample entry '+esc(d.entry?time(d.entry.at):'—')+' ₹'+value(d.entry?.price)+' · initial SL '+value(d.initialStop)+' · sample exit '+esc(d.exit?time(d.exit.at):'—')+' ₹'+value(d.exit?.price)+' · '+esc(d.exit?.reason||'—')+'</p><details><summary>Sampled stop / TSL timeline</summary><div class="mb-scroll"><table><thead><tr><th>IST</th><th>Observed LTP</th><th>Stop after sample</th></tr></thead><tbody>'+d.trail.map((x:any)=>'<tr><td>'+esc(time(x.at))+'</td><td>'+value(x.price)+'</td><td>'+value(x.stop)+'</td></tr>').join('')+'</tbody></table></div></details></section>').join('');
     if(buyerView.innerHTML!==html)buyerView.innerHTML=html;
    }
   }
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
 if(contextLoad)contextLoad.onclick=async()=>{const c=getClock();if(!c?.active||!c.at||contextBusy)return;const date=c.date,mine=++contextVersion;contextBusy=true;contextError=false;const controller=new AbortController();contextAbort=controller;render();
  try{const res=await fetch('/api/research/background-quotes/history?date='+encodeURIComponent(date),{cache:'no-store',signal:controller.signal});const d=await res.json();if(mine!==contextVersion)return;if(!res.ok||d.date!==date||!Array.isArray(d.snapshots)||d.snapshots.length>256)throw Error('Invalid saved participation');contextBody=d;}
  catch{if(mine===contextVersion){contextError=true;contextBody=null;}}
  finally{if(mine===contextVersion){contextBusy=false;contextAbort=null;render();}}
 };
 index.onchange=render;for(const control of [secondStrike,secondExpiry,checkpoint])if(control)control.onchange=render;if(eventSelect)eventSelect.onchange=()=>{chosen=eventSelect.value;render();};render();return {render};
}
