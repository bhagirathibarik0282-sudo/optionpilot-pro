import { installPremiumWorkspace } from './premium-workspace-view.js';
export const WORKSPACE_NAV_HTML=`<aside id="op-workspace-nav" aria-label="Dashboard chapters"><div class="op-rail-inner"><a class="op-logo" href="/">OP<span>OptionPilot <b>PRO</b></span></a><div class="op-rail-label">YOUR MARKET WORKSPACE</div><div id="op-chapter-links"></div><details id="op-customize"><summary>＋ Choose my chapters</summary><div id="op-chapter-options"></div><button id="op-show-chapters" type="button">Show all chapters</button></details><div class="op-rail-foot">NIFTY · SENSEX<br><span>BANKNIFTY · monthly observation</span></div></div></aside><div id="op-workspace-top"><strong>OptionPilot</strong><div id="op-workspace-feed" role="status">Connecting to market feed</div></div><section id="op-one-stop" aria-label="One-stop market evidence"><div class="op-one-title"><div><span class="op-kicker">ONE CARD / ONE STOP</span><h2>Market command card</h2></div><div id="op-one-status" role="status" aria-live="polite">Waiting for connected live evidence</div></div><div id="op-one-actions" role="group" aria-label="Open existing market tools"><button type="button" data-op-one="LIVE">Live detail</button><button type="button" data-op-one="LADDER">CE / PE ladder</button><button type="button" data-op-one="MULTIDAY">Multi-day research</button><button type="button" data-op-one="RAG">Ask RAG</button></div><div class="op-one-scroll"><table aria-label="Verified latest Kite market readings"><thead><tr><th>Index / expiry</th><th>Spot</th><th>Future</th><th>CE ₹</th><th>PE ₹</th><th>Full PCR</th><th>CE wall</th><th>PE wall</th></tr></thead><tbody id="op-one-rows"><tr><td colspan="8">Waiting for actual Kite stream · unavailable is not zero</td></tr></tbody></table></div><section id="op-atm-weeklies" aria-label="ATM CE and PE by expiry date"><div class="op-atm-head"><div><strong>ATM CE × ATM PE · expiry by expiry</strong><small>Actual listed expiry dates — not DTE 0–4</small></div><div class="op-atm-settings"><label>Index <select id="op-atm-index" aria-label="ATM ladder index"><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><div id="op-atm-modes" role="group" aria-label="ATM CE PE display"><button type="button" data-atm-mode="BOTH" aria-pressed="true">CE + PE</button><button type="button" data-atm-mode="CE" aria-pressed="false">CE only</button><button type="button" data-atm-mode="PE" aria-pressed="false">PE only</button></div></div></div><div id="op-atm-levels" role="group" aria-label="Premium PDH PDL and FIB controls"><button data-atm-level="PDL" type="button" aria-pressed="true">↓ PDL</button><button data-atm-level="PDH" type="button" aria-pressed="false">↑ PDH</button><button data-atm-level="FIB" type="button" aria-pressed="false">FIB R3–S3</button><button data-atm-open-fib type="button" aria-label="Open detailed FIB ladder">FIB detail ↗</button><small id="op-atm-level-note">Select multiple levels together · FIB HOLD needs verified same-contract observations.</small></div><div id="op-atm-status" role="status">Awaiting exact expiry inventory</div><div id="op-atm-pairs" class="op-atm-columns"><p>Waiting for fresh subscribed options.</p></div><p class="op-one-note">ATM strike is selected separately for each exact expiry from available matched CE/PE strikes. Not every calendar week is guaranteed in the Kite subscription. BANKNIFTY remains monthly observation.</p></section><p class="op-one-note">One shared stream; exact expiry and source timestamps. PCR and wall values appear only for a complete, current full-chain snapshot. BANKNIFTY = monthly observation. Read-only evidence, not a trading signal.</p></section>`;

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

#op-atm-weeklies{margin:12px 0 4px;padding:10px;border:1px solid #31546b;border-radius:12px;background:#0b1b2f}
.op-atm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.op-atm-head strong{font-size:16px;color:#d9f6fc}.op-atm-head small{display:block;color:#a3bacb}
.op-atm-settings{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.op-atm-settings label{font-size:12px;color:#b9d0dd}
body[data-op-workspace] #op-atm-index{font-size:13px;min-height:39px;padding:5px}
#op-atm-modes{display:flex;gap:5px;flex-wrap:wrap}
body[data-op-workspace] #op-atm-modes button{font-size:12px;min-height:39px;padding:6px 10px}
#op-atm-modes button[aria-pressed=true]{color:#79f8e9!important;border-color:#79f8e9!important;background:#17434b!important}
#op-atm-levels{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:8px 0}
#op-atm-levels button{border:1px solid #3b5970;border-radius:7px;font-weight:700;font-size:12px;padding:6px 10px;min-height:36px;cursor:pointer}
#op-atm-levels button[data-atm-level=PDL]{color:#ff95a9}
#op-atm-levels button[data-atm-level=PDH]{color:#78ebaa}
#op-atm-levels button[data-atm-level=FIB]{color:#f3cf84}#op-atm-levels button[data-atm-open-fib]{color:#9fb4c9}
#op-atm-levels button[aria-pressed=true]{outline:1px solid currentColor;background:#1b3244}
#op-atm-level-note{color:#a6baca;font-size:11px}
#op-atm-pairs .op-atm-levelnote{color:#9cbac9;font-size:11px}
#op-atm-pairs .op-atm-levelnote[data-level=PDH]{color:#78ebaa}
#op-atm-pairs .op-atm-levelnote[data-level=PDL]{color:#ff95a9}
#op-atm-pairs .op-atm-levelnote[data-level=FIB]{color:#f3cf84}
#op-atm-pairs tr.op-atm-event-down td{background:#3b1529;color:#ffa0ae;font-weight:700;white-space:normal}
#op-atm-pairs tr.op-atm-event-up td{background:#123929;color:#82f7ae;font-weight:700;white-space:normal}
#op-atm-pairs tr.op-atm-event-down[data-flash=true] td{animation:opAtmRedFlash .95s ease-in-out infinite}
#op-atm-pairs tr.op-atm-event-up[data-flash=true] td{animation:opAtmGreenFlash .95s ease-in-out infinite}
@keyframes opAtmRedFlash{50%{background:#8b2341;color:#fff}}
@keyframes opAtmGreenFlash{50%{background:#21674b;color:#fff}}
@media(prefers-reduced-motion:reduce){#op-atm-pairs tr[data-flash=true] td{animation:none!important}}
#op-atm-status{font-size:12px;color:#b7cada;margin:6px 0}
#op-atm-pairs{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:10px;overflow-x:auto;max-width:100%}
#op-atm-pairs.op-atm-solo{grid-template-columns:minmax(260px,1fr)}
.op-atm-side{padding:9px;border:1px solid #34536d;border-radius:10px;min-width:0;background:#11253a}
.op-atm-side h3{font-size:15px;margin:0 0 6px}.op-atm-side[data-atm-side=CE] h3{color:#76e9b5}.op-atm-side[data-atm-side=PE] h3{color:#ff9aaa}
#op-atm-pairs table{min-width:0;width:100%;font-size:12px}
#op-atm-pairs :is(th,td){padding:6px 4px;border-bottom:1px solid #2a4860;background:transparent;text-align:left;white-space:nowrap}
#op-atm-pairs th{color:#a6bfce}#op-atm-pairs td strong{font-variant-numeric:tabular-nums}
#op-atm-pairs td small{display:block;color:#8eb3c8;font-size:10px}
@media(max-width:600px){#op-atm-pairs{grid-template-columns:repeat(2,minmax(195px,1fr))}#op-atm-pairs.op-atm-solo{grid-template-columns:minmax(0,1fr)}.op-atm-side{padding:5px}#op-atm-pairs :is(th,td){font-size:11px;padding:5px 3px}}
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

 // Exact-calendar-expiry ATM pairs; old source context is never used after disconnect.
 let atmSelected='NIFTY',atmMode:'BOTH'|'CE'|'PE'='BOTH',atmLast:any=null;
 const atmPairs=$('op-atm-pairs'),atmStatus=$('op-atm-status');
 const atmEvents=new Map<string,{kind:'PDH'|'PDL';at:string;openHigh:boolean;level:number}>(),atmPrevious=new Map<string,{price:number;at:string;pdh:number|null;pdl:number|null}>();let atmSession='';const atmLayers=new Set<string>(['PDL']);
 const atmLevelNote=$('op-atm-level-note');
 // Existing recorded references are selected by exact contract, same session and TRUE provenance.
 // Never derive PDH/PDL from Kite's current-day OHLC or a different strike/expiry.
 const atmReference=(symbol:string,expiry:string,strike:number,side:'CE'|'PE',tradeDate:string,tickAt:string)=>{
  const session=api.getState?.(),values=session?.current?.[symbol]?.options;
  if(!Array.isArray(values)||session?.date!==tradeDate)return {pdh:null,pdl:null};
  const candidates=values.filter((r:any)=>r?.truth_verdict==='TRUE'&&r.symbol===symbol&&
   String(r.expiry).slice(0,10)===expiry&&r.strike===strike&&r.option_type===side&&
   String(r.minute_bucket).slice(0,10)===tradeDate&&Number.isFinite(Date.parse(r.minute_bucket))&&
   Date.parse(r.minute_bucket)<=Date.parse(tickAt));
  const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  const level=(key:'pdh'|'pdl')=>{
   const found=candidates.filter((r:any)=>finite(r[key])).map((r:any)=>r[key]);
   return found.length>0&&found.every((n:number)=>n===found[0])?found[0]:null;
  };
  const pdh=level('pdh'),pdl=level('pdl');
  return pdh!==null&&pdl!==null&&pdh<=pdl?{pdh:null,pdl:null}:{pdh,pdl};
 };
 const atmObservedEvent=(symbol:string,expiry:string,strike:number,side:'CE'|'PE',q:any,level:{pdh:number|null;pdl:number|null},serverMs:number,tradeDate:string)=>{
  const key=[symbol,expiry,strike,side].join('|'),id=q?.identity,at=Date.parse(q?.observedAt||''),received=Date.parse(q?.receivedAt||'');
  if(q?.state!=='LIVE'||id?.role!=='OPTION'||id?.symbol!==symbol||id?.expiry!==expiry||id?.strike!==strike||id?.side!==side||
    typeof q.price!=='number'||!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(at)||!Number.isFinite(received)||
    serverMs-at<0||serverMs-at>30000||serverMs-received<0||serverMs-received>30000)return null;
  const old=atmPrevious.get(key);
  if(old&&at> Date.parse(old.at)&&at-Date.parse(old.at)<=180000){
   let kind:'PDL'|'PDH'|null=null,levelValue:number|null=null;
   if(level.pdl!==null&&old.pdl===level.pdl&&old.price>=level.pdl&&q.price<level.pdl){kind='PDL';levelValue=level.pdl;}
   else if(level.pdh!==null&&old.pdh===level.pdh&&old.price<=level.pdh&&q.price>level.pdh){kind='PDH';levelValue=level.pdh;}
   if(kind&&levelValue!==null){const openHigh=typeof q.dayOpen==='number'&&q.dayOpen>0&&
    typeof q.dayHigh==='number'&&q.dayHigh>=q.dayOpen&&Math.abs(q.dayOpen-q.dayHigh)<.000001;
    atmEvents.set(key,{kind,at:q.observedAt,openHigh,level:levelValue});}
  }
  if(!old||at>Date.parse(old.at))atmPrevious.set(key,{price:q.price,at:q.observedAt,pdh:level.pdh,pdl:level.pdl});
  const event=atmEvents.get(key);
  if(!event||event.level!==level[event.kind.toLowerCase() as 'pdh'|'pdl'])return null;
  if((event.kind==='PDL'&&q.price>=event.level)||(event.kind==='PDH'&&q.price<=event.level))return null;
  const alive=serverMs-Date.parse(event.at)>=0&&serverMs-Date.parse(event.at)<=60000;
  return {...event,flash:alive,tradeDate};
 };

 const atmPrice=(q:any,symbol:string,expiry:string,strike:number,side:'CE'|'PE',serverMs:number)=>{
  const id=q?.identity,observed=Date.parse(q?.observedAt||''),received=Date.parse(q?.receivedAt||'');
  if(q?.state!=='LIVE'||id?.role!=='OPTION'||id?.symbol!==symbol||id?.expiry!==expiry||id?.strike!==strike||id?.side!==side||
    typeof q.price!=='number'||!Number.isFinite(q.price)||q.price<=0||
    !Number.isFinite(observed)||!Number.isFinite(received)||observed>serverMs+5000||serverMs-observed>30000||
    received>serverMs||serverMs-received>30000)return {value:'—',time:'No fresh exact-contract quote'};
  return {value:oneFmt(q.price),time:'Kite '+oneTime(q.observedAt)+' IST'};
 };
 const paintAtm=(d:any)=>{
  if(!atmPairs||!atmStatus)return;
  atmLast=d;
  if(d?.connected!==true){atmEvents.clear();atmPrevious.clear();atmSession='';}
  const snap=d?.snapshot,serverMs=Date.parse(d?.serverTime||''),now=Date.now();
  if(d?.connected!==true||!Array.isArray(snap?.atmExpiryLadder)||!Number.isFinite(serverMs)||serverMs>now+5000||now-serverMs>5000){
   atmPairs.className='op-atm-columns';atmPairs.innerHTML='<p>LIVE unavailable · stale and missing premiums withheld</p>';atmStatus.textContent='No connected, fresh expiry snapshot';return;
  }
  const identity=[snap.runtimeId,snap.tradeDate].join('|');if(identity!==atmSession){atmEvents.clear();atmPrevious.clear();atmSession=identity;}
  const group=snap.atmExpiryLadder.find((x:any)=>x.symbol===atmSelected),spot=group?.spot;
  const rows=Array.isArray(group?.rows)?group.rows:[];
  const freshSpot=spot?.state==='LIVE'&&spot.identity?.role==='SPOT'&&spot.identity?.symbol===atmSelected&&
   typeof spot.price==='number'&&Number.isFinite(spot.price)&&spot.price>0&&
   Number.isFinite(Date.parse(spot.observedAt||''))&&serverMs-Date.parse(spot.observedAt)>=-5000&&serverMs-Date.parse(spot.observedAt)<=30000;
  if(!group||!freshSpot){atmPairs.innerHTML='<p>ATM unavailable · waiting for fresh '+esc(atmSelected)+' Spot / inventory</p>';atmStatus.textContent='Spot not fresh or no exact expiry inventory';return;}
  const safe=rows.filter((r:any)=>/^\d{4}-\d{2}-\d{2}$/.test(r?.expiry||'')&&
    r.expiry>=snap.tradeDate&&Number.isFinite(r.strike)&&r.strike>0).sort((a:any,b:any)=>a.expiry.localeCompare(b.expiry));
  const sides=(atmMode==='BOTH'?['CE','PE']:[atmMode]) as ('CE'|'PE')[];
  const session=api.getState?.(),recordedToday=session?.date===snap.tradeDate;
  const card=(side:'CE'|'PE')=>'<article class="op-atm-side" data-atm-side="'+side+'"><h3>ATM '+side+' · '+esc(atmSelected)+'</h3>'+
    '<table><thead><tr><th>Expiry</th><th>ATM strike</th><th>LTP ₹ / time</th></tr></thead><tbody>'+
    safe.map((r:any)=>{
     const q=r[side.toLowerCase()],v=atmPrice(q,atmSelected,r.expiry,r.strike,side,serverMs),isLive=v.value!=='—';
     const ref=isLive?atmReference(atmSelected,r.expiry,r.strike,side,snap.tradeDate,q.observedAt):{pdh:null,pdl:null};
     const event=isLive?atmObservedEvent(atmSelected,r.expiry,r.strike,side,q,ref,serverMs,snap.tradeDate):null;
     const price=isLive?q.price:null;
     const notes=(['PDH','PDL'] as const).filter(level=>atmLayers.has(level)).map(level=>{
      const value=ref[level.toLowerCase() as 'pdh'|'pdl'];
      const position=price===null||value===null?'':price>value?'↑ above':price<value?'↓ below':'at';
      return '<small class="op-atm-levelnote" data-level="'+level+'">'+level+' '+(value===null?'— / source unavailable':'₹'+oneFmt(value)+' · '+position)+'</small>';
     });
     if(atmLayers.has('FIB')){
      const fib=isLive&&recordedToday?deriveAtmFibHold({symbol:atmSelected,expiry:r.expiry,strike:r.strike,side,
       tradeDate:snap.tradeDate,price:q.price,quoteAt:q.observedAt,prior:session?.baseline?.[atmSelected]?.options,
       observed:session?.current?.[atmSelected]?.options}):null;
      const held=fib?.observedHold,near=fib?.nearest;
      const fibText=held?'FIB '+held.name+' ₹'+oneFmt(held.value)+' · '+held.kind+' RETEST HOLD ('+held.observations+
       ' saved samples) · confirmed '+oneTime(held.confirmedAt)+' IST':
       near?'FIB nearest '+near.name+' ₹'+oneFmt(near.value)+' · '+near.position+' · HOLD unconfirmed':'FIB — source unavailable';
      notes.push('<small class="op-atm-levelnote" data-level="FIB">'+esc(fibText)+
       (fib?.sourceAt?'<small>Previous exact-contract close '+oneTime(fib.sourceAt)+' IST · sampled, not candle-confirmed</small>':'')+'</small>');
     }
     const dayOpenHigh=isLive&&typeof q.dayOpen==='number'&&q.dayOpen>0&&typeof q.dayHigh==='number'&&Math.abs(q.dayOpen-q.dayHigh)<.000001;
     const [yy,mm,dd]=r.expiry.split('-');
     const main='<tr><td title="'+esc(r.expiry)+'">'+dd+'/'+mm+'/'+yy.slice(2)+'</td><td>'+oneFmt(r.strike,0)+'</td><td><strong>'+esc(v.value)+'</strong><small>'+esc(v.time)+'</small>'+notes.join('')+(dayOpenHigh?'<small>DAY O=H ✓</small>':'')+'</td></tr>';
     if(!event)return main;
     const down=event.kind==='PDL',direction=down?'↓':'↑',stamp=oneTime(event.at);
     const ohlc=down&&event.openHigh?'DAY O=H + ':'';
     return main+'<tr class="'+(down?'op-atm-event-down':'op-atm-event-up')+'" data-flash="'+String(event.flash)+'"><td colspan="3">'+direction+' '+ohlc+event.kind+' BREAK · '+stamp+' IST (first observed) · '+side+' '+oneFmt(r.strike,0)+'</td></tr>';
    }).join('')+'</tbody></table></article>';
  atmPairs.className='op-atm-columns'+(sides.length===1?' op-atm-solo':'');
  atmPairs.innerHTML=safe.length?sides.map(card).join(''):'<p>No subscribed future expiry with a matched CE/PE strike</p>';
  const missing=(snap.omittedExpiries||[]).filter((x:any)=>typeof x==='string'&&x.startsWith(atmSelected+'|')).length;
  atmStatus.textContent=safe.length+' available expiry date(s) · Spot '+oneFmt(spot.price)+' · '+oneTime(d.serverTime)+' IST'+(missing?' · '+missing+' other expiry inventories omitted':'');
 };
 $('op-atm-levels').onclick=(e:any)=>{
  if(e.target.closest?.('[data-atm-open-fib]')){
   api.turn(7);premium?.openLadder({source:'LIVE',symbol:atmSelected,metric:'fib'});
   const target=$('op-premium-workspace');if(target&&typeof target.scrollIntoView==='function')target.scrollIntoView({block:'start',behavior:'auto'});return;
  }
  const level=e.target.closest?.('[data-atm-level]')?.dataset?.atmLevel;
  if(!['PDH','PDL','FIB'].includes(level))return;
  if(atmLayers.has(level))atmLayers.delete(level);else atmLayers.add(level);
  atmLevelNote.textContent='Combined '+(['PDH','PDL','FIB'].filter(v=>atmLayers.has(v)).join(' + ')||'No level')+
   ' · FIB shows sourced nearest / observed retest only · not a trading signal';
  $('op-atm-levels').querySelectorAll('[data-atm-level]').forEach((b:any)=>b.setAttribute('aria-pressed',String(atmLayers.has(b.dataset.atmLevel))));
  paintAtm(atmLast);
 };
 $('op-atm-index').onchange=(e:any)=>{if(!['NIFTY','SENSEX','BANKNIFTY'].includes(e.target.value))return;atmSelected=e.target.value;paintAtm(atmLast);};
 $('op-atm-modes').onclick=(e:any)=>{const mode=e.target.closest?.('[data-atm-mode]')?.dataset?.atmMode;if(!['BOTH','CE','PE'].includes(mode))return;atmMode=mode;
  $('op-atm-modes').querySelectorAll('[data-atm-mode]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.atmMode===mode)));paintAtm(atmLast);
 };
 const paintOne=(d:any)=>{
  if(!oneStatus||!oneRows)return;
  const connected=d?.connected===true&&d?.snapshot&&Array.isArray(d.snapshot.indices);paintAtm(d);
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
  // Show why an exact-expiry PCR is withheld; never turn partial chain into "full".
  const pcrReason=(a:any)=>{
   const q=a?.pcrSnapshot,c=q?.coverage;
   if(!q)return 'PCR snapshot not received';
   if(q.state==='STALE')return 'PCR source expired';
   if(q.fetchState==='RATE_LIMITED')return 'Kite quote rate-limited · next cycle';
   if(q.fetchState==='REQUEST_REJECTED')return 'Kite quote request rejected';
   if(q.fetchState==='SESSION_REQUIRED')return 'Kite authorization required';
   if(q.fetchState==='IDENTITY_TOO_LONG')return 'Quote identity too long';
   if(q.fetchState==='UPSTREAM_UNAVAILABLE')return 'Kite quote request failed';
   if(!c)return 'OI coverage unavailable';
   if(c.expected>0&&!c.complete){
    const missing=Number(c.missing)||0,stale=Number(c.stale)||0,invalid=Number(c.invalid)||0;
    if((c.freshOi||0)<c.expected)return oneFmt(c.freshOi,0)+'/'+oneFmt(c.expected,0)+' fresh · M:'+missing+' S:'+stale+' I:'+invalid;
    if(c.sourceSkewMs>30000)return 'OI source times not aligned';
   }
   if(c.complete&&q.fullPcr===null)return 'CE total OI is zero';
   return 'Next complete PCR check pending';
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
    '<td>'+(p?oneFmt(p.fullPcr,4):'—')+'<small>'+(p?'checked '+oneTime(p.checkedAt):esc(pcrReason(a)))+'</small></td>'+
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
