import { renderMarketBookLiveContext } from './market-book-reading-guide.js';
import { OI_WALL_REPLAY_HTML, OI_WALL_REPLAY_CSS } from './oi-wall-replay.js';
/** Chapter 6: presentation-only projections of the existing Kite feed. */
export function deriveOiStudioSnapshot(payload:any,symbol:string){
 const n=(x:any)=>typeof x==='number'&&Number.isFinite(x),at=(x:any)=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)?Date.parse(x):NaN;
 const day=(x:number)=>Number.isFinite(x)?new Date(x+19800000).toISOString().slice(0,10):'';
 const now=at(payload?.serverTime),s=payload?.snapshot;
 if(!payload?.connected||payload.source!=='KITE_WEBSOCKET_FULL'||!s?.runtimeId||!Number.isFinite(at(s.asOf))||day(now)!==s.tradeDate||now-at(s.asOf)<0||now-at(s.asOf)>4000)return null;
 const matches=s.indices?.filter((r:any)=>r.symbol===symbol);if(matches?.length!==1)return null;
 const a=matches[0],q=a.pcrSnapshot,c=q?.coverage,checked=at(q?.checkedAt),cycle=at(q?.cycleStartedAt),rows=q?.strikeRows;
 if(q?.source!=='KITE_REST_FULL_EXPIRY_SNAPSHOT'||q.state!=='COMPLETE'||!c?.complete||!Array.isArray(rows)||rows.length!==c.expected||c.freshOi!==c.expected||!rows.length||rows.length>3000||day(checked)!==s.tradeDate||!Number.isFinite(cycle)||cycle>checked||checked-cycle>60000||checked>now||now-checked>90000||(!/^\d{4}-\d{2}-\d{2}$/.test(a.expiry)||a.expiry<s.tradeDate||!Number.isFinite(Date.parse(a.expiry+'T00:00:00Z'))||new Date(a.expiry+'T00:00:00Z').toISOString().slice(0,10)!==a.expiry||!a.expiries?.includes(a.expiry)))return null;
 const byStrike=new Map<number,any>(),seen=new Set<string>(),tokens=new Set<number>(),times:number[]=[];let ce=0,pe=0;
 for(const r of rows){const time=at(r.sourceAt),key=r.strike+'|'+r.side;
  if(r.symbol!==symbol||r.expiry!==a.expiry||!n(r.strike)||r.strike<=0||!['CE','PE'].includes(r.side)||!Number.isInteger(r.token)||r.token<=0||tokens.has(r.token)||seen.has(key)||!n(r.oi)||r.oi<0||day(time)!==s.tradeDate||checked-time>30000||time-checked>5000)return null;
  seen.add(key);tokens.add(r.token);times.push(time);let pair=byStrike.get(r.strike);if(!pair){pair={strike:r.strike};byStrike.set(r.strike,pair);}pair[r.side]=r;
  if(r.side==='CE')ce+=r.oi;else pe+=r.oi;
 }
 const pairs=[...byStrike.values()].sort((a,b)=>a.strike-b.strike);
 if(pairs.some(r=>!r.CE||!r.PE)||!n(ce)||ce<=0||!n(pe)||Math.max(...times)-Math.min(...times)>30000||ce!==q.ceTotal||pe!==q.peTotal||!n(q.fullPcr)||Math.abs(pe/ce-q.fullPcr)>Math.max(1,pe/ce)*1e-12)return null;
 // O(n) payout sweep across listed strikes. Tied minima remain a range.
 let payout=pairs.reduce((sum,r)=>sum+r.PE.oi*(r.strike-pairs[0].strike),0),cumCE=0,remainingPE=pe;
 const payouts=pairs.map((r,i)=>{if(i)payout+=(r.strike-pairs[i-1].strike)*(cumCE-remainingPE);const value=payout;cumCE+=r.CE.oi;remainingPE-=r.PE.oi;return {strike:r.strike,value};});
 const minimum=Math.min(...payouts.map(r=>r.value)),eps=Math.max(1,Math.abs(minimum))*1e-12;
 const mp=payouts.filter(r=>Math.abs(r.value-minimum)<=eps).map(r=>r.strike);
 const wall=(side:string)=>{const sorted=[...pairs].sort((a,b)=>b[side].oi-a[side].oi||a.strike-b.strike),top=sorted[0];return {strike:top.strike,oi:top[side].oi,ties:sorted.filter(r=>r[side].oi===top[side].oi).map(r=>r.strike),runnerUp:sorted[1]?.[side].oi??null};};
 const sp=a.spot,spAt=at(sp?.observedAt),receipt=at(sp?.receivedAt),spotOk=sp?.state==='LIVE'&&sp.identity?.role==='SPOT'&&sp.identity.symbol===symbol&&n(sp.price)&&sp.price>0&&day(spAt)===s.tradeDate&&now-spAt>=-5000&&now-spAt<=30000&&now-receipt>=0&&now-receipt<=30000;
 const spot=spotOk?sp.price:null,anchor=spot===null?null:pairs.reduce((best,r)=>Math.abs(r.strike-spot)<Math.abs(best.strike-spot)?r:best,pairs[0]).strike;
 const gap=spot===null?null:spot<mp[0]?spot-mp[0]:spot>mp[mp.length-1]?spot-mp[mp.length-1]:0;
 return {symbol,expiry:a.expiry,date:s.tradeDate,runtime:s.runtimeId,checked,cycle,sourceMin:Math.min(...times),sourceMax:Math.max(...times),rows:pairs,ce,pe,pcr:pe/ce,mp,spot,spotAt:spotOk?spAt:null,anchor,gap,callWall:wall('CE'),putWall:wall('PE'),quoteContext:a};
}

export const OI_WALL_STUDIO_HTML=`<section id="oi-wall-studio" hidden aria-label="OI and wall workspace"><header class="ows-header"><h3>OI + Walls</h3><span id="ows-status" role="status">WAIT · Kite source</span></header>${OI_WALL_REPLAY_HTML}<div id="ows-live-empty" class="ows-wait" role="status" hidden><strong>Live feed unavailable</strong><p>Live option prices need a connected Kite feed. Saved sessions are available separately below.</p><button type="button" data-ows-open-recorded>Open saved records</button></div><div id="ows-live-workspace"><div class="ows-controls"><label>Index<select id="ows-index"><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><label>Expiry<select id="ows-expiry"><option value="">Waiting for inventory</option></select></label></div><div id="ows-windows" class="ows-buttons" role="group" aria-label="OI comparison window">${[1,3,6,15,30].map(m=>`<button type="button" data-ows-window="${m}" aria-pressed="${m===3}">${m}m</button>`).join('')}</div><div id="ows-walls" class="ows-two"></div><div id="ows-context" class="ows-context"></div><section class="ows-research"><div class="ows-heading"><h3>Relationship research</h3><small>Evidence · recorded outcomes · canonical candidate</small></div><div id="ows-research-tabs" class="ows-buttons" role="group" aria-label="Research view"><button type="button" data-ows-research="evidence" aria-pressed="true">Evidence</button><button type="button" data-ows-research="outcome" aria-pressed="false">After event</button><button type="button" data-ows-research="candidate" aria-pressed="false">Candidate</button></div><div id="ows-research-result" aria-live="polite"></div></section><h3>Premium watch</h3><div class="ows-two" id="ows-premium-controls"><label>CE strike<select id="ows-ce"></select></label><label>PE strike<select id="ows-pe"></select></label></div><div id="ows-premiums" class="ows-two" aria-live="polite"></div><div id="ows-view-tabs" class="ows-buttons" role="group" aria-label="OI chart view"><button type="button" data-ows-view="ladder" aria-pressed="true">Ladder</button><button type="button" data-ows-view="columns" aria-pressed="false">Columns</button><button type="button" data-ows-view="wheel" aria-pressed="false">Wheel</button></div><div class="ows-legend">CE <i class="ows-dot ows-ce"></i> · PE <i class="ows-dot ows-pe"></i> · <span data-ows-state="ADDING">↑ Adding</span> · <span data-ows-state="SHEDDING">↓ Shedding</span> · → Unchanged</div><div id="ows-wheel-tabs" class="ows-buttons" role="group" aria-label="Wheel data" hidden><button type="button" data-ows-wheel="oi" aria-pressed="true">Option OI</button><button type="button" data-ows-wheel="stocks" aria-pressed="false">Heavyweights</button><button type="button" data-ows-wheel="sectors" aria-pressed="false">Sectors</button></div><div id="ows-chart"></div><details><summary>Source, relationship science &amp; wall migration</summary><div id="ows-source"></div><div id="ows-migration"></div><p>Full PCR = total PE OI ÷ total CE OI. Walls = largest OI strikes. Max Pain minimizes aggregate expiry intrinsic payout. These share the same chain; they are not independent trade votes. Premium also responds to spot, IV and DTE. Aggregate OI does not identify buyer/seller intent. IV/Greeks are unavailable from this feed.</p></details></div></section>`;

export const OI_WALL_STUDIO_CSS=`${OI_WALL_REPLAY_CSS}
#oi-wall-studio{--ows-bg:#101a1b;--ows-panel:#1a292a;--ows-ink:#e5f2ed;--ows-muted:#afc8bd;--ows-line:#39524a;--ows-ce:#ff839b;--ows-pe:#62dec3;--ows-gold:#ebc974;color:var(--ows-ink);background:var(--ows-bg);border:1px solid var(--ows-line);border-radius:14px;padding:14px;margin:12px 0;font-variant-numeric:tabular-nums;min-width:0}
#oi-wall-studio[hidden]{display:none!important}#oi-wall-studio[data-live-empty="true"] #ows-live-workspace{display:none!important}#oi-wall-studio #ows-live-empty button{min-height:44px;font-size:16px}#oi-wall-studio *{box-sizing:border-box}#oi-wall-studio .ows-header,#oi-wall-studio .ows-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}#market-book #oi-wall-studio h3{margin:0;font-size:16px;font-weight:500}#oi-wall-studio .ows-controls,#oi-wall-studio .ows-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:10px 0}#market-book #oi-wall-studio label{font-size:12px;min-width:0;display:block}#market-book #oi-wall-studio select{font-size:16px;min-height:44px;width:100%;max-width:100%;margin-top:5px}#oi-wall-studio .ows-buttons{display:flex;gap:6px;margin:12px 0}#market-book #oi-wall-studio .ows-buttons button{flex:1;min-width:0;font-size:12px;padding:8px 4px;min-height:44px}#oi-wall-studio button[aria-pressed=true]{background:var(--ows-ink)!important;color:var(--ows-bg)!important;border-color:transparent!important}#oi-wall-studio .ows-wall,#oi-wall-studio .ows-premium,#oi-wall-studio .ows-research{background:var(--ows-panel);border-radius:10px;padding:11px;min-width:0}#oi-wall-studio .ows-wall strong,#oi-wall-studio .ows-premium strong{display:block;font-size:25px;font-weight:500;margin:5px 0;overflow-wrap:anywhere}#oi-wall-studio small,#oi-wall-studio .ows-legend,#oi-wall-studio details,#ows-status{font-size:11px;color:var(--ows-muted);overflow-wrap:anywhere}#oi-wall-studio small{display:block;margin-top:4px}#oi-wall-studio .ows-context{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;margin:12px 0}#oi-wall-studio .ows-research{margin:14px 0}#market-book #oi-wall-studio table{table-layout:fixed;width:100%;border-collapse:collapse;font-size:12px}#market-book #oi-wall-studio th,#market-book #oi-wall-studio td{white-space:normal;overflow-wrap:anywhere;position:static;padding:7px 4px;font-weight:400;border-bottom:1px solid var(--ows-line);background:transparent;vertical-align:top}#oi-wall-studio .ows-ladder th:nth-child(2){width:26%;text-align:center}#oi-wall-studio .ows-ladder td:last-child{text-align:right}#oi-wall-studio .ows-ladder b{font-size:17px;font-weight:500}#oi-wall-studio [data-ows-state=ADDING]{color:var(--ows-pe)}#oi-wall-studio [data-ows-state=SHEDDING]{color:var(--ows-ce)}#oi-wall-studio .ows-pulse{display:inline-block;font-size:11px;margin-top:4px}#oi-wall-studio .ows-blink{animation:ows-change .6s ease-in-out 3 both}@keyframes ows-change{0%,100%{opacity:1}50%{opacity:.35;transform:translateY(-1px)}}#oi-wall-studio .ows-dot{display:inline-block;width:8px;height:8px;border-radius:2px}#oi-wall-studio .ows-ce{background:var(--ows-ce)}#oi-wall-studio .ows-pe{background:var(--ows-pe)}#oi-wall-studio .ows-columns{display:flex;gap:6px;height:230px;padding-top:22px;margin:12px 0 24px}#oi-wall-studio .ows-group{flex:1;min-width:0;text-align:center}#oi-wall-studio .ows-bars{height:185px;display:flex;gap:3px;align-items:end;justify-content:center}#oi-wall-studio .ows-bar{width:36%;max-width:30px;position:relative;border-radius:4px 4px 0 0}#oi-wall-studio .ows-bar span{position:absolute;bottom:calc(100% + 3px);left:50%;transform:translateX(-50%);font-size:11px}#oi-wall-studio .ows-wheel-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:12px;margin:15px 0}#oi-wall-studio .ows-wheel{width:190px;max-width:100%;aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--ows-ce) 0 var(--ows-angle),var(--ows-pe) var(--ows-angle) 360deg);position:relative}#oi-wall-studio .ows-wheel:before{content:'';position:absolute;inset:20px;background:var(--ows-bg);border-radius:50%}#oi-wall-studio .ows-wheel>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px}#oi-wall-studio details{margin-top:12px}#oi-wall-studio summary{padding:8px 0;cursor:pointer}#oi-wall-studio .ows-wait{padding:12px 0;color:var(--ows-gold);font-size:12px}#oi-wall-studio .ows-event{padding:8px 0;border-bottom:1px solid var(--ows-line)}#oi-wall-studio .ows-event summary{font-size:12px}#oi-wall-studio .ows-source-row{padding:7px 0;border-bottom:1px solid var(--ows-line);font-size:12px}@media(max-width:420px){#oi-wall-studio{padding:10px}#oi-wall-studio .ows-wall strong,#oi-wall-studio .ows-premium strong{font-size:22px}#oi-wall-studio .ows-wheel{width:135px}#oi-wall-studio .ows-columns{gap:3px}#oi-wall-studio .ows-controls{grid-template-columns:1fr 1fr}}@media(prefers-reduced-motion:reduce){#oi-wall-studio .ows-blink{animation:none}}`;

/** One component, no sockets/provider calls. Selection uses the existing stream. */
export function installOiWallStudio(){
 const root=document.getElementById('oi-wall-studio');if(!root)return null;
 const $=(id:string)=>document.getElementById('ows-'+id) as any;
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const n=(v:any)=>typeof v==='number'&&Number.isFinite(v),fmt=(v:any,d=2)=>n(v)?v.toLocaleString('en-IN',{maximumFractionDigits:d}):'—';
 const signed=(v:any,d=2)=>n(v)?(v>0?'+':'')+fmt(v,d):'—';
 const time=(v:any)=>{const at=typeof v==='number'?v:Date.parse(v);return Number.isFinite(at)?new Date(at).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false}):'—';};
 const state=(v:any)=>!n(v)?'WAIT':v>0?'ADDING':v<0?'SHEDDING':'UNCHANGED';
 const table=(head:string[],rows:any[][])=>'<table><thead><tr>'+head.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map((v,i)=>i?'<td>'+v+'</td>':'<th scope="row">'+v+'</th>').join('')+'</tr>').join('')+'</tbody></table>';
 const researchPaint=new WeakMap<object,string>();
 const paintResearch=(html:string)=>{const node=$('research-result');if(researchPaint.get(node)!==html){node.innerHTML=html;researchPaint.set(node,html);}};
 const revoked=new Set<string>(),histories=new Map<string,any[]>(),pulses=new Map<string,any>(),choices:any={};
 let symbol='NIFTY',windowMinutes=3,view='ladder',wheel='oi',research='evidence',page=-1,payload:any=null,recorded:any={},recordedDate='',identity='',timer:any=null,candidate:any=null,candidateState='Not loaded',candidateGeneration=0;
 const choice=()=>choices[symbol]||(choices[symbol]={});
 const context=()=>payload?.snapshot?.indices?.find((a:any)=>a.symbol===symbol);
 const key=(s:any)=>s.runtime+'|'+s.date+'|'+s.symbol+'|'+s.expiry;
 const dispatch=(detail:any)=>{candidate=null;candidateGeneration++;window.dispatchEvent(new CustomEvent('optionpilot:live-selection',{detail:{symbol,...detail}}));};
 function projectQuote(q:any,strike:number|null,side:string){
  const now=Date.parse(payload?.serverTime),at=Date.parse(q?.observedAt),receipt=Date.parse(q?.receivedAt),i=q?.identity;
  return payload?.connected&&q?.state==='LIVE'&&i?.symbol===symbol&&i.role==='OPTION'&&i.expiry===context()?.expiry&&i.strike===strike&&i.side===side&&n(q.price)&&q.price>0&&Number.isFinite(at)&&now-at>=-5000&&now-at<=30000&&now-receipt>=0&&now-receipt<=30000?q:null;
 }
 function options(node:any,values:any[],selected:any){const html=values.length?values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join(''):'<option value="">Unavailable</option>';if(node.innerHTML!==html)node.innerHTML=html;node.value=selected===null||selected===undefined?'':String(selected);}
 const badge=(delta:any)=>'<span class="ows-pulse" data-ows-state="'+state(delta)+'">'+(n(delta)?delta>0?'↑ ':delta<0?'↓ ':'→ ':'')+state(delta)+'</span>';
 function pulse(q:any,strike:number,side:string,now:number){
  const valid=projectQuote(q,strike,side);if(!valid)return '<small>Tick OI · WAIT</small>';
  const p=pulses.get(valid.identity.token),remaining=p?Math.max(0,p.until-now):0;
  return '<small class="ows-pulse'+(remaining>0?' ows-blink':'')+'" data-ows-state="'+state(p?.delta)+'"'+(remaining>0?' style="animation-delay:-'+Math.floor(1800-remaining)+'ms"':'')+'>Last ΔOI '+signed(p?.delta,0)+' · '+state(p?.delta)+' · '+time(p?.changedAt||valid.observedAt)+'</small>';
 }
 function snapshotHistory(s:any){return s?histories.get(key(s))||[]:[];}
 function baseline(s:any){if(!s)return null;const target=s.cycle-windowMinutes*60000;return snapshotHistory(s).find(r=>r.cycle>=target-1000&&r.cycle<=target+1000&&r.rows.length===s.rows.length&&r.rows.every((v:any,i:number)=>v.strike===s.rows[i].strike&&v.CE.token===s.rows[i].CE.token&&v.PE.token===s.rows[i].PE.token))||null;}
 function render(){
  if(page!==5)return;
  const noFeed=payload?.connected!==true;root.setAttribute('data-live-empty',String(noFeed));const empty=$('live-empty');if(empty)empty.hidden=!noFeed||$('live-workspace').hidden;
  const a=context(),projected=deriveOiStudioSnapshot(payload,symbol),s=projected&&!revoked.has(key(projected)+'|'+projected.cycle)?projected:null,c=choice(),now=Date.now(),history=snapshotHistory(s),b=baseline(s);
  const expiredCandidate=candidate&&now-candidate.loadedAt>30000;if(expiredCandidate){candidate=null;candidateState='Expired · refresh canonical card';}
  $('status').textContent=s?'LIVE · OI '+time(s.checked)+' IST':(payload?.connectionState||'WAIT')+' · qualified OI pending';
  const archive=recorded[symbol];if(!a?.expiry&&!c.expiry&&archive?.expiry)c.expiry=archive.expiry;options($('expiry'),a?.expiries||archive?.expiries||[],a?.expiry||c.expiry);$('index').value=symbol;
  if(a?.expiry){c.expiry=a.expiry;if(!a.strikes?.includes(c.ce))c.ce=a.ceStrike??a.strike??null;if(!a.strikes?.includes(c.pe))c.pe=a.peStrike??a.strike??null;}
  options($('ce'),a?.strikes||[],c.ce);options($('pe'),a?.strikes||[],c.pe);
  for(const [id,attr,val] of [['windows','window',String(windowMinutes)],['research-tabs','research',research],['view-tabs','view',view]]){
   const node=$(id);node.querySelectorAll?.('[data-ows-'+attr+']').forEach((button:any)=>button.setAttribute('aria-pressed',String(button.dataset['ows'+attr[0].toUpperCase()+attr.slice(1)]===val)));
  }
  const wait='<div class="ows-wait">Waiting for a complete fresh same-expiry OI snapshot. Missing ≠ zero.</div>';
  if(s){
   $('walls').innerHTML=[['CE',s.callWall,b?.callWall],['PE',s.putWall,b?.putWall]].map(([side,w,old]:any)=>{const row=s.rows.find((r:any)=>r.strike===w.strike),prior=b?.rows.find((r:any)=>r.strike===w.strike),d=prior?row[side].oi-prior[side].oi:null;return '<div class="ows-wall"><span>'+side+' top wall</span><strong>'+esc(w.ties.join(' / '))+'</strong><small>OI '+fmt(w.oi/100000)+'L · window Δ '+signed(n(d)?d/100000:null)+'L</small>'+badge(d)+'<small>'+(old?old.ties.join(' / ')+' → '+w.ties.join(' / '):'Wall baseline pending')+'</small></div>';}).join('');
   $('context').innerHTML='<span>Spot <b>'+fmt(s.spot)+'</b></span><span>ATM <b>'+fmt(s.anchor,0)+'</b></span><span>Max Pain <b>'+esc(s.mp.join('–'))+'</b></span><span>Spot − MP range <b>'+signed(s.gap)+'</b></span>';
  }else{$('walls').innerHTML=wait;$('context').textContent='Spot / Max Pain / walls · unavailable';}
  $('premiums').innerHTML=['CE','PE'].map(side=>{const strike=c[side.toLowerCase()],q=projectQuote(a?.[side==='CE'?'studioCE':'studioPE'],strike,side),r=s?.rows.find((r:any)=>r.strike===strike)?.[side],prior=b?.rows.find((r:any)=>r.strike===strike)?.[side],delta=r&&prior?r.oi-prior.oi:null;
   const baselinePrice=prior&&n(prior.price)&&Number.isFinite(Date.parse(prior.priceAt))&&b.checked-Date.parse(prior.priceAt)<=30000?prior.price:null,change=q&&n(baselinePrice)&&Math.abs(Date.parse(q.observedAt)-s.checked)<=30000?q.price-baselinePrice:null;
   const dte=a?.expiry&&payload?.snapshot?.tradeDate?Math.round((Date.parse(a.expiry)-Date.parse(payload.snapshot.tradeDate))/86400000):null;
   return '<article class="ows-premium"><span>'+side+' · '+esc(strike)+' · DTE '+fmt(dte,0)+'</span><strong>₹'+fmt(q?.price)+'</strong><small>Window Δ₹ '+signed(change)+' · '+fmt(n(change)&&baselinePrice>0?change/baselinePrice*100:null)+'%</small><small>OI '+fmt(q&&n(q.oi)?q.oi/100000:null)+'L · snapshot Δ '+signed(n(delta)?delta/100000:null)+'L</small>'+pulse(q,strike,side,now)+'<small>Quote '+time(q?.observedAt)+' IST</small></article>';
  }).join('');
  if(research==='evidence'){
   paintResearch(s?table(['Measure',windowMinutes+'m comparison'],[
    ['CE / PE total ΔOI',signed(b?(s.ce-b.ce)/100000:null)+'L / '+signed(b?(s.pe-b.pe)/100000:null)+'L'],
    ['Full PCR',b?fmt(b.pcr,4)+' → '+fmt(s.pcr,4):fmt(s.pcr,4)+' · baseline pending'],
    ['PCR attribution',b?'PE growth '+signed(b.pe>0?(s.pe/b.pe-1)*100:null)+'% · CE growth '+signed((s.ce/b.ce-1)*100)+'%':'Waiting for exact baseline'],
    ['Max Pain',esc(b?b.mp.join('–')+' → '+s.mp.join('–'):s.mp.join('–'))],
    ['Spot / MP-range gap',signed(s.gap)+' points'],
    ['Endpoints',b?time(b.checked)+' → '+time(s.checked)+' IST':'Collecting '+windowMinutes+'m history'],
   ])+'<small>Observed relationships · no validated probability or trade score</small>':wait);
  }
  if(research==='outcome'){
   const m=recorded[symbol],match=m&&m.expiry===(a?.expiry||c.expiry),events=match?(m.positioning?.timeline||[]).slice(-10):[];
   paintResearch('<small>RECORDED · '+esc(recordedDate||'No session loaded')+' · '+esc(symbol)+' / '+esc(m?.expiry||'No expiry')+'</small>'+(events.length?events.map((e:any)=>'<details class="ows-event"><summary>'+esc(time(e.minute_bucket)+' · '+(e.event||e.side+' wall migration')+' · strike '+e.responseStrike)+'</summary><small>Exact expiry '+esc(m.expiry)+' · '+time(e.previousAt)+' → '+time(e.minute_bucket)+'</small>'+table(['After','CE Δ %','PE Δ %'],[1,3,6,15,30].map(min=>{const r=e.responses?.find((r:any)=>r.minutes===min);return [min+'m',fmt(r?.sides?.[0]?.percent)+'%',fmt(r?.sides?.[1]?.percent)+'%'];}))+'<small>'+esc((e.responses||[]).filter((r:any)=>[1,3,6,15,30].includes(r.minutes)).map((r:any)=>r.minutes+'m: '+r.sides.map((v:any)=>v.type+' '+v.state).join(' / ')).join(' · '))+'</small></details>').join(''):'<div class="ows-wait">'+(match?'No qualifying recorded events.':'Load recorded data for the selected index and exact expiry.')+'</div>')+'<button type="button" data-ows-recorded-settings>Choose recorded date / load data</button><small>Retrospective endpoint response · not live or net P&amp;L</small>');
  }
  if(research==='candidate'){
   const card=candidate?.data?.decisionCard,contract=card?.contract,ready=card?.state==='CANDIDATE_READY'&&card.authority==='EXECUTION_CANDIDATE_SELECTOR_V2'&&card.identityLocked===true&&card.decisionId&&card.candidateKey&&contract?.candidateKey===card.candidateKey&&contract?.decisionId===card.decisionId&&contract?.symbol===symbol;
   paintResearch('<div class="ows-wait">'+esc(symbol==='BANKNIFTY'?'MONTHLY OBSERVATION ONLY':ready?'CANONICAL BUYER CANDIDATE':candidate?'WAIT · canonical Business Card':candidateState)+'</div>'+(candidate?table(['Canonical source','Value'],[['Authority',esc(card?.authority)],['Contract',ready?esc(contract.expiryDate+' · '+contract.strike+' '+contract.optionSide):'No eligible contract'],['Decision ID',esc(ready?card.decisionId:null)],['Candidate key',esc(ready?card.candidateKey:null)],['Source checked',time(candidate.loadedAt)+' IST'],['Selector blockers',esc(candidate.data.selector?.reasonCodes?.join(' · ')||'None supplied')]]):'')+(symbol==='BANKNIFTY'?'':'<button type="button" data-ows-candidate-refresh>Refresh canonical card</button>')+'<small>Existing selector only · OI research cannot promote a candidate · no orders</small>');
  }
  $('wheel-tabs').hidden=view!=='wheel';
  $('wheel-tabs').querySelectorAll?.('[data-ows-wheel]').forEach((button:any)=>button.setAttribute('aria-pressed',String(button.dataset.owsWheel===wheel)));
  if(view==='wheel'&&wheel!=='oi'){
   const html=renderMarketBookLiveContext(payload,symbol,8,false,{wheel:true,metric:wheel});
   const node=$('chart');if(node.innerHTML!==html){const open=new Set(Array.from(node.querySelectorAll?.('details[open]')||[]).map((d:any)=>d.getAttribute('data-live-detail')));node.innerHTML=html;node.querySelectorAll?.('details[data-live-detail]').forEach((d:any)=>{if(open.has(d.getAttribute('data-live-detail')))d.open=true;});}
   $('source').textContent='Kite shared quote universe · previous-close change · unweighted breadth; option OI remains separate';$('migration').innerHTML='';return;
  }
  if(!s){$('chart').innerHTML=wait;$('source').textContent='Qualified chain unavailable · no fabricated fallback';$('migration').innerHTML='';return;}
  const at=s.rows.findIndex((r:any)=>r.strike===s.anchor),shown=at<0?[]:s.rows.slice(Math.max(0,at-3),at+4),max=Math.max(1,...shown.flatMap((r:any)=>[r.CE.oi,r.PE.oi]));
  const cell=(r:any,side:string)=>{const q=a?.oiQuotes?.find((q:any)=>q.identity?.strike===r.strike&&q.identity.side===side),prior=b?.rows.find((v:any)=>v.strike===r.strike)?.[side],delta=prior?r[side].oi-prior.oi:null;return '<b>'+fmt(r[side].oi/100000)+'L</b><small>'+windowMinutes+'m Δ '+signed(n(delta)?delta/100000:null)+'L</small>'+badge(delta)+pulse(q,r.strike,side,now);};
  if(view==='ladder')$('chart').innerHTML=shown.length?'<table class="ows-ladder"><thead><tr><th>CE OI</th><th>Strike</th><th>PE OI</th></tr></thead><tbody>'+shown.map((r:any)=>'<tr><td>'+cell(r,'CE')+'</td><th scope="row">'+fmt(r.strike,0)+'<small>'+[r.strike===s.anchor?'ATM':'',s.callWall.ties.includes(r.strike)?'CE WALL':'',s.putWall.ties.includes(r.strike)?'PE WALL':'',s.mp.includes(r.strike)?'MP':''].filter(Boolean).join(' · ')+'</small></th><td>'+cell(r,'PE')+'</td></tr>').join('')+'</tbody></table>':'<div class="ows-wait">Fresh spot required for nearby-strike ladder.</div>';
  if(view==='columns')$('chart').innerHTML=shown.length?'<div class="ows-columns" role="img" aria-label="Seven nearby strikes; CE and PE snapshot OI in lakh">'+shown.map((r:any)=>'<div class="ows-group"><div class="ows-bars">'+['CE','PE'].map(side=>'<div class="ows-bar ows-'+side.toLowerCase()+'" style="height:'+r[side].oi/(max*1.15)*100+'%"><span>'+fmt(r[side].oi/100000,1)+'</span></div>').join('')+'</div><small>'+r.strike+'</small></div>').join('')+'</div><small>OI in lakh · zero baseline · max '+fmt(max*1.15/100000)+'L</small>':'<div class="ows-wait">Fresh spot required for nearby-strike columns.</div>';
  if(view==='wheel')$('chart').innerHTML='<div class="ows-wheel-row"><div class="ows-wheel" style="--ows-angle:'+s.ce/(s.ce+s.pe)*360+'deg" role="img" aria-label="Full-expiry CE and PE OI shares"><span>'+fmt((s.ce+s.pe)/100000)+'L</span></div><div><div>CE '+fmt(s.ce/100000)+'L<small>'+fmt(s.ce/(s.ce+s.pe)*100)+'%</small></div><div>PE '+fmt(s.pe/100000)+'L<small>'+fmt(s.pe/(s.ce+s.pe)*100)+'%</small></div></div></div>';
  $('source').innerHTML='<div class="ows-source-row">'+esc(symbol)+' · expiry '+esc(s.expiry)+' · '+s.rows.length+' strikes / '+s.rows.length*2+' exact contracts</div><div class="ows-source-row">OI source '+time(s.sourceMin)+' → '+time(s.sourceMax)+' IST · checked '+time(s.checked)+'</div><div class="ows-source-row">Window '+windowMinutes+'m · '+(b?time(b.checked)+' → '+time(s.checked):'Exact baseline pending')+' · '+history.length+' bounded browser snapshots</div><div class="ows-source-row">Last ΔOI uses exact-contract Kite FULL updates; window Δ and charts use complete 1-minute OI snapshots. Different clocks stay labelled.</div><div class="ows-source-row">Top / runner-up OI: CE '+fmt(s.callWall.oi/100000)+' / '+fmt((s.callWall.runnerUp??0)/100000)+'L · PE '+fmt(s.putWall.oi/100000)+' / '+fmt((s.putWall.runnerUp??0)/100000)+'L</div>';
  const migrations=history.filter((v:any,i:number)=>i&&JSON.stringify([v.callWall.ties,v.putWall.ties])!==JSON.stringify([history[i-1].callWall.ties,history[i-1].putWall.ties]));
  $('migration').innerHTML=migrations.slice(-8).map((v:any)=>'<div class="ows-source-row">'+time(v.checked)+' · CE '+v.callWall.ties.join(' / ')+' · PE '+v.putWall.ties.join(' / ')+'</div>').join('')||'<small>No wall migration observed in current connection history.</small>';
 }
 async function loadCandidate(){
  if(symbol==='BANKNIFTY'){candidate=null;render();return;}
  const requested=symbol,generation=++candidateGeneration;candidate=null;candidateState='Loading canonical card…';render();
  try{const response=await fetch('/api/research/business-dashboard?symbol='+encodeURIComponent(requested),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const data=await response.json();if(generation!==candidateGeneration||requested!==symbol)return;if(data.symbol!==requested||data.version!=='BUSINESS_DASHBOARD_V1'||data.readOnly!==true)throw Error();candidate={data,loadedAt:Date.now()};candidateState='Loaded';}
  catch{if(generation===candidateGeneration)candidateState='Canonical card unavailable';}if(generation===candidateGeneration)render();
 }
 function update(next:any){
  if(payload?.serverTime&&next?.serverTime&&Date.parse(next.serverTime)<Date.parse(payload.serverTime))next=null;
  payload=next;
  const runtime=payload?.snapshot?.runtimeId+'|'+payload?.snapshot?.tradeDate;
  if(!payload?.connected||identity!==runtime){histories.clear();pulses.clear();revoked.clear();if(identity!==runtime){candidate=null;candidateGeneration++;}identity=runtime;}
  if(payload?.connected){
   for(const index of ['NIFTY','SENSEX','BANKNIFTY']){
    const s=deriveOiStudioSnapshot(payload,index);if(s){const k=key(s),history=histories.get(k)||[],old=history.at(-1);
     if(!old||s.cycle>old.cycle){history.push(s);while(history.length>36||history.length&&s.cycle-history[0].cycle>35*60000)history.shift();histories.set(k,history);}
     else if(s.cycle===old.cycle&&JSON.stringify(s.rows)!==JSON.stringify(old.rows)){histories.delete(k);revoked.add(k+'|'+s.cycle);}
    }
    const a=payload.snapshot.indices?.find((r:any)=>r.symbol===index);
    for(const q of [...(a?.oiQuotes||[]),a?.studioCE,a?.studioPE].filter(Boolean)){
     const i=q.identity,now=Date.parse(payload.serverTime),time=Date.parse(q.observedAt),receipt=Date.parse(q.receivedAt);
     if(q.state!=='LIVE'||i?.role!=='OPTION'||i.symbol!==index||i.expiry!==a.expiry||!n(q.oi)||q.oi<0||now-time < -5000||now-time>30000||!Number.isFinite(time)||!Number.isFinite(receipt)||now-receipt<0||now-receipt>30000)continue;
     const old=pulses.get(i.token);if(old&&(time<old.time||receipt<=old.receipt))continue;
     const delta=old?q.oi-old.oi:null,changed=n(delta)&&delta!==0;
     pulses.set(i.token,{oi:q.oi,time,receipt,delta:changed?delta:old?.delta??delta,until:changed?Date.now()+1800:old?.until||0,changedAt:changed?q.observedAt:old?.changedAt||q.observedAt});
    }
   }
  }
  while(revoked.size>64)revoked.delete(revoked.values().next().value!);
  while(histories.size>12)histories.delete(histories.keys().next().value!);
  while(pulses.size>256)pulses.delete(pulses.keys().next().value!);
  render();if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;render();},1850);
 }
 $('index').onchange=()=>{const value=$('index').value;if(!['NIFTY','SENSEX','BANKNIFTY'].includes(value))return;symbol=value;candidate=null;candidateGeneration++;render();};
 $('expiry').onchange=()=>{const expiry=$('expiry').value;if(context()?.expiries?.includes(expiry)){choices[symbol]={expiry};dispatch({expiry});}else if(recorded[symbol]?.expiries?.includes(expiry)){choices[symbol]={expiry};window.dispatchEvent(new CustomEvent('optionpilot:oi-recorded-scope',{detail:{symbol,expiry}}));render();}};
 for(const side of ['ce','pe'])$(side).onchange=()=>{const strike=Number($(side).value);if(!context()?.strikes?.includes(strike))return;choice()[side]=strike;dispatch({[side+'Strike']:strike});};
 $('windows').onclick=(e:any)=>{const button=e.target.closest?.('[data-ows-window]');if(button&&[1,3,6,15,30].includes(Number(button.dataset.owsWindow))){windowMinutes=Number(button.dataset.owsWindow);render();}};
 $('view-tabs').onclick=(e:any)=>{const value=e.target.closest?.('[data-ows-view]')?.dataset.owsView;if(value==='ladder'){view=value;render();window.dispatchEvent(new CustomEvent('optionpilot:open-premium-ladder',{detail:{source:'LIVE',symbol,expiry:context()?.expiry}}));return;}if(['columns','wheel'].includes(value)){view=value;render();}};
 $('wheel-tabs').onclick=(e:any)=>{const value=e.target.closest?.('[data-ows-wheel]')?.dataset.owsWheel;if(['oi','stocks','sectors'].includes(value)){wheel=value;render();}};
 $('research-tabs').onclick=(e:any)=>{const value=e.target.closest?.('[data-ows-research]')?.dataset.owsResearch;if(['evidence','outcome','candidate'].includes(value)){research=value;render();if(value==='candidate')void loadCandidate();}};
 $('research-result').onclick=(e:any)=>{if(e.target.closest?.('[data-ows-candidate-refresh]'))void loadCandidate();if(e.target.closest?.('[data-ows-recorded-settings]'))window.dispatchEvent(new CustomEvent('optionpilot:oi-recorded-scope',{detail:{symbol,expiry:context()?.expiry||choice().expiry}}));};
 return {update,setPage(value:number){page=value;root.hidden=page!==5;render();},recorded(models:any,date:string){recorded=models||{};recordedDate=date;render();}};
}
