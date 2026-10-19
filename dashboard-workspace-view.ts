import { installPremiumWorkspace } from './premium-workspace-view.js';
export const WORKSPACE_NAV_HTML=`<aside id="op-workspace-nav" aria-label="Dashboard chapters"><div class="op-rail-inner"><a class="op-logo" href="/">OP<span>OptionPilot <b>PRO</b></span></a><div class="op-rail-label">YOUR MARKET WORKSPACE</div><div id="op-chapter-links"></div><details id="op-customize"><summary>＋ Choose my chapters</summary><div id="op-chapter-options"></div><button id="op-show-chapters" type="button">Show all chapters</button></details><div class="op-rail-foot">NIFTY · SENSEX<br><span>BANKNIFTY · monthly observation</span></div></div></aside><div id="op-workspace-top"><strong>OptionPilot</strong><div id="op-workspace-feed" role="status">Connecting to market feed</div><section id="op-one-stop" aria-label="One-stop market evidence"><div class="op-one-title"><div><span class="op-kicker">ONE CARD / ONE STOP</span><h2>Market command card</h2></div><div id="op-one-status" role="status" aria-live="polite">Waiting for connected live evidence</div></div><div id="op-one-actions" role="group" aria-label="Open existing market tools"><button type="button" data-op-one="LIVE">Live detail</button><button type="button" data-op-one="LADDER">CE / PE ladder</button><button type="button" data-op-one="MULTIDAY">Multi-day research</button><button type="button" data-op-one="RAG">Ask RAG</button></div><div class="op-one-scroll"><table aria-label="Verified latest Kite market readings"><thead><tr><th>Index / expiry</th><th>Spot</th><th>Future</th><th>CE ₹</th><th>PE ₹</th><th>Full PCR</th><th>CE wall</th><th>PE wall</th></tr></thead><tbody id="op-one-rows"><tr><td colspan="8">Waiting for actual Kite stream · unavailable is not zero</td></tr></tbody></table></div><p class="op-one-note">One shared stream; exact expiry and source timestamps. PCR and wall values appear only for a complete, current full-chain snapshot. BANKNIFTY = monthly observation. Read-only evidence, not a trading signal.</p></section></div>`;

export const WORKSPACE_TICKER_HTML=`<details id="op-ticker-tools"><summary>Market ticker</summary><div id="op-workspace-ticker" aria-label="Market snapshot"></div></details>`;

export const WORKSPACE_CSS=`
:root{--op-ink:#eff6ff;--op-muted:#a5b5cf;--op-edge:#243650;--op-aqua:#58e5dc;--op-rise:#85f4ad;--op-fall:#ff89a9;--op-gold:#f5ce7b}
body[data-op-workspace]{background:#080d18;background-image:radial-gradient(ellipse at 80% 0%,#12333d55,transparent 38%);color:var(--op-ink)}
body[data-op-workspace] [hidden]{display:none!important}
body[data-op-workspace]>header{border-bottom:1px solid var(--op-edge);background:#0b1220;padding:10px 22px}
body[data-op-workspace]>header>:is(h1,p,.badge,nav){display:none}body[data-op-workspace]>header .terminal-tabs{margin:0}body[data-op-workspace]>header .header-freshness{margin:4px 0}
body[data-op-workspace] main{padding:12px;max-width:none}body[data-op-workspace] :is(.panel,.mb-box){border:1px solid var(--op-edge);background:#101a2a;border-radius:18px;box-shadow:0 8px 30px #00000012}
#op-feed-detail{border:1px solid var(--op-edge);border-radius:12px;margin-bottom:12px;padding:12px;background:#101a2a}#op-feed-detail>summary{cursor:pointer;color:var(--op-aqua);font-size:18px}
body[data-op-workspace] #market-book{position:relative;padding:20px 22px 24px 262px;background:linear-gradient(140deg,#0a1422,#0c1220);border:1px solid var(--op-edge);border-radius:20px;min-height:780px}
#op-workspace-nav{position:absolute;inset:0 auto 0 0;width:240px;background:#0c1423;border-right:1px solid var(--op-edge);border-radius:20px 0 0 20px;padding:22px 14px}.op-rail-inner{position:sticky;top:14px}
.op-logo{display:flex;align-items:center;gap:12px;color:var(--op-aqua)!important;background:transparent;font-size:21px;font-weight:800;text-decoration:none!important}.op-logo:first-letter{background:var(--op-aqua)}.op-logo>span{color:var(--op-ink);font-size:18px}.op-logo b{display:block;color:var(--op-aqua);font-size:11px;letter-spacing:3px;margin-top:2px}.op-rail-label{font-size:11px;letter-spacing:1.5px;color:#8c9cb7;margin:30px 8px 12px}
#op-chapter-links{display:grid;gap:5px}#market-book #op-chapter-links button{width:100%;text-align:left;display:flex;align-items:center;gap:10px;border:1px solid transparent;background:transparent;color:#b5c4d9;border-radius:10px;padding:10px 9px;min-height:47px;font-size:16px;line-height:1.3}#op-chapter-links button>span{font:12px/1.4 ui-monospace,monospace;color:#8499b6}#market-book #op-chapter-links button[aria-current=page]{border-color:#58e5dc4d;background:#58e5dc13;color:#91faf0;box-shadow:inset 3px 0 var(--op-aqua)}
#op-customize{margin-top:16px;padding:10px 4px;border-top:1px solid var(--op-edge)}#op-customize summary{cursor:pointer;color:var(--op-aqua)!important;font-size:15px!important}#op-chapter-options label{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:14px!important}#op-chapter-options input{width:18px;min-height:18px;height:18px;accent-color:var(--op-aqua)}#market-book #op-show-chapters{font-size:14px;min-height:40px}.op-rail-foot{font-size:13px;line-height:1.8;color:#b1c4da;border-top:1px solid var(--op-edge);margin-top:20px;padding:14px 6px}.op-rail-foot span{font-size:11px;color:#91a3be}
#op-workspace-top{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:18px}.op-kicker{font:11px/1.5 ui-monospace,monospace;color:var(--op-aqua);letter-spacing:2px}#market-book #op-workspace-top h2{font-size:clamp(24px,2.6vw,36px);line-height:1.2;margin:8px 0;font-weight:650;letter-spacing:-1px}#op-workspace-top h2 span{color:var(--op-aqua)}#op-workspace-top p{font-size:14px;color:var(--op-muted);margin:0}#op-workspace-feed{font-size:13px;color:#d6ba7e;border:1px solid #6c583d;border-radius:28px;padding:9px 13px;white-space:normal}.op-feed-on{color:var(--op-aqua)!important;border-color:#58e5dc55!important}
#op-workspace-ticker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}.op-ticker{background:linear-gradient(145deg,#132136,#0c1828);border:1px solid var(--op-edge);border-radius:14px;padding:14px}.op-ticker span{font-size:12px;letter-spacing:.8px;color:#b9c9de}.op-ticker strong{display:block;font-size:clamp(25px,2.2vw,34px);font-weight:600;letter-spacing:-1px;margin:5px 0;color:#edf8ff}.op-ticker small{font-size:13px;color:var(--op-muted)}.op-positive{color:var(--op-rise)!important}.op-negative{color:var(--op-fall)!important}
body[data-op-workspace] #market-book>.mb-top{display:none}body[data-op-workspace] #mb-chapters{display:none}body[data-op-workspace] #mb-settings{background:#101d30;border-color:var(--op-edge);padding:12px;border-radius:12px}body[data-op-workspace] #mb-live-context-shell{background:#101d30;border:1px solid var(--op-edge);padding:10px 12px;border-radius:12px}body[data-op-workspace] #mb-health{font-size:13px;color:var(--op-muted);max-height:44px;overflow:auto}body[data-op-workspace] .mb-turn{border-block:1px solid var(--op-edge);padding:12px 0;margin:14px 0}body[data-op-workspace] #mb-page-count{font-size:13px;color:var(--op-aqua)}
body[data-op-workspace] #market-book :is(select,input,button){border-radius:9px;border-color:#354965;background:#142239;color:var(--op-ink);min-height:46px}body[data-op-workspace] #market-book select:focus-visible,body[data-op-workspace] button:focus-visible{outline:2px solid var(--op-aqua);outline-offset:3px}
body[data-op-workspace] #mb-page>.mb-reading-guide{margin:0 0 12px}body[data-op-workspace] #mb-page .mb-box{padding:16px}body[data-op-workspace] #mb-page h2{font-size:27px}body[data-op-workspace] #mb-page h3{font-size:21px;color:#eef8ff}body[data-op-workspace] #mb-page .mb-number{color:#71eade;font-size:clamp(30px,3vw,40px)}
@media(min-width:1500px){body[data-op-workspace] #market-book{padding-left:282px}#op-workspace-nav{width:260px}}
@media(max-width:900px){body[data-op-workspace] #market-book{padding:16px}#op-workspace-nav{position:static;width:auto;padding:0;background:none;border:0;border-radius:0}.op-rail-inner{position:static}.op-logo,.op-rail-label,.op-rail-foot{display:none}#op-chapter-links{display:flex;overflow-x:auto;gap:6px;padding-bottom:10px;scrollbar-width:thin}#market-book #op-chapter-links button{width:auto;flex:0 0 auto;padding:10px 12px;font-size:15px;min-height:44px}#op-customize{margin:0 0 14px;padding:5px 0;border:0}#op-chapter-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:600px){body[data-op-workspace] main{padding:6px}body[data-op-workspace] #market-book{padding:12px;border-radius:14px}#op-workspace-top{align-items:flex-start;gap:10px}#op-workspace-feed{max-width:130px;font-size:11px;padding:7px 9px}#op-workspace-top p{font-size:12px}#op-workspace-ticker{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.op-ticker{padding:11px}.op-ticker strong{font-size:28px}#op-chapter-options{grid-template-columns:repeat(2,minmax(0,1fr))}body[data-op-workspace] #mb-live-context-shell{display:block}}


#op-one-stop{border:1px solid #36747a;border-radius:14px;padding:12px;background:#0c202e;margin:8px 0 12px;min-width:0}
#op-one-stop .op-one-title{display:flex;align-items:center;justify-content:space-between;gap:12px}
#op-one-stop h2{font-size:21px;margin:1px 0}
#op-one-status{font-size:12px;color:#a5cde0;max-width:380px;text-align:right}
#op-one-actions{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}
body[data-op-workspace] #op-one-actions button{min-height:42px;padding:7px 13px;font-size:14px;border:1px solid #447c80;background:#132f3c}
body[data-op-workspace] #op-one-actions button:focus-visible{outline:2px solid #58e5dc}
.op-one-scroll{overflow-x:auto;max-width:100%;border:1px solid #2a5360;border-radius:9px}
#op-one-stop table{width:100%;min-width:810px;border-collapse:collapse;font-size:13px;white-space:nowrap}
#op-one-stop th,#op-one-stop td{text-align:left;padding:8px 9px;border-bottom:1px solid #264758}
#op-one-stop th{position:static;background:#123041;color:#c8e7e7}
#op-one-stop td small{display:block;color:#9fc2d4;font-size:11px}
#op-one-stop .op-one-note{font-size:11px;color:#a4bbca;margin:8px 0 0}
@media(max-width:600px){#op-one-stop{padding:9px}#op-one-stop .op-one-title{display:block}#op-one-status{text-align:left;margin-top:4px}#op-one-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}body[data-op-workspace] #op-one-actions button{padding:5px;font-size:12px;min-height:44px}}
/* One compact workspace header; optional tools never precede the chapter as separate panels. */
body[data-op-workspace] #market-book{min-height:0}
#op-workspace-top{margin-bottom:8px;min-height:36px}#op-workspace-top>strong{font-size:18px}
body[data-op-workspace] .mb-turn{margin:8px 0;padding:6px 0}
#mb-tools,#op-workspace-advanced,#op-display-tools{border:1px solid var(--op-edge);border-radius:10px;padding:0 10px;margin:8px 0}
:is(#mb-tools,#op-workspace-advanced,#op-display-tools)>summary{cursor:pointer;min-height:44px;padding:10px 0;font-size:15px}
#op-workspace-advanced{order:8}#mb-tools[open]>:not(summary),#op-workspace-advanced[open]>:not(summary){margin-block:10px}
body[data-op-workspace] .mb-scope{margin:6px 0;padding:4px 8px;font-size:13px}
body[data-op-workspace] .mb-detail-toolbar{margin:4px 0}body[data-op-workspace] #mb-page .mb-chapter-head{margin-bottom:8px;padding-bottom:6px}
body[data-op-workspace] #mb-page .mb-chapter-head h2{margin:3px 0;font-size:23px}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
`;

export function installDashboardWorkspace(api:any){
 const $=(id:string)=>document.getElementById(id) as any;if(!$('op-workspace-nav')||typeof document.querySelectorAll!=='function')return null;
 document.body.dataset.opWorkspace='true';
 const chapters:string[]=api.chapters;let visible=chapters.map((_,i)=>i),active=-1;
 try{const saved=JSON.parse(localStorage.getItem('optionpilot.workspace.chapters')||'null');if(Array.isArray(saved)){const safe=[...new Set(saved.filter(i=>Number.isInteger(i)&&i>=0&&i<chapters.length))] as number[];if(safe.length)visible=safe;}}catch{}
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const save=()=>{try{localStorage.setItem('optionpilot.workspace.chapters',JSON.stringify(visible));}catch{}};
 const draw=()=>{const page=api.page();active=page;$('op-chapter-links').innerHTML=visible.map(i=>'<button type="button" data-op-chapter="'+i+'"'+(page===i?' aria-current="page"':'')+'><span>'+String(i+1).padStart(2,'0')+'</span>'+esc(chapters[i])+'</button>').join('');$('op-chapter-options').innerHTML=chapters.map((name,i)=>'<label><input type="checkbox" data-op-choose="'+i+'"'+(visible.includes(i)?' checked':'')+'>'+esc(name)+'</label>').join('');};
 const premium=installPremiumWorkspace({getState:api.getState,setDate:api.setDate,replay:api.replay});
 window.addEventListener('optionpilot:open-premium-ladder',((e:any)=>{if(!visible.includes(7)){visible=[...visible,7].sort((a,b)=>a-b);save();}api.turn(7);premium?.openLadder(e.detail);}) as EventListener);
 $('op-chapter-links').onclick=(e:any)=>{const b=e.target.closest('[data-op-chapter]');if(b)api.turn(Number(b.dataset.opChapter));};
 $('op-chapter-options').onchange=(e:any)=>{const i=Number(e.target.dataset.opChoose);if(!Number.isInteger(i)||i<0||i>=chapters.length)return;if(e.target.checked)visible=[...new Set([...visible,i])].sort((a,b)=>a-b);else if(visible.length>1)visible=visible.filter(x=>x!==i);save();if(!visible.includes(api.page()))api.turn(visible[0]);draw();};
 $('op-show-chapters').onclick=()=>{visible=chapters.map((_,i)=>i);save();draw();};
 for(const [id,step] of [['mb-prev',-1],['mb-next',1]] as const)$(id).onclick=()=>{const at=visible.indexOf(api.page()),next=(at+step+visible.length)%visible.length;api.turn(visible[next]);};
 if(!visible.includes(api.page()))Promise.resolve().then(()=>api.turn(visible[0]));

 // Reuse the already-running shared Kite stream: no new source, query, timer or snapshot.
 const oneStatus=$('op-one-status'),oneRows=$('op-one-rows');
 const oneFmt=(v:any,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:d}):'—';
 const oneTime=(v:any)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 let oneLast=0;
 const paintOne=(d:any)=>{
  if(!oneStatus||!oneRows)return;
  const connected=d?.connected===true&&d?.snapshot&&Array.isArray(d.snapshot.indices);
  if(!connected){oneStatus.textContent='LIVE unavailable · '+String(d?.connectionState||'waiting');oneRows.innerHTML='<tr><td colspan="8">No fresh Kite stream · values withheld</td></tr>';oneLast=0;return;}
  if(Date.now()-oneLast<500)return;oneLast=Date.now();
  const snap=d.snapshot,serverMs=Date.parse(d.serverTime||'');
  const valid=(q:any)=>q?.state==='LIVE'&&typeof q.price==='number'&&Number.isFinite(q.price);
  const quote=(q:any)=>valid(q)?oneFmt(q.price):'—';
  const pcr=(a:any)=>{
   const p=d.pcrDisplay?.[a.symbol],at=Date.parse(p?.checkedAt||'');
   return p&&p.expiry===a.expiry&&p.coverage?.complete===true&&p.coverage?.expected>0&&
    Number.isFinite(serverMs)&&Number.isFinite(at)&&at<=serverMs&&serverMs-at<=(p.periodMs||60000)+30000&&
    typeof p.fullPcr==='number'&&Number.isFinite(p.fullPcr)?p:null;
  };
  const order=['NIFTY','SENSEX','BANKNIFTY'];
  oneRows.innerHTML=order.map(symbol=>{
   const a=snap.indices.find((r:any)=>r.symbol===symbol),p=a?pcr(a):null;
   if(!a)return '<tr><th scope="row">'+symbol+'</th><td colspan="7">Not supplied</td></tr>';
   const c=(q:any)=>'<td>'+quote(q)+'</td>';
   const ceStrike=a.ce?.identity?.strike,peStrike=a.pe?.identity?.strike;
   return '<tr><th scope="row">'+symbol+'<small>'+esc(a.expiry||'Expiry unavailable')+'</small></th>'+
    c(a.spot)+c(a.future)+
    '<td>'+quote(a.ce)+'<small>CE '+oneFmt(ceStrike,0)+'</small></td>'+
    '<td>'+quote(a.pe)+'<small>PE '+oneFmt(peStrike,0)+'</small></td>'+
    '<td>'+(p?oneFmt(p.fullPcr,4):'—')+'<small>'+(p?'checked '+oneTime(p.checkedAt):'Incomplete / stale OI')+'</small></td>'+
    '<td>'+(p?oneFmt(p.callWall?.strike,0):'—')+'</td>'+
    '<td>'+(p?oneFmt(p.putWall?.strike,0):'—')+'</td></tr>';
  }).join('');
  oneStatus.textContent='Kite stream · '+oneTime(d.serverTime)+' IST · India VIX '+(valid(snap.vix)?oneFmt(snap.vix.price):'—')+' · — means unavailable';
 };
 const oneActions=$('op-one-actions');
 if(oneActions)oneActions.onclick=(e:any)=>{
  const action=e.target.closest?.('[data-op-one]')?.dataset?.opOne;
  let target:any=null;
  if(action==='LIVE'){$('mb-tools').open=true;$('op-feed-detail').open=true;target=$('op-feed-detail');}
  else if(action==='LADDER'){api.turn(7);premium?.openLadder({source:'LIVE'});target=$('op-premium-workspace');}
  else if(action==='MULTIDAY'){api.turn(7);premium?.openLadder({source:'RECORDED'});target=$('mi-shell');if(target)target.open=true;}
  else if(action==='RAG'){$('mb-tools').open=true;target=$('rag-evidence-card');if(target)target.open=true;}
  if(target&&typeof target.scrollIntoView==='function')target.scrollIntoView({block:'start',behavior:'auto'});
 };
 let lastTicker=0;
 window.addEventListener('optionpilot:live-context',((e:any)=>{const d=e.detail,on=d?.connected&&d?.snapshot;paintOne(d);$('op-workspace-feed').textContent=on?'● LIVE · Kite':String(d?.connectionState||'OFFLINE').replaceAll('_',' ');$('op-workspace-feed').classList.toggle('op-feed-on',!!on);if(Date.now()-lastTicker<250&&on)return;lastTicker=Date.now();const fmt=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:2}):'—',time=(v:any)=>v?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false}):'—';const quotes=[...(d?.snapshot?.indices||[]).map((r:any)=>({label:r.symbol,q:r.spot})),{label:'INDIA VIX',q:d?.snapshot?.vix}];$('op-workspace-ticker').innerHTML=quotes.map((r:any)=>'<div class="op-ticker"><span>'+esc(r.label)+'</span><strong>'+fmt(on?r.q?.price:null)+'</strong><small class="'+(on&&r.q?.changePct>0?'op-positive':on&&r.q?.changePct<0?'op-negative':'')+'">'+(on&&typeof r.q?.changePct==='number'?fmt(r.q.changePct)+'%':'—')+' · '+esc(time(r.q?.observedAt))+'</small></div>').join('');}) as EventListener);
 return {render(){if(active!==api.page())draw();const on=api.page()===7;premium?.setVisible(on);if($('op-premium-workspace'))$('mb-page').hidden=on;premium?.refreshRecorded();}};
}
