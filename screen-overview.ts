/** Reference-shaped full data page. Values are projections of existing source-gated DOM only. */
export const SCREEN_OVERVIEW_HTML=`<section id="rd-shell" aria-label="Full reference data dashboard"><div id="rd-fit-tools"><strong>DATA DASHBOARD</strong><span id="rd-source">Source unavailable</span><button type="button" data-rd-fit="PAGE" aria-pressed="true">Fit page</button><button type="button" data-rd-fit="WIDTH" aria-pressed="false">Fit width</button><button type="button" data-rd-fit="ACTUAL" aria-pressed="false">100%</button><a id="rd-replay-link" href="/recorded-dashboard">▶ Replay</a><button type="button" id="rd-settings">Settings</button><button type="button" id="rd-source-tables">Source tables</button></div><div id="rd-viewport"><div id="rd-page"><div id="rd-navigation"></div><div id="rd-toolbar"></div><nav id="rd-parameters" aria-label="Research evidence"><strong>Research Parameters</strong>${[['PDH/PDL','os-futures'],['O=H','op-atm-weeklies'],['PCR Cross','os-pulse'],['OI Wall','os-walls'],['Spread+Vol','os-premium'],['Delta Multi-DTE','op-atm-weeklies'],['Spot-Prem Lead/Lag','os-futures']].map(([label,id])=>`<button type="button" data-rd-open="${id}"><i aria-hidden="true">↗</i>${label}</button>`).join('')}</nav><div id="rd-market-context"><div><div id="rd-market-head"></div><div id="rd-market-metrics"></div><div id="rd-market-levels"></div></div><aside id="rd-context"><header>Source & coverage<button type="button" data-rd-open="mb-tools" data-rd-inner="rag-evidence-card">↗</button></header><div id="rd-context-rows"></div></aside></div><section class="rd-section" id="rd-levels"><header><b><i>1</i>Spot & Futures (Levels)</b><button type="button" data-rd-open="os-futures">↗</button></header><div id="rd-levels-table"></div></section><section class="rd-section" id="rd-pcr"><header><b><i>2</i>PCR & OI (Ladder)</b><nav aria-label="PCR evidence"><button type="button" data-rd-open="os-walls">Full PCR</button><button type="button" data-rd-open="os-walls">±7</button><button type="button" disabled title="Verified band inventory not exposed by the current source view">±5</button><button type="button" disabled title="Verified band inventory not exposed by the current source view">±3</button></nav><button type="button" data-rd-open="os-walls">↗</button></header><div id="rd-pcr-table"></div></section><section class="rd-section" id="rd-premium"><header><b><i>3</i>Premium behaviour · displayed expiries</b><div id="rd-expiry-controls"></div><button type="button" data-rd-open="os-premium">ATM detail ↗</button><button type="button" data-rd-ladder>All strikes · CE/PE ↗</button><button type="button" data-rd-sides="BOTH">CE+PE</button><button type="button" data-rd-sides="CE">CE</button><button type="button" data-rd-sides="PE">PE</button></header><div id="rd-premium-table"></div></section><section class="rd-section" id="rd-stocks"><header><b><i>4</i>Heavyweights</b><span class="rd-selected-index">NIFTY</span><button type="button" data-rd-open="os-stocks">↗</button></header><div id="rd-stock-table"></div></section><section class="rd-section" id="rd-sectors"><header><b><i>5</i>Sectors</b><span class="rd-selected-index">NIFTY</span><button type="button" data-rd-open="os-sectors">↗</button></header><div id="rd-sector-table"></div></section><section class="rd-section" id="rd-events"><header><b><i>6</i>Notable Events (Recorder / RAG)</b><nav><button type="button" data-rd-open="os-notables">All</button><button type="button" data-rd-open="os-notables">PDH/PDL</button><button type="button" data-rd-open="recorded-replay">O=H</button><button type="button" data-rd-open="os-walls">PCR / OI Wall</button><button type="button" data-rd-open="os-premium">Spread / Delta</button><button type="button" data-rd-open="mb-tools" data-rd-inner="mb-settings">FII/DII</button></nav></header><div id="rd-event-table"></div></section><section class="rd-section" id="rd-memory"><header><b><i>7</i>Memory & Replay (RAG)</b><nav><button type="button" disabled title="No verified matching event is loaded">Similar Events</button><button type="button" data-rd-open="mb-tools" data-rd-inner="recorded-replay">Before Event</button><button type="button" data-rd-open="mb-tools" data-rd-inner="recorded-replay">After Event</button><button type="button" data-rd-open="os-sectors">Sector View</button><button type="button" data-rd-open="op-atm-weeklies">Delta</button></nav></header><div id="rd-memory-table"></div></section><footer id="rd-provenance">ATM overview · all subscribed strikes via CE/PE ↗ · — = unavailable · exact source clocks and full evidence are available through ↗ · BANKNIFTY monthly observation</footer></div></div></section><button type="button" id="rd-return">Fit data page</button><dialog id="os-screen-detail" aria-labelledby="os-screen-detail-title"><div class="rd-dialog-head"><button id="os-screen-close" type="button">← Data page</button><strong id="os-screen-detail-title">Source data</strong></div><div id="os-screen-detail-body"></div></dialog>`;

export const SCREEN_OVERVIEW_CSS=`
#rd-fit-tools{flex-wrap:wrap}#rd-replay-link{display:inline-flex;align-items:center;min-height:30px;padding:3px 8px;font-size:11px;color:#b9ffe0;border:1px solid #408d6a;border-radius:4px;text-decoration:none;white-space:nowrap}
#rd-shell,#rd-return{display:none}
body[data-op-screen=sources] #rd-return{display:block;position:fixed;right:12px;bottom:12px;z-index:60;min-height:40px;background:#005bcb;color:white;font-size:13px;padding:7px 12px;border:1px solid #4299d8;border-radius:5px}
body[data-op-screen=reference]{height:100dvh;overflow:hidden;background:#02080d}
body[data-op-screen=reference] #observations-view{height:100dvh;min-height:0;padding:0;overflow:hidden;box-sizing:border-box}
body[data-op-screen=reference] #observations-view>:not(#market-book),body[data-op-screen=reference] #op-display-tools{display:none!important}
body[data-op-screen=reference] #market-book{height:100%;min-height:0;padding:0;border:0;margin:0;overflow:hidden}
body[data-op-screen=reference] #market-book>:not(#op-one-stop){display:none!important}
body[data-op-screen=reference] #market-book #op-one-stop.os-card{height:100%;min-height:0;display:block;padding:0;margin:0;border:0;overflow:hidden;background:#02080d}
body[data-op-screen=reference] #op-one-stop>:not(#rd-shell):not(#os-screen-detail){display:none!important}
body[data-op-screen=reference] #rd-shell{display:flex;flex-direction:column;height:100%;min-height:0}
#rd-fit-tools{flex:none;display:flex;align-items:center;gap:5px;min-height:34px;padding:3px 7px;background:#061722;border-bottom:1px solid #22536c;box-sizing:border-box}
#rd-fit-tools strong{font-size:11px;color:#45dced;white-space:nowrap}#rd-source{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#c5dbe6;font-size:10px}
#market-book #op-one-stop #rd-fit-tools button{min-height:27px;font-size:11px;padding:3px 8px;border:1px solid #2d688b;border-radius:4px;background:#06131e;white-space:nowrap}
#market-book #op-one-stop #rd-fit-tools button[aria-pressed=true]{background:#005cff;color:white;border-color:#318eff}
#rd-viewport{position:relative;flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;background:#02080d}
#rd-page{position:absolute;top:0;left:0;width:1024px;box-sizing:border-box;padding:7px 12px;background:#02080d;color:#e8f3fa;transform-origin:0 0;font-family:'Arial Narrow',Arial,sans-serif;font-variant-numeric:tabular-nums}
#rd-page #op-workspace-nav{display:block!important;position:static;width:auto;padding:0;margin:0 0 7px;border:0;background:none}
#rd-page #op-workspace-nav:before{display:none!important}
#market-book #rd-page .op-rail-inner{display:grid;grid-template-columns:190px minmax(0,1fr) auto;gap:5px;align-items:center;padding:0;position:static}
#rd-page .op-rail-label,#rd-page .op-rail-foot{display:none}
#market-book #rd-page .op-logo{display:flex!important;gap:0;font-size:0;white-space:nowrap}
#market-book #rd-page .op-logo>span,#market-book #rd-page .op-logo b{font-size:21px;letter-spacing:-.8px;font-family:'Arial Narrow',Arial,sans-serif;text-transform:uppercase;font-weight:800}
#market-book #rd-page .op-logo b{color:#00d2ee;display:inline}
#market-book #rd-page #op-chapter-links{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));overflow:visible;gap:4px;padding:0}
#market-book #rd-page #op-chapter-links button{display:flex;align-items:center;justify-content:center;gap:3px;width:auto;min-width:0;min-height:34px;font-size:9px;line-height:1.1;padding:2px 3px;border:1px solid #1b4964;background:#030c14;white-space:nowrap;border-radius:4px}
#market-book #rd-page #op-chapter-links button>span{font-size:23px;color:#ffc321}
#market-book #rd-page #op-chapter-links button[aria-current=page]{background:#005bff;color:white;border-color:#398dff;box-shadow:0 0 9px #005bff77}
#rd-page #op-terminal-clock{display:flex!important;gap:3px;font-size:10px}#rd-page #op-terminal-clock time{font-size:10px;padding:7px 4px;white-space:nowrap}
#market-book #rd-page #op-research-controls{display:grid!important;grid-template-columns:1.25fr .85fr 1fr;gap:6px;padding:0;margin:0 0 7px;background:none;border:0}
#market-book #rd-page #op-research-controls>div{display:flex;flex-direction:column;min-width:0;padding:6px 8px;border:1px solid #204f6d;background:#030d17;border-radius:6px;gap:5px}
#market-book #rd-page #op-research-controls .op-recorder-group{display:flex;flex-direction:row;align-items:center;border-color:#64367b;grid-column:auto;gap:8px}
#market-book #rd-page #op-research-controls .op-recorder-group>div{flex:1;min-width:0}
#market-book #rd-page #op-research-controls strong{font-size:14px;line-height:1.2;color:#05d3e8}
#market-book #rd-page #op-research-controls .op-recorder-group strong{color:#f7e8fc}
#rd-page .op-recorder-icon{font-size:30px;color:#d28aff}
#market-book #rd-page #op-research-controls small{font-size:10px!important;line-height:1.2!important;color:#c4d8e5}
#market-book #rd-page #op-research-controls nav{display:flex;gap:5px;margin:0;order:0;width:auto}
#market-book #rd-page #op-research-controls button{flex:1;min-height:31px;font-size:11px;padding:4px 6px;white-space:nowrap;border-radius:4px;background:#030b12;border:1px solid #205473}
#market-book #rd-page #op-research-controls .op-recorder-group button{flex:none;min-height:44px;padding:5px 12px;background:linear-gradient(#a800f1,#7300e8);color:white;border-color:#c145fa}
#market-book #rd-page #op-research-controls button[aria-pressed=true]{background:#005bff;color:white;border-color:#228bff}
#rd-page #rd-parameters{display:flex;align-items:center;gap:9px;order:0;width:auto;min-height:35px;padding:4px 6px;margin:0 0 7px;border:1px solid #1b5c76;border-radius:6px;background:#04101a}
#rd-parameters strong{font-size:13px;color:#00dfdf;white-space:nowrap}
#market-book #rd-page #rd-parameters button{display:flex;align-items:center;gap:5px;min-height:25px;padding:2px 0;background:none;border:0;font-size:11px;white-space:nowrap;color:#e9f5fb}
#rd-parameters i{display:inline-grid;place-items:center;width:16px;height:20px;border-radius:2px;background:#0d85f2;color:#032033;font-style:normal;font-weight:800}
#rd-market-context{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1fr);gap:8px;align-items:start}
#rd-market-head{display:flex;align-items:baseline;gap:20px;min-height:40px;padding:5px 9px;border:1px solid #215a7c;border-radius:6px 6px 0 0;background:#030d16}
#rd-market-head strong{font-size:28px;line-height:1;color:#a6dff6}#rd-market-head b{font-size:26px;color:#f0f8ff}#rd-market-head span{font-size:16px}
#rd-market-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin:3px 0}
#rd-market-metrics>span{min-width:0;font-size:11px;padding:6px 5px;border:1px solid #17465f;border-radius:4px;white-space:nowrap}#rd-market-metrics b{margin-left:5px;color:#dff8ff}#rd-market-metrics .rd-pcr-mixed{display:block;font-size:8px;white-space:normal;overflow-wrap:anywhere;color:#e7c77c}
#rd-market-levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:4px 0 6px}
#rd-market-levels>span{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border:1px solid #8f384d;border-radius:5px;font-size:16px;color:#ff4961;background:#19080f}#rd-market-levels b{font-size:21px}
#rd-market-levels>span:nth-child(2){border-color:#a68a21;color:#ffe528;background:#161604}#rd-market-levels>span:nth-child(3){border-color:#009154;color:#00ed79;background:#031a10}
#rd-context{border:1px solid #2b6ba0;border-radius:6px;background:#040f19}
#rd-context>header{position:static!important;display:flex;justify-content:space-between;align-items:center;padding:6px 9px;border-bottom:1px solid #20536e;color:#39dcef;font-size:17px;background:none}
#market-book #rd-page button{font-family:'Arial Narrow',Arial,sans-serif;color:#e8f4ff}
#market-book #rd-context>header button{min-height:24px;font-size:13px;padding:0 6px;background:#061522}
#rd-context-rows>div{display:grid;grid-template-columns:104px minmax(0,1fr);gap:7px;padding:6px 8px;border-bottom:1px solid #153547;font-size:12px;line-height:1.3}
#rd-context-rows b{font-weight:400;color:#d9edf5}
#rd-page .rd-section{margin:0 0 6px;border:1px solid #235e81;border-radius:6px;background:#030c13;overflow:hidden;min-width:0}
#rd-page .rd-section>header{position:static!important;display:flex;align-items:center;gap:6px;min-height:31px;padding:0 4px;background:#031018;border-bottom:1px solid #163f55;flex-wrap:nowrap}
#rd-page .rd-section>header>b{display:flex;align-items:center;gap:9px;font-size:16px;line-height:1.2;color:#00d6ed;white-space:nowrap;flex:none}
#rd-page .rd-section>header>b>i{display:grid;place-items:center;font-size:21px;font-style:normal;color:#063000;background:linear-gradient(#13d604,#008900);border:1px solid #1adb04;border-radius:6px;width:28px;height:29px}
#rd-page .rd-section>header>nav{display:flex;align-items:center;justify-content:flex-end;gap:4px;order:0;width:auto;flex:1;margin:0}
#rd-page .rd-section>header>button{margin-left:auto}
#market-book #rd-page .rd-section header button{min-height:28px;font-size:11px;padding:3px 9px;white-space:nowrap;border:1px solid #245b7a;background:#040e18;border-radius:4px}
#market-book #rd-page .rd-section header button:disabled{opacity:.45;cursor:not-allowed}
#rd-page .rd-selected-index{margin-left:auto;min-width:130px;text-align:center;background:#005bff;color:white;font-size:13px;padding:6px 9px;border-radius:4px}
#rd-expiry-controls{flex:1;min-width:0;overflow:hidden}
#market-book #rd-page #os-premium-expiries{display:flex;gap:4px;margin:0;padding:0;overflow:hidden;order:0;width:auto}
#market-book #rd-page #os-premium-expiries button{min-height:28px;font-size:11px;white-space:nowrap;padding:3px 8px;border:1px solid #225d7f;border-radius:4px;background:#040d17}
#market-book #rd-page #os-premium-expiries button[aria-pressed=true]{background:#005bff;color:white;border-color:#2186ff}
#market-book #rd-page table{display:table;table-layout:auto;width:100%;min-width:0;border-collapse:collapse;white-space:nowrap;font-family:'Arial Narrow',Arial,sans-serif}
#market-book #rd-page table thead{display:table-header-group;position:static;width:auto;height:auto;clip-path:none;overflow:visible}#market-book #rd-page table tbody{display:table-row-group}
#market-book #rd-page table tr{display:table-row;margin:0;padding:0;border:0}
#market-book #rd-page table :is(th,td){display:table-cell;min-width:0;width:auto;white-space:nowrap;overflow-wrap:normal;font:12px/1.25 'Arial Narrow',Arial,sans-serif;padding:5px 5px;border:1px solid #14384d;background:#030c13;vertical-align:middle}
#market-book #rd-page table th{color:#e1eef6;background:#061a26;font-weight:400}
#market-book #rd-page table :is(th,td):before{display:none!important;content:none!important}
#rd-page .rd-cell-note{display:block;font-size:9px;color:#8eacbd;line-height:1.2;max-width:150px;overflow:hidden;text-overflow:ellipsis}
#rd-page .rd-up{color:#00ee74}#rd-page .rd-down{color:#ff3b57}#rd-page .rd-level-pdh{color:#ff445b;background:#220a12}#rd-page .rd-level-pdc{color:#ffe633;background:#201e05}#rd-page .rd-level-pdl{color:#00ea74;background:#032313}
#rd-page #rd-event-table table,#rd-page #rd-memory-table table{table-layout:fixed}#market-book #rd-page :is(#rd-event-table,#rd-memory-table) :is(th,td){white-space:normal;overflow-wrap:anywhere}
#rd-provenance{font-size:10px;color:#9bb6c8;line-height:1.3;padding:2px}
#os-screen-detail{position:fixed;inset:8px;margin:0;width:calc(100vw - 16px);height:calc(100dvh - 16px);max-width:none;max-height:none;padding:0;border:1px solid #3185b1;border-radius:6px;background:#030d15;color:#eaf5ff;overflow:hidden}
#os-screen-detail[open]{display:flex;flex-direction:column}#os-screen-detail::backdrop{background:#000c}
.rd-dialog-head{display:flex;align-items:center;gap:12px;padding:6px 9px;background:#071b2b;border-bottom:1px solid #245b7b;flex:none}
#market-book #op-one-stop #os-screen-close{min-height:38px;padding:5px 10px;font-size:13px;background:#0754b5;color:white;border:1px solid #3280bc}
#os-screen-detail-title{font-size:15px;color:#80e7ff}#os-screen-detail-body{flex:1;min-height:0;overflow:auto;padding:8px;overscroll-behavior:contain}
#os-screen-detail-body>details{display:block!important}#os-screen-detail-body>#mb-tools{padding:0;border:0;margin:0}#os-screen-detail-body>#mb-tools>summary{display:none}
@media(max-width:600px){#rd-fit-tools{gap:3px;padding:3px 4px}#rd-fit-tools strong{font-size:9px}#rd-fit-tools #rd-source{font-size:9px}#market-book #op-one-stop #rd-fit-tools button{font-size:10px;padding:3px 6px}}
`;

export function installScreenOverview(){
 const $=(id:string)=>document.getElementById(id) as any,book=$('market-book'),root=$('op-one-stop'),page=$('rd-page'),viewport=$('rd-viewport');
 if(!book||!root||!page||!viewport||typeof MutationObserver==='undefined')return null;
 const text=(el:any)=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const note=(v:string)=>'<span class="rd-cell-note">'+esc(v)+'</span>';
 const cell=(v:any)=>esc(v&&v!=='Unavailable'?v:'—');
 const paint=(id:string,html:string)=>{const el=$(id);if(el&&el.innerHTML!==html)el.innerHTML=html;};
 const read=(id:any)=>{const source=typeof id==='string'?$(id):id;const table=source?.querySelector('table');return {symbol:String(source?.dataset?.recordedIndex||''),heads:Array.from(table?.querySelectorAll('thead th')||[]).map(text),rows:Array.from(table?.querySelectorAll('tbody tr')||[]).filter((r:any)=>!r.querySelector('[colspan]')).map((r:any)=>Array.from(r.cells).map(text)) as string[][]};};
 const val=(heads:string[],r:string[],name:string)=>r[heads.indexOf(name)]||'—';
 const table=(heads:string[],rows:string[][],missing='— · verified source data unavailable')=>'<table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map((v,i)=>'<td class="'+(/^(PDH|PDC|PDL)$/.test(heads[i])?'rd-level-'+heads[i].toLowerCase():'')+'">'+v+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+heads.length+'">'+esc(missing)+'</td></tr>')+'</tbody></table>';
 const signed=(v:string)=>'<span class="'+(/^\+|↑/.test(v)?'rd-up':/^-\d|↓/.test(v)?'rd-down':'')+'">'+cell(v)+'</span>';
 let fitMode='PAGE',display='reference',active:any=null,frame=0;
 const dialog=$('os-screen-detail'),slot=$('os-screen-detail-body');
 const placements=['op-workspace-nav','op-research-controls','os-premium-expiries'].map(id=>{const node=$(id);return node?{node,parent:node.parentNode,next:node.nextSibling}:null;}).filter(Boolean) as any[];
 const research=()=>String(book.dataset.mainChapter||'1')==='1'&&String(book.dataset.chapter||'1')==='1';
 const enabled=()=>research()&&display==='reference';
 const extent=document.createElement('div');extent.setAttribute('aria-hidden','true');viewport.appendChild(extent);
 const fit=()=>{if(!enabled()||dialog.open)return;const width=1024,height=page.scrollHeight,availableW=viewport.clientWidth,availableH=viewport.clientHeight;if(!height||!availableW||!availableH)return;const scale=fitMode==='PAGE'?Math.min(availableW/width,availableH/height):fitMode==='WIDTH'?availableW/width:1;page.style.transform='scale('+scale+')';page.style.left=Math.max(0,(availableW-width*scale)/2)+'px';viewport.dataset.scale=String(scale);viewport.style.overflow=fitMode==='PAGE'?'hidden':'auto';page.style.position='absolute';extent.style.width=(width*scale)+'px';extent.style.height=(height*scale)+'px';if(fitMode==='WIDTH')viewport.style.overflowX='hidden';};
 const refresh=()=>{
  const on=enabled();document.body.dataset.opScreen=on?'reference':research()&&display==='sources'?'sources':'chapter';
  if(on){const containers=['rd-navigation','rd-toolbar','rd-expiry-controls'];placements.forEach((p,i)=>{if(p.node.parentNode!==$(containers[i]))$(containers[i]).appendChild(p.node);});}
  else{for(const p of placements)if(p.node.parentNode!==p.parent){if(p.next?.parentNode===p.parent)p.parent.insertBefore(p.node,p.next);else p.parent.appendChild(p.node);}if(active)close();return;}
  const selected=root.querySelector('.os-market[aria-pressed="true"]'),name=text(selected?.querySelector('.os-market-head')),price=text(selected?.querySelector('.os-price'))||'—';
  const symbol=name.match(/^(NIFTY|SENSEX|BANKNIFTY)/)?.[1]||'NIFTY';
  const sourceAt=String(selected?.dataset?.recordedAt||''),validation=String(selected?.dataset?.recordedValidation||'UNVERIFIED');
  const sourceClock=Number.isFinite(Date.parse(sourceAt))?new Date(sourceAt).toLocaleString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' IST':'timestamp unavailable';
  const headlineNote=root.dataset.osSource==='RECORDED'?note(price==='—'?'Headline withheld · latest row '+validation+' · '+sourceClock+'. Other sections may have different recorded endpoints.':'Recorded bucket · '+sourceClock):'';
  paint('rd-market-head','<strong>'+esc(symbol)+'</strong><b>'+cell(price)+'</b><span>'+cell(text(selected?.querySelector('.os-market-head small')))+'</span>'+headlineNote);
  const levels=Array.from(selected?.querySelector('.os-levels')?.children||[]) as any[];
  paint('rd-market-levels',levels.map(el=>'<span>'+esc(text(el).split(text(el.querySelector('b')))[0])+'<b>'+cell(text(el.querySelector('b')))+'</b></span>').join(''));
  const l=read('os-future-response'),selectedFuture=l.rows.find(r=>r[0]===symbol+' Futures')||[],pcrCards=Array.from($('os-pcr-strip')?.querySelectorAll('.os-pcr')||[]) as any[];
  const selectedPcr=pcrCards.find(el=>text(el.querySelector(':scope>strong')).startsWith(symbol));
  // Project the already-validated reported observation without calling it fresh Full PCR.
  const reportedPcr=(card:any)=>{const reported=card?.querySelector('.os-pcr-reported');return reported?{value:text(reported.querySelector('b')),details:Array.from(reported.querySelectorAll('small')).map(text).join(' · ')}:null;};
  const selectedReported=reportedPcr(selectedPcr);
  const recorded=root.dataset.osSource==='RECORDED';
  const savedFuture=Array.from(selected?.querySelectorAll('.os-subline')||[]).map(text).map(v=>v.match(/Futures\s+(.+)$/)?.[1]).find(Boolean);
  const vix=text($('os-vix-value')?.querySelector('.os-vix-number'));
  const band=read('os-wall-ladder').rows.find(r=>r[0]?.startsWith(symbol))?.[1]?.split(' / ')[1];
  paint('rd-market-metrics','<span>FUT<b>'+cell(recorded?savedFuture:val(l.heads,selectedFuture,'LTP'))+'</b></span><span>Basis<b>'+cell(val(l.heads,selectedFuture,'Basis'))+'</b></span><span>VIX<b>'+cell(vix)+'</b></span><span>'+(selectedReported?'Reported Full':'Full PCR')+'<b>'+cell(selectedReported?selectedReported.value:text(selectedPcr?.querySelector(':scope>b')))+'</b>'+(selectedReported?'<small class="rd-pcr-mixed">MIXED SOURCE TIMES</small>':'')+'</span>'+'<span>±7 PCR<b>'+cell(band)+'</b></span>');
  const recordedLevels=read($('mb-page')?.querySelector('.mb-research-section[aria-label="Spot & Futures · recorded levels"]'));
  const selectedRecorded=recordedLevels.rows.filter(r=>r[0]?.startsWith(symbol+' '));
  const levelRows=recorded&&selectedRecorded.length?selectedRecorded.map(r=>[cell(r[0]),cell(r[1]),signed(r[2]),signed(r[3]),cell(r[4]),cell(r[5]),cell(r[6]),cell(r[7]?.split(' / ')[0]),cell(r[7]?.split(' / ')[1]),cell(/Fut/.test(r[0])?l.rows.find(x=>x[0]?.startsWith(r[0]?.split(' ')[0])&&/Fut/.test(x[0]))?.[8]:'—'),cell(/Fut/.test(r[0])?l.rows.find(x=>x[0]?.startsWith(r[0]?.split(' ')[0])&&/Fut/.test(x[0]))?.[12]:'—'),cell(/Fut/.test(r[0])?l.rows.find(x=>x[0]?.startsWith(r[0]?.split(' ')[0])&&/Fut/.test(x[0]))?.[9]:'—'),'—',cell(r[8])+note('RECORDED · selected window')]):l.rows.filter(r=>r[0]?.startsWith(symbol+' ')).map(r=>[cell(r[0]),cell(r[1]),signed(r[11]),signed(r[2]),cell(r[3]),cell(r[4]),cell(r[5]),cell(r[6]),cell(r[7]),cell(r[8]),cell(r[12]),cell(r[9]),'—',cell(r[10])]);
  paint('rd-levels-table',table(['Instrument','LTP',recorded?'Window Δ':'Day Δ',recorded?'Window %':'Day %','PDH','PDC','PDL','15m H','15m L','OI','OI Δ','Basis','Note'],levelRows.map(r=>r.filter((_,i)=>i!==12))));
  const wall=read('os-wall-ladder');
  // Only project values that the already source-gated cards actually expose.
  // A reported mixed-time PCR is a separate observation, not a fresh Full PCR.
  paint('rd-pcr-table',table(['Index','Fresh Full PCR','Reported Full · mixed times','ATM ±7 PCR','CE OI','PE OI','CE Δ','PE Δ','CE/PE wall','Source · coverage'],pcrCards.map((card:any)=>{
   const index=text(card.querySelector(':scope>strong')).split(' ')[0];
   const r=wall.rows.find(r=>r[0]?.startsWith(index))||[];
   const full=text(card.querySelector(':scope>b')),reported=reportedPcr(card);
   const band=(r[1]||'').split(' / ')[1];
   return [cell(index),signed(full),reported?note('Reported '+reported.value+' · MIXED SOURCE TIMES'):cell('—'),cell(band),cell((r[2]||'').split('Δ')[0]),cell((r[3]||'').split('Δ')[0]),cell(r[2]?.match(/Δ\s*([^·]+)/)?.[1]?.trim()),cell(r[3]?.match(/Δ\s*([^·]+)/)?.[1]?.trim()),cell(r[4]),note(Array.from(card.querySelectorAll(':scope>small')).map(text).join(' · ')+(reported?' · '+reported.details:''))];
  })));
  const premium=read('os-premium-table');
  const premiumRows=premium.rows.map(r=>{const get=(n:string)=>val(premium.heads,r,n);return [cell(get('Expiry')),cell(get('Type')),cell(get('Strike')),cell(get('LTP ₹')),signed(get('Day Δ ₹')),signed(get('1m Δ ₹')),signed(get('3m Δ ₹')),signed(get('15m Δ ₹')),cell(get('OI')),cell(get('OI Δ')),cell(get('Spread')),cell(get('PDH')),cell(get('PDL')),cell(get('Level position')),cell(get('Source time · IST')!=='—'?get('Source time · IST'):get('Quote time · IST')),cell(get('Status'))];});
  paint('rd-premium-table',table(['Expiry','Side','ATM','LTP ₹','Day Δ ₹','1m Δ ₹','3m Δ ₹','15m Δ ₹','OI','OI Δ','Spread','PDH','PDL','Position','Quote IST','Source'],premiumRows));
  for(const [source,target,label] of [['os-stock-ranks','rd-stock-table','Tracked stock'],['os-sector-ranks','rd-sector-table','Sector proxy']]){const data=read(source);paint(target,table(['#',label,'Price','Day %','Direction','Quote IST'],data.rows.slice(0,5).map(r=>[cell(r[0]),cell(r[1]),cell(r[3]),signed(r[4]),cell(r[6]),cell(r[7])]))+'<small class="rd-cell-note">Tracked market-wide quotes · unweighted ranking. Official constituent weights and index-point contribution not verified.</small>');}
  const recordedEvents=read($('mb-page')?.querySelector('.mb-research-section[aria-label="Recorded notable events"]'));
  const bridge=read($('mb-page')?.querySelector('.mb-research-section[aria-label="Recorder memory and replay"]'));
  const events=read('os-events');paint('rd-event-table',table(['Time · IST','Index','Event','Verified observation'],events.rows.map(r=>[cell(r[0]),cell(r[1]),cell(r[2]),cell(r[3])])));
  const memory=read('os-memory');paint('rd-memory-table',table(['Date','Index','Condition','Market Context','Before (30m)','Event (Time)','After (30m)','Result'],memory.rows.map(r=>r.map(cell))));
  if(recorded){
   const eventRows=recordedEvents.symbol===symbol?recordedEvents.rows.filter(r=>r[3]?.startsWith(symbol+' · ')):[];
   const memoryRows=bridge.symbol===symbol?bridge.rows.filter(r=>r[0]?.match(/^(?:Spot|CE|PE) · (NIFTY|SENSEX|BANKNIFTY)(?: |$)/)?.[1]===symbol):[];
   paint('rd-event-table',table(recordedEvents.heads.length?recordedEvents.heads:['Time','Event','Evidence'],eventRows.map(r=>r.map(cell)),'No verified recorded events for '+symbol+' in the loaded selection.'));
   paint('rd-memory-table',table(bridge.heads.length?bridge.heads:['Contract','Previous','Current'],memoryRows.map(r=>r.map(cell)),'No verified recorded memory for '+symbol+' in the loaded selection.'));
  }
  // Listed expiry placeholders are not observations. Count admitted displayed
  // prices separately and only pair a unique CE/PE at the same expiry/strike.
  const number=(value:string)=>{const result=/^[+-]?\d[\d,]*(?:\.\d+)?$/.test(value)?Number(value.replace(/,/g,'')):NaN;return Number.isFinite(result)?result:NaN;};
  const expirySet=new Set(premium.rows.map(r=>val(premium.heads,r,'Expiry')).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)));
  const admitted=premium.rows.filter(r=>['LIVE','RECORDED'].includes(val(premium.heads,r,'Status'))&&number(val(premium.heads,r,'LTP ₹'))>0&&number(val(premium.heads,r,'Strike'))>0&&expirySet.has(val(premium.heads,r,'Expiry')));
  const paired=new Set<string>();
  for(const expiry of expirySet){const rows=admitted.filter(r=>val(premium.heads,r,'Expiry')===expiry),strikes=new Set(rows.map(r=>number(val(premium.heads,r,'Strike'))));for(const strike of strikes){const same=rows.filter(r=>number(val(premium.heads,r,'Strike'))===strike);if(same.filter(r=>val(premium.heads,r,'Type')==='CE').length===1&&same.filter(r=>val(premium.heads,r,'Type')==='PE').length===1)paired.add(expiry);}}
  const sides=new Set(premium.rows.map(r=>val(premium.heads,r,'Type')).filter(x=>x==='CE'||x==='PE'));
  const pairText=sides.size===1?'Hidden by '+[...sides][0]+'-only view':paired.size+'/'+expirySet.size+' displayed expiries';
  paint('rd-context-rows',[['Mode',recorded?'RECORDED':'LIVE / source gated'],['CE/PE price pairs',pairText],['Displayed prices',admitted.length+'/'+premium.rows.length+' rows'],['Contract scope','All strikes via CE/PE ↗'],['History','1/3/15m values may be missing'],['RAG','Historical match not verified']].map(([label,value])=>'<div><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>').join('')+'<small class="rd-cell-note">Displayed price availability only; full inventory and matching source times are not asserted.</small>');
  document.querySelectorAll('.rd-selected-index').forEach(el=>el.textContent=symbol);
  $('rd-source').textContent=text($('os-reading-status'))||'Verified source unavailable';$('rd-source').title=$('rd-source').textContent;
  fit();
 };
 const restore=()=>{if(!active)return;const a=active;active=null;for(const item of a.items){if(item.next?.parentNode===item.parent)item.parent.insertBefore(item.node,item.next);else item.parent.appendChild(item.node);if(item.open!==undefined)item.node.open=item.open;if(item.hidden!==undefined)item.node.hidden=item.hidden;}a.trigger?.focus?.();refresh();};
 const close=()=>{if(dialog.open)dialog.close();restore();};
 const open=(targetId:string,trigger?:any,inner?:string)=>{
  if(['recorded-replay','mb-settings','rag-evidence-card'].includes(targetId)){inner=targetId;targetId='mb-tools';}
  if(targetId==='op-atm-weeklies'){inner='op-atm-weeklies';targetId='os-reference-settings';}
  const node=$(targetId);if(!node||node===dialog||node===slot)return;if(active){if(active.node===node){if(inner&&$(inner))$(inner).open=true;return;}close();}
  const related=targetId==='os-futures'?['os-market-radar']:targetId==='os-walls'?['os-pcr-strip']:[];const targets=related.map($).filter(Boolean).concat(node);
  active={node,items:targets.map((el:any)=>({node:el,parent:el.parentNode,next:el.nextSibling,open:el.tagName==='DETAILS'?el.open:undefined,hidden:el.hidden})),trigger:trigger||document.activeElement};
  for(const el of targets){slot.appendChild(el);el.hidden=false;if(el.tagName==='DETAILS')el.open=true;}if(inner&&$(inner))$(inner).open=true;
  $('os-screen-detail-title').textContent=node.getAttribute('aria-label')||text(node.querySelector?.('summary,h3'))||'Verified source data';dialog.showModal();
 };
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();});};
 const observer=new MutationObserver(schedule);
 for(const id of ['os-market-radar','os-pcr-strip','os-future-response','os-wall-ladder','os-premium-table','os-stock-ranks','os-sector-ranks','os-events','os-memory','os-reading-status','os-vix-value','mb-page'])if($(id))observer.observe($(id),{childList:true,subtree:true,characterData:true});
 observer.observe(book,{attributes:true,attributeFilter:['data-main-chapter','data-chapter']});observer.observe(root,{attributes:true,attributeFilter:['data-os-source']});
 if(typeof ResizeObserver!=='undefined'){const size=new ResizeObserver(()=>fit());size.observe(page);size.observe(viewport);}window.addEventListener('resize',fit);
 $('rd-fit-tools').onclick=(e:any)=>{const button=e.target.closest?.('[data-rd-fit]');if(!button)return;fitMode=button.dataset.rdFit;document.querySelectorAll('[data-rd-fit]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.rdFit===fitMode)));fit();};
 $('rd-source-tables').onclick=()=>{display='sources';refresh();};$('rd-return').onclick=()=>{display='reference';refresh();};$('rd-settings').onclick=()=>open('os-reference-settings');$('os-screen-close').onclick=close;dialog.addEventListener('close',()=>{if(!dialog.open)restore();});
 page.onclick=(e:any)=>{const side=e.target.closest?.('[data-rd-sides]')?.dataset?.rdSides;if(side){$('os-sides')?.onclick?.({target:{closest:()=>({dataset:{osSide:side}})}});return;}if(e.target.closest?.('[data-rd-ladder]')){root.querySelector?.('[data-op-one="'+(root.dataset.osSource==='RECORDED'?'RECORDED':'LADDER')+'"]')?.click?.();return;}const button=e.target.closest?.('[data-rd-open]');if(button)open(button.dataset.rdOpen,button,button.dataset.rdInner);};
 document.addEventListener('click',(e:any)=>{if(document.body.dataset.opScreen!=='reference')return;const button=e.target.closest?.('button');if(!button)return;if(button.closest('#os-date-scope')){queueMicrotask(()=>open('os-date-picker',button));return;}const maps:any={'op-research-open-data':['mb-tools','recorded-replay'],'op-research-settings':['mb-tools','mb-settings'],'os-rag-open':['mb-tools','rag-evidence-card'],'os-memory-open':['mb-tools','recorded-replay']};const destination=maps[button.id];if(destination){e.preventDefault();e.stopImmediatePropagation();open(destination[0],button,destination[1]);}},true);
 window.addEventListener('optionpilot:live-context',()=>queueMicrotask(refresh));document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();return {refresh,open,close};
}
