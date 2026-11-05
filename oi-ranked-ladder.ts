/** Pure presentation research: no provider, persistence, candidate or order authority. */
export function recordedOiRankFrame(session:any,at:string,expiry:string){
 const timestamp=(v:any)=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
 const ms=timestamp(at),symbol=session?.symbol,date=session?.date;
 const n=(v:any)=>v===null||v===undefined||v===''||typeof v==='boolean'?null:Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
 const market=(session?.market||[]).filter((m:any)=>m.symbol===symbol&&timestamp(m.minute_bucket)===ms);
 const m=market.length===1?market[0]:null;
 const buckets=new Map<string,any[]>();
 for(const r of session?.options||[]){if(r.symbol!==symbol||String(r.expiry).slice(0,10)!==expiry||timestamp(r.minute_bucket)!==ms||!['CE','PE'].includes(r.option_type)||!Number.isFinite(Number(r.strike))||Number(r.strike)<=0)continue;
  const key=Number(r.strike)+'|'+r.option_type;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key)!.push(r);
 }
 const pairs=new Map<number,any>();
 for(const values of buckets.values()){
  // Duplicates remain ambiguous rather than selecting a convenient OI endpoint.
  if(values.length!==1||!m||m.truth_verdict!=='TRUE'||!m.snapshot_id)continue;
  const r=values[0],quote=timestamp(r.quote_timestamp),receipt=timestamp(m.backend_timestamp);
  if(r.truth_verdict!=='TRUE'||r.snapshot_id!==m.snapshot_id||!Number.isFinite(quote)||!Number.isFinite(receipt)||receipt-quote< -5000||receipt-quote>30000||new Date(quote+19800000).toISOString().slice(0,10)!==date||new Date(ms+19800000).toISOString().slice(0,10)!==date||n(r.oi)===null)continue;
  const strike=Number(r.strike);if(!pairs.has(strike))pairs.set(strike,{strike});
  pairs.get(strike)[r.option_type]={symbol,expiry,strike,side:r.option_type,oi:n(r.oi),sourceAt:at,price:typeof r.ltp==='number'&&r.ltp>0?r.ltp:null,priceAt:r.quote_timestamp,pdh:typeof r.pdh==='number'?r.pdh:null,pdl:typeof r.pdl==='number'?r.pdl:null};
 }
 const chains=(session?.chain||[]).filter((r:any)=>r.symbol===symbol&&String(r.expiry).slice(0,10)===expiry&&timestamp(r.minute_bucket)===ms&&r.truth_verdict==='TRUE'&&r.snapshot_id===m?.snapshot_id&&/^(Exact archived full-chain source|Normalized full-chain source)$/.test(r.full_pcr_source||''));
 const chain=chains.length===1?chains[0]:null,full=chain?.full_chain_oi_pcr;
 return {symbol,date,expiry,runtime:'RECORDED',cycle:ms,checked:timestamp(m?.backend_timestamp),anchor:typeof m?.spot_ltp==='number'?m.spot_ltp:null,fullPcr:typeof full==='number'&&Number.isFinite(full)&&full>=0?full:null,rows:[...pairs.values()].sort((a,b)=>a.strike-b.strike)};
}

/** Ranks are per symbol/expiry/side within admitted source rows, before viewport filtering. */
export function deriveOiRankedLadder(current:any,baseline:any,options:any={}){
 const mode=options.mode==='LIVE'?'LIVE':'RECORDED',minutes=options.minutes==='OPEN'?'OPEN':Number(options.minutes||3);
 const n=(v:any)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 const day=(v:number)=>Number.isFinite(v)?new Date(v+19800000).toISOString().slice(0,10):'';
 const empty={mode,rows:[],summary:{CE:{total:[],add:[],shed:[],eligible:0,compared:0},PE:{total:[],add:[],shed:[],eligible:0,compared:0}},reason:'Current qualified OI snapshot unavailable'};
 if(!current||!['NIFTY','SENSEX','BANKNIFTY'].includes(current.symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(current.expiry||'')||day(current.cycle)!==current.date||!Number.isFinite(current.checked)||current.checked<current.cycle||day(current.checked)!==current.date||current.checked-current.cycle>60000||!Number.isFinite(Date.parse(current.expiry+'T00:00:00Z'))||new Date(current.expiry+'T00:00:00Z').toISOString().slice(0,10)!==current.expiry||current.expiry<current.date||![1,3,5,6,15,30,'OPEN'].includes(minutes))return empty;
 const baselineOK=!!baseline&&baseline.symbol===current.symbol&&baseline.expiry===current.expiry&&baseline.date===current.date&&baseline.runtime===current.runtime&&baseline.cycle<current.cycle&&Number.isFinite(baseline.checked)&&baseline.checked>=baseline.cycle&&baseline.checked<=current.checked&&baseline.checked-baseline.cycle<=60000&&day(baseline.checked)===baseline.date&&
  (minutes==='OPEN'?new Date(baseline.cycle+19800000).toISOString().slice(11,16)==='09:15':Math.abs(current.cycle-baseline.cycle-minutes*60000)<=1000);
 const collect=(frame:any)=>{
  const sides:any={CE:[],PE:[]},seen=new Map<string,number>(),tokens=new Map<number,number>();
  for(const pair of frame?.rows||[])for(const side of ['CE','PE'])if(pair[side]){const key=pair.strike+'|'+side;seen.set(key,(seen.get(key)||0)+1);const token=pair[side].token;if(mode==='LIVE')tokens.set(token,(tokens.get(token)||0)+1);}
  for(const pair of frame?.rows||[])for(const side of ['CE','PE']){
   const r=pair[side],time=Date.parse(r?.sourceAt);
   if(!r||seen.get(pair.strike+'|'+side)!==1||r.symbol!==current.symbol||r.expiry!==current.expiry||r.side!==side||r.strike!==pair.strike||!Number.isFinite(pair.strike)||pair.strike<=0||!n(r.oi)||!Number.isFinite(time)||day(time)!==frame.date)continue;
   if(mode==='LIVE'&&(frame.checked-time>30000||time-frame.checked>5000||!Number.isInteger(r.token)||r.token<=0||tokens.get(r.token)!==1))continue;
   if(mode==='RECORDED'&&time!==frame.cycle)continue;
   const priceAt=Date.parse(r.priceAt),priceOK=typeof r.price==='number'&&Number.isFinite(r.price)&&r.price>0&&day(priceAt)===frame.date&&frame.checked-priceAt<=30000&&priceAt-frame.checked<=5000;
   sides[side].push({...r,price:priceOK?r.price:null,priceAt:priceOK?r.priceAt:null});
  }
  return sides;
 };
 const now=collect(current),before=baselineOK?collect(baseline):{CE:[],PE:[]};
 const rank=(rows:any[],value:any)=>{
  const sorted=[...rows].sort((a,b)=>value(b)-value(a)||a.strike-b.strike);let last:any=null,position=0;
  for(let i=0;i<sorted.length;i++){const v=value(sorted[i]);if(last!==v)position=i+1;sorted[i].rank=position;last=v;}return sorted;
 };
 const result:any={mode,symbol:current.symbol,expiry:current.expiry,date:current.date,dte:Math.round((Date.parse(current.expiry+'T00:00:00Z')-Date.parse(current.date+'T00:00:00Z'))/86400000),at:current.checked,baselineAt:baselineOK?baseline.checked:null,minutes,anchor:current.anchor??current.spot??null,scope:mode==='LIVE'?'Qualified current-expiry snapshot':'Returned archived CORE strikes',oiClock:mode==='LIVE'?'OI source timestamps verified':'Saved snapshot OI; actual OI publication time unavailable',unit:'Source OI units (lot conversion not verified)',reason:baselineOK?'':'Exact baseline unavailable; changes and change ranks withheld',summary:{},rows:[]};
 const byStrike=new Map<number,any>();
 for(const side of ['CE','PE']){
  const old=new Map<number,any>(before[side].map((r:any)=>[r.strike,r]));
  const oldRanks=rank(before[side].map((r:any)=>({...r})),(r:any)=>r.oi);
  const stable=now[side].length===before[side].length&&now[side].every((r:any)=>old.has(r.strike)&&(mode!=='LIVE'||old.get(r.strike).token===r.token));
  const enriched=now[side].map((r:any)=>{
   const b=old.get(r.strike),matched=!!b&&(mode!=='LIVE'||r.token===b.token),delta=matched?r.oi-b.oi:null,priceDelta=matched&&r.price!==null&&b.price!==null?r.price-b.price:null;
   const levels=mode==='RECORDED'&&r.price!==null&&Number.isFinite(r.pdh)&&Number.isFinite(r.pdl)&&r.pdl>0&&r.pdh>=r.pdl;
   return {...r,pdh:levels?r.pdh:null,pdl:levels?r.pdl:null,delta,oiPercent:matched&&b.oi>0?delta/b.oi*100:null,priceDelta,pricePercent:priceDelta!==null?priceDelta/b.price*100:null,totalRank:null,addRank:null,shedRank:null,rankChange:null,
    state:levels&&typeof r.pdl==='number'&&r.pdl>0&&r.price<r.pdl?'BELOW PDL':levels&&typeof r.pdh==='number'&&r.pdh>0&&r.price>r.pdh?'ABOVE PDH':levels&&typeof r.pdl==='number'&&r.pdl>0&&typeof r.pdh==='number'&&r.pdh>0&&r.pdh>=r.pdl?(r.price===r.pdh?'AT PDH':r.price===r.pdl?'AT PDL':'IN RANGE · INSIDE PDH/PDL'):'LEVELS UNAVAILABLE'};
  });
  const total=rank(enriched.map((r:any)=>({...r})),(r:any)=>r.oi),add=rank(enriched.filter((r:any)=>r.delta>0).map((r:any)=>({...r})),(r:any)=>r.delta),shed=rank(enriched.filter((r:any)=>r.delta<0).map((r:any)=>({...r})),(r:any)=>-r.delta);
  const totals=new Map(total.map((r:any)=>[r.strike,r.rank])),adds=new Map(add.map((r:any)=>[r.strike,r.rank])),sheds=new Map(shed.map((r:any)=>[r.strike,r.rank])),oldTotal=new Map(oldRanks.map((r:any)=>[r.strike,r.rank]));
  for(const r of enriched){r.totalRank=totals.get(r.strike)??null;r.addRank=adds.get(r.strike)??null;r.shedRank=sheds.get(r.strike)??null;r.rankChange=stable?(oldTotal.get(r.strike)-r.totalRank):null;if(!byStrike.has(r.strike))byStrike.set(r.strike,{strike:r.strike});byStrike.get(r.strike)[side]=r;}
  const top=(rows:any[])=>rows.slice(0,5).map((r:any)=>({strike:r.strike,rank:r.rank,value:r.delta,oi:r.oi}));
  result.summary[side]={eligible:enriched.length,compared:enriched.filter((r:any)=>r.delta!==null).length,total:top(total),add:top(add),shed:top(shed)};
 }
 if(!before.CE.length&&!before.PE.length){result.baselineAt=null;result.reason='No eligible exact baseline; change ranks withheld';}
 result.rows=[...byStrike.values()].sort((a,b)=>a.strike-b.strike);
 const oldPairs=new Map<number,any>((baselineOK?baseline.rows:[]).map((r:any)=>[r.strike,r]));
 for(const row of result.rows){
  const b=oldPairs.get(row.strike),c=row.CE,p=row.PE;
  row.pcr=c&&p&&c.oi>0?p.oi/c.oi:null;
  // Both endpoints must survive the qualified comparison, including token identity.
  row.pcrDelta=row.pcr!==null&&c.delta!==null&&p.delta!==null&&b?.CE?.oi>0?row.pcr-b.PE.oi/b.CE.oi:null;
 }
 const full=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const complete=now.CE.length===current.rows.length&&now.PE.length===current.rows.length;
 result.fullPcr=mode==='LIVE'?(complete?full(current.pcr):null):full(current.fullPcr);
 const priorComplete=baselineOK&&before.CE.length===baseline.rows.length&&before.PE.length===baseline.rows.length;
 const priorFull=baselineOK?(mode==='LIVE'?(priorComplete?full(baseline.pcr):null):full(baseline.fullPcr)):null;
 result.fullPcrDelta=result.fullPcr!==null&&priorFull!==null?result.fullPcr-priorFull:null;
 return result;
}

export function renderOiRankedLadder(model:any,options:any={}){
 const esc=(v:any)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const n=(v:any)=>typeof v==='number'&&Number.isFinite(v),f=(v:any)=>n(v)?v.toLocaleString('en-IN',{maximumFractionDigits:2}):'—',signed=(v:any)=>n(v)?(v>0?'+':'')+f(v):'—';
 const time=(v:any)=>Number.isFinite(typeof v==='number'?v:Date.parse(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false}):'—';
 if(!model.rows?.length)return '<div class="oir-empty" role="status">OI ranked ladder · '+esc(model.reason||'No eligible contracts at this time')+'</div>';
 const band=[3,5,7].includes(Number(options.band))?Number(options.band):7,focus=['TOTAL','ADD','SHED'].includes(options.focus)?options.focus:'TOTAL';
 const rows=model.rows,anchor=n(model.anchor)?rows.reduce((best:any,r:any)=>Math.abs(r.strike-model.anchor)<Math.abs(best.strike-model.anchor)?r:best,rows[0]).strike:null,center=rows.some((r:any)=>r.strike===options.center)?options.center:anchor,index=rows.findIndex((r:any)=>r.strike===center);
 const shown=index<0?[]:rows.slice(Math.max(0,index-band),index+band+1);
 const chips=(side:string)=>{const s=model.summary[side],list=focus==='ADD'?s.add:focus==='SHED'?s.shed:s.total;return '<div><b>'+side+' · '+(focus==='ADD'?'Top additions':focus==='SHED'?'Top shedding':'Top OI')+'</b><p>'+ (list.length?list.map((r:any)=>'<button type="button" class="oir-chip" data-oir-strike="'+r.strike+'" aria-label="Center ladder at '+r.strike+'">#'+r.rank+' '+f(r.strike)+' · '+(focus==='TOTAL'?f(r.oi):signed(r.value))+'</button>').join(' '):'No qualifying '+(focus==='TOTAL'?'OI':'changes'))+'</p><small>'+s.eligible+' OI endpoints · '+s.compared+' exact comparisons</small></div>';};
 const pcrValue=(v:any)=>n(v)?v.toLocaleString('en-IN',{maximumFractionDigits:4}):'—';
 const movement=(v:any)=>!n(v)?'—':(v>0?'↑ ':v<0?'↓ ':'→ ')+signed(v);
 const pcrMove=(v:any)=>!n(v)?'—':(v>0?'↑ +':v<0?'↓ ':'→ ')+pcrValue(v);
 const tone=(v:any)=>!n(v)||v===0?'FLAT':v>0?'UP':'DOWN';
 const cell=(q:any,side:string)=>{
  if(!q)return '<td><span class="oir-muted">'+side+' unavailable</span></td>';
  const state=n(q.delta)?q.delta>0?'ADD':q.delta<0?'SHED':'FLAT':'WAIT',active=focus==='ADD'?q.addRank:focus==='SHED'?q.shedRank:q.totalRank;
  const tick=q.tick&&n(q.tick.delta)?'<span class="ows-pulse'+(q.tick.remaining>0?' ows-blink':'')+'"'+(q.tick.remaining>0?' style="animation-delay:-'+Math.floor(1800-q.tick.remaining)+'ms"':'')+'>Last tick ΔOI '+signed(q.tick.delta)+' · '+(q.tick.delta>0?'ADDING':q.tick.delta<0?'SHEDDING':'UNCHANGED')+'</span>':'';
  return '<td data-oir-contract="'+esc([model.date,model.symbol,model.expiry,q.strike,side].join('|'))+'" data-oir-state="'+state+'"><div class="oir-pcr">'+side+' OI '+f(q.oi)+'</div><div class="oir-cell-head"><b class="oir-premium">₹'+f(q.price)+'</b><span class="oir-rank oir-oi">'+(active?'#'+active:'—')+'</span></div><div class="oir-oi">OI '+f(q.oi)+'</div><div class="oir-change oir-oi">'+movement(q.delta)+' '+state+' <small>('+signed(q.oiPercent)+'%)</small></div><small class="oir-premium oir-move" data-oir-tone="'+tone(q.priceDelta)+'">Premium '+movement(q.priceDelta)+' · '+signed(q.pricePercent)+'%</small><small class="oir-oi">OI rank #'+q.totalRank+' · add '+(q.addRank?'#'+q.addRank:'—')+' · shed '+(q.shedRank?'#'+q.shedRank:'—')+'</small><small class="oir-oi">Rank '+movement(q.rankChange)+'</small><div class="oir-premium oir-levels"><span class="oir-pdh">PDH '+f(q.pdh)+'</span> · <span class="oir-pdl">PDL '+f(q.pdl)+'</span><small class="oir-range" data-oir-level="'+(q.state==='ABOVE PDH'?'ABOVE':q.state==='BELOW PDL'?'BELOW':q.state==='LEVELS UNAVAILABLE'?'MISSING':'RANGE')+'">'+esc(q.state)+'</small></div><span class="oir-oi">'+tick+'</span><details><summary>Source &amp; levels</summary><small>OI '+time(q.sourceAt)+' · price '+time(q.priceAt)+' IST<br>PDH '+f(q.pdh)+' / PDL '+f(q.pdl)+'</small></details></td>';
 };
 return '<section class="oir-panel" data-oir-key="'+esc([model.date,model.symbol,model.expiry,band,center].join('|'))+'" data-oir-center="'+esc(center)+'" data-oir-view="ALL" aria-label="OI ranked CE PE ladder"><div class="oir-switch" role="group" aria-label="Ladder display">'+['OI','PCR','PREMIUM','ALL'].map(v=>'<button type="button" data-oir-view-option="'+v+'" aria-pressed="'+(v==='ALL')+'">'+(v==='ALL'?'All':v==='PREMIUM'?'Premium':v)+'</button>').join('')+'</div><header><div><strong>'+esc(model.symbol)+' · '+esc(model.expiry)+' · DTE '+f(model.dte)+'</strong><small>'+esc(model.mode)+' · '+(model.minutes==='OPEN'?'From 09:15 baseline':model.minutes+'m window')+' · '+time(model.baselineAt)+' → '+time(model.at)+' IST</small></div><span>'+esc(model.scope)+'</span></header><div class="oir-pcr oir-pcr-summary"><strong>Full-expiry OI PCR '+pcrValue(model.fullPcr)+'</strong> · '+pcrMove(model.fullPcrDelta)+'<small>PE total OI ÷ CE total OI · selected expiry · '+(model.fullPcr===null?'qualified full-chain source unavailable':'same source snapshot')+'</small></div><div class="oir-tops oir-oi">'+chips('CE')+chips('PE')+'</div><p class="oir-note">'+esc(model.unit)+' · '+esc(model.oiClock)+'. '+esc(model.reason)+' Absolute ΔOI ranks; percentages are context. Tap a top strike to center the ladder.</p>'+(shown.length?'<div class="oir-scroll"><table class="ows-ladder oir-table"><thead><tr><th scope="col">CE · Premium / OI</th><th scope="col">Strike</th><th scope="col">PE · Premium / OI</th></tr></thead><tbody>'+shown.map((r:any)=>'<tr data-oir-row="'+r.strike+'"'+(r.strike===anchor?' class="oir-atm"':'')+'>'+cell(r.CE,'CE')+'<th scope="row">'+f(r.strike)+(r.strike===anchor?'<small>ATM now</small>':'')+'<div class="oir-pcr"><b>PCR '+pcrValue(r.pcr)+'</b><small>'+pcrMove(r.pcrDelta)+'</small><small>Strike PE OI ÷ CE OI</small></div></th>'+cell(r.PE,'PE')+'</tr>').join('')+'</tbody></table></div>':'<p>ATM ladder unavailable: current spot missing. Top ranks above cover eligible source contracts.</p>')+'<details class="oir-guide"><summary>How to use this ladder</summary><p>1. Compare the same expiry and window. 2. Check premium and PDL/PDH alongside addition or shedding. 3. Watch the opposite side and replay what follows. OI rank is position concentration, not buyer/seller identification or a trade signal. Rank movement uses an unchanged eligible contract universe; ties share rank. A missing baseline stays unavailable; zero OI is valid. Other expiries are separate selections. PCR arrows describe numeric change, not market direction. PDH green / PDL red; yellow In range includes boundary touches, which are labeled separately.</p></details></section>';
}


/** Retain the user's reading position across heartbeats. Center only a new viewport. */
export function paintOiRankedLadder(node:any,html:string){
 if(!node)return;
 const applyView=()=>{const view=['OI','PCR','PREMIUM','ALL'].includes(node.__oirView)?node.__oirView:'ALL',panel=node.querySelector?.('.oir-panel');panel?.setAttribute('data-oir-view',view);for(const b of node.querySelectorAll?.('[data-oir-view-option]')||[])b.setAttribute('aria-pressed',String(b.getAttribute('data-oir-view-option')===view));};
 if(!node.__oirSwitchBound&&node.addEventListener){node.addEventListener('click',(event:any)=>{const button=event.target.closest?.('[data-oir-view-option]');if(!button||!node.contains(button))return;const view=button.getAttribute('data-oir-view-option');if(!['OI','PCR','PREMIUM','ALL'].includes(view))return;node.__oirView=view;applyView();});node.__oirSwitchBound=true;}
 if(node.innerHTML===html){applyView();return;}
 const old=node.querySelector?.('.oir-scroll'),oldPanel=node.querySelector?.('.oir-panel'),key=oldPanel?.getAttribute('data-oir-key'),top=old?.scrollTop;
 const oldHeight=old?.scrollHeight,box=old?.getBoundingClientRect?.(),middle=box?box.top+old.clientHeight/2:NaN;
 const readingRow=old?Array.from(old.querySelectorAll('tbody tr')).find((r:any)=>{const b=r.getBoundingClientRect();return b.top<=middle&&b.bottom>=middle;}) as any:null;
 const reading=readingRow?{strike:readingRow.getAttribute('data-oir-row'),offset:(readingRow.getBoundingClientRect().top+readingRow.getBoundingClientRect().height/2)-middle}:null;
 const opened=new Set<string>(Array.from(node.querySelectorAll?.('[data-oir-contract] details[open]')||[]).map((d:any)=>d.closest('[data-oir-contract]')?.getAttribute('data-oir-contract')));
 const guideOpen=node.querySelector?.('.oir-guide')?.open;
 node.innerHTML=html;applyView();
 const panel=node.querySelector?.('.oir-panel'),scroll=node.querySelector?.('.oir-scroll');
 for(const d of node.querySelectorAll?.('[data-oir-contract] details')||[])if(opened.has(d.closest('[data-oir-contract]')?.getAttribute('data-oir-contract')))d.open=true;
 const guide=node.querySelector?.('.oir-guide');if(guide&&guideOpen)guide.open=true;
 if(!scroll||!panel)return;
 if(key===panel.getAttribute('data-oir-key')&&typeof top==='number'){scroll.scrollTop=top;if(reading&&oldHeight!==scroll.scrollHeight){const row=scroll.querySelector('[data-oir-row="'+reading.strike+'"]');if(row){const a=row.getBoundingClientRect(),b=scroll.getBoundingClientRect();scroll.scrollTop+=(a.top+a.height/2)-(b.top+scroll.clientHeight/2)-reading.offset;}}return;}
 const target=scroll.querySelector('[data-oir-row="'+panel.getAttribute('data-oir-center')+'"]');
 if(target){const a=target.getBoundingClientRect(),b=scroll.getBoundingClientRect();scroll.scrollTop+=a.top-b.top-(scroll.clientHeight-a.height)/2;}
}

export const OI_RANKED_LADDER_CSS=`.oir-panel{--oir-line:#cddbd3;--oir-muted:#53665c;--oir-add:#087943;--oir-shed:#b52b48;--oir-tint:#eaf5ef;border:1px solid var(--oir-line);border-radius:12px;padding:10px;margin:10px 0;min-width:0;font-variant-numeric:tabular-nums}.oir-scroll{max-height:65vh;overflow:auto;overscroll-behavior:contain}.oir-table thead th{position:sticky!important;top:0;background:var(--oir-bg,#fff)!important;z-index:1}.oir-panel header{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.oir-panel header small,.oir-panel td small,.oir-panel th small{display:block}.oir-tops{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.oir-chip{max-width:100%;white-space:normal;display:inline-block;border:1px solid var(--oir-line);border-radius:5px;padding:3px 5px;margin:2px;font-size:12px}.oir-note,.oir-panel small,.oir-panel header>span{color:var(--oir-muted);font-size:12px}.oir-panel .oir-table{width:100%;table-layout:fixed;border-collapse:collapse;white-space:normal}.oir-panel .oir-table th,.oir-panel .oir-table td{white-space:normal;overflow-wrap:anywhere;padding:8px 5px;vertical-align:top;border-bottom:1px solid var(--oir-line);text-align:left}.oir-panel .oir-table th:nth-child(2){width:20%;text-align:center}.oir-cell-head{display:flex;justify-content:space-between;gap:4px;align-items:center}.oir-panel .oir-cell-head b{font-size:17px}.oir-rank{border:1px solid var(--oir-line);padding:2px 5px;border-radius:5px;font-size:12px}.oir-panel [data-oir-state=ADD] .oir-change{color:var(--oir-add)}.oir-panel [data-oir-state=SHED] .oir-change{color:var(--oir-shed)}.oir-atm>th{background:var(--oir-tint)}.oir-guide p{font-size:13px;line-height:1.6}.oir-panel details{margin-top:5px}.oir-panel summary{cursor:pointer;font-size:12px}#oi-wall-studio .oir-panel{--oir-bg:#1a292a;--oir-line:#39524a;--oir-muted:#afc8bd;--oir-add:#62dec3;--oir-shed:#ff839b;--oir-tint:#203d31}@media(max-width:420px){.oir-panel{padding:7px}.oir-tops{gap:5px}.oir-panel .oir-table th,.oir-panel .oir-table td{padding:6px 3px;font-size:12px}.oir-panel .oir-cell-head b{font-size:15px}.oir-panel .oir-table th:nth-child(2){width:20%}}.oir-switch{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.oir-switch button{min-height:44px;flex:1;border:1px solid var(--oir-line);border-radius:7px;background:var(--oir-bg,#fff);color:var(--oir-muted);cursor:pointer}.oir-switch button[aria-pressed=true]{background:var(--oir-tint);color:var(--oir-add);border-color:var(--oir-add);font-weight:700}.oir-panel [data-oir-tone=UP],.oir-panel .oir-pdh{color:var(--oir-add)}.oir-panel [data-oir-tone=DOWN],.oir-panel .oir-pdl{color:var(--oir-shed)}.oir-panel .oir-range{padding:4px;border:1px solid var(--oir-line);border-radius:5px;color:var(--oir-muted)}.oir-panel [data-oir-level=ABOVE]{color:var(--oir-add)}.oir-panel [data-oir-level=BELOW]{color:var(--oir-shed)}.oir-panel [data-oir-level=RANGE]{color:#806000;background:#fff3bf}.oir-pcr{color:#806000}.oir-pcr-summary{padding:8px;border:1px solid var(--oir-line);border-radius:7px;margin-top:8px}#oi-wall-studio .oir-pcr{color:#ffd966}#oi-wall-studio .oir-panel [data-oir-level=RANGE]{background:#3c341c;color:#ffd966}.oir-panel[data-oir-view=OI] .oir-premium,.oir-panel[data-oir-view=OI] .oir-pcr,.oir-panel[data-oir-view=PCR] .oir-premium,.oir-panel[data-oir-view=PCR] .oir-oi,.oir-panel[data-oir-view=PREMIUM] .oir-oi,.oir-panel[data-oir-view=PREMIUM] .oir-pcr{display:none!important}`;
