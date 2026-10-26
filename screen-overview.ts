/** One-viewport projection of the existing gated DOM. No provider requests or market calculations. */
export const SCREEN_OVERVIEW_HTML=`<section id="os-screen-overview" aria-label="One-screen market overview"><div class="os-screen-heading"><div><strong id="os-screen-market">NIFTY · —</strong><span id="os-screen-source">Verified data unavailable</span></div><button id="os-screen-tables" type="button">Full tables ↗</button></div><div id="os-screen-grid">${[['levels','1','Spot & Futures','os-futures'],['pcr','2','PCR & OI · 3 indices','os-walls'],['premium','3','Premium · Four expiries','os-premium'],['stocks','4','Heavyweights','os-stocks'],['sectors','5','Sectors','os-sectors'],['events','6','Notable Events','os-notables'],['memory','7','Memory & RAG','os-memory']].map(([key,num,label,target])=>`<button class="os-screen-card" data-screen-key="${key}" data-screen-open="${target}" type="button" aria-label="Open ${label}"><span class="os-screen-title"><i>${num}</i>${label}<em>↗</em></span><span class="os-screen-values" id="os-screen-${key}">Unavailable</span></button>`).join('')}</div><p class="os-screen-foot">All 7 sections · tap a card for its full table · missing data stays unavailable</p></section><button id="os-screen-return" type="button">▦ One-screen view</button><dialog id="os-screen-detail" aria-labelledby="os-screen-detail-title"><div class="os-screen-dialog-head"><button id="os-screen-close" type="button">← Overview</button><strong id="os-screen-detail-title">Market detail</strong></div><div id="os-screen-detail-body"></div></dialog>`;

export const SCREEN_OVERVIEW_CSS=`
#os-screen-overview,#os-screen-return{display:none}
body[data-op-screen=overview]{height:100dvh;overflow:hidden}
body[data-op-screen=overview] #observations-view{height:100dvh;min-height:0;padding:5px 8px;overflow:hidden;box-sizing:border-box}
body[data-op-screen=overview] #observations-view>:not(#market-book){display:none!important}
body[data-op-screen=overview] #op-display-tools{display:none}
body[data-op-screen=overview] #market-book{display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden;gap:4px}
body[data-op-screen=overview] #market-book>:not(#op-workspace-nav):not(#op-research-controls):not(#op-one-stop){display:none!important}
body[data-op-screen=overview] #market-book #op-workspace-nav{flex:none;margin:0}
body[data-op-screen=overview] #market-book #op-research-controls{flex:none;margin:0}
body[data-op-screen=overview] #market-book #op-one-stop.os-card{flex:1;min-height:0;overflow:hidden;margin:0;padding:0;border:0}
body[data-op-screen=overview] #op-one-stop>#os-dashboard,body[data-op-screen=overview] #op-one-stop>.os-reading-actions,body[data-op-screen=overview] #op-one-stop>#os-preface{display:none!important}
body[data-op-screen=overview] #op-one-stop>#os-screen-overview{display:flex;flex-direction:column;flex:1;min-height:0;gap:5px}
#op-one-stop .os-screen-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;min-height:42px;padding:4px 7px;border:1px solid #1e566d;border-radius:5px;background:#06141c}
#op-one-stop .os-screen-heading>div{display:grid;gap:2px;min-width:0}
#op-one-stop #os-screen-market{font-size:20px;line-height:1.1;color:#d8f4ff}
#op-one-stop #os-screen-source{font-size:11px;line-height:1.2;color:#b2cbd8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70vw}
#market-book #op-one-stop #os-screen-tables{min-height:34px;padding:5px 9px;white-space:nowrap;font-size:12px;background:#0048ad;border:1px solid #297fce;flex:none}
#op-one-stop #os-screen-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:6px}
#market-book #op-one-stop .os-screen-card{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-height:0;min-width:0;overflow:hidden;text-align:left;padding:7px 9px;background:#041018;border:1px solid #205a77;border-radius:6px;color:#ebf6ff;font:12px/1.3 'Arial Narrow',Arial,sans-serif}
#op-one-stop [data-screen-key=levels]{grid-column:1/3;grid-row:1}
#op-one-stop [data-screen-key=pcr]{grid-column:3/5;grid-row:1}
#op-one-stop [data-screen-key=premium]{grid-column:5/7;grid-row:1/3}
#op-one-stop [data-screen-key=stocks]{grid-column:1/3;grid-row:2}
#op-one-stop [data-screen-key=sectors]{grid-column:3/5;grid-row:2}
#op-one-stop [data-screen-key=events]{grid-column:1/5;grid-row:3}
#op-one-stop [data-screen-key=memory]{grid-column:5/7;grid-row:3}
#op-one-stop .os-screen-title{display:flex;align-items:center;gap:6px;flex:none;min-width:0;color:#00d7ed;font-weight:700;font-size:14px;line-height:1.2;white-space:nowrap}
#op-one-stop .os-screen-title i{display:inline-grid;place-items:center;font-style:normal;background:#06a900;color:#043000;border:1px solid #14d10a;border-radius:4px;width:24px;height:24px;font-size:18px;flex:none}
#op-one-stop .os-screen-title em{margin-left:auto;font-style:normal;color:#8fcbeb}
#op-one-stop .os-screen-values{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:hidden;color:#dbeaf3;font-size:13px;line-height:1.35}
#op-one-stop .os-screen-row{display:flex;justify-content:space-between;align-items:baseline;gap:5px;min-width:0;border-bottom:1px solid #123447;padding-bottom:4px}
#op-one-stop .os-screen-row>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#op-one-stop .os-screen-row b{font-size:16px;font-weight:600;flex:none;font-variant-numeric:tabular-nums}
#op-one-stop .os-screen-note{color:#9dbbcb;font-size:11px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
#op-one-stop .os-screen-foot{flex:none;margin:0;font-size:10px;color:#98b7c9;line-height:1.2;text-align:center}
#market-book #op-one-stop .os-screen-card:focus-visible{outline:2px solid #67ebff;outline-offset:-3px}
body[data-op-screen=tables] #op-one-stop>#os-screen-return{display:block;position:fixed;right:12px;bottom:12px;z-index:55;min-height:42px;padding:8px 14px;background:#0050b8;color:white;border:1px solid #58bfff;border-radius:6px;font-size:13px}
#os-screen-detail{width:min(1400px,calc(100vw - 16px));height:calc(100dvh - 16px);max-width:none;max-height:none;padding:0;border:1px solid #3483aa;border-radius:7px;background:#040c13;color:#e5f2ff;overflow:hidden}
#os-screen-detail[open]{display:flex;flex-direction:column}
#os-screen-detail::backdrop{background:#000c}
#op-one-stop .os-screen-dialog-head{display:flex;align-items:center;gap:12px;flex:none;padding:6px 9px;border-bottom:1px solid #235778;background:#081c2b}
#market-book #op-one-stop #os-screen-close{min-height:38px;font-size:13px;padding:5px 10px;background:#0754b4;color:white;border:1px solid #3486ca}
#os-screen-detail-title{font-size:15px;color:#92eeff}
#os-screen-detail-body{flex:1;min-height:0;overflow:auto;padding:8px;overscroll-behavior:contain}
#os-screen-detail-body>details{display:block!important;max-height:none}
#os-screen-detail-body>#mb-tools{margin:0;border:0;padding:0}
#os-screen-detail-body>#mb-tools>summary{display:none}
#os-screen-detail-body .os-panel{margin:0!important}
@media(max-width:760px){
body[data-op-screen=overview] #observations-view{padding:4px}
body[data-op-screen=overview] #market-book{gap:4px}
body[data-op-screen=overview] #market-book .op-logo>span,body[data-op-screen=overview] #market-book .op-logo b{font-size:15px}
body[data-op-screen=overview] #market-book #op-chapter-links{padding:0;gap:3px}
body[data-op-screen=overview] #market-book #op-chapter-links button{min-height:32px;padding:3px 6px;font-size:9px}
body[data-op-screen=overview] #market-book #op-chapter-links button>span{font-size:19px}
body[data-op-screen=overview] #market-book #op-research-controls{gap:3px}
body[data-op-screen=overview] #market-book #op-research-controls>div{padding:3px 4px;gap:2px}
body[data-op-screen=overview] #market-book #op-research-controls .op-recorder-group{padding:3px 5px}
body[data-op-screen=overview] #market-book #op-research-controls .op-recorder-icon{font-size:22px}
body[data-op-screen=overview] #market-book #op-research-controls .op-recorder-group button{min-height:30px;font-size:10px;padding:4px 8px}
body[data-op-screen=overview] #market-book #op-research-controls button{min-height:29px}
body[data-op-screen=overview] #market-book #op-research-controls strong{font-size:11px}
body[data-op-screen=overview] #market-book #op-research-controls small{font-size:9px!important;line-height:1.1!important}
#op-one-stop .os-screen-heading{min-height:37px;padding:4px 6px;gap:4px}
#op-one-stop #os-screen-market{font-size:18px}
#op-one-stop #os-screen-source{font-size:10px;max-width:65vw}
#market-book #op-one-stop #os-screen-tables{font-size:10px;min-height:30px;padding:4px 6px}
#op-one-stop #os-screen-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:1fr 1.2fr 1fr 1fr;gap:4px}
#op-one-stop [data-screen-key=levels]{grid-column:1;grid-row:1}
#op-one-stop [data-screen-key=pcr]{grid-column:2;grid-row:1}
#op-one-stop [data-screen-key=premium]{grid-column:1/3;grid-row:2}
#op-one-stop [data-screen-key=stocks]{grid-column:1;grid-row:3}
#op-one-stop [data-screen-key=sectors]{grid-column:2;grid-row:3}
#op-one-stop [data-screen-key=events]{grid-column:1;grid-row:4}
#op-one-stop [data-screen-key=memory]{grid-column:2;grid-row:4}
#market-book #op-one-stop .os-screen-card{padding:5px;gap:4px;font-size:11px}
#op-one-stop .os-screen-title{font-size:12px;gap:4px;white-space:normal}
#op-one-stop .os-screen-title i{font-size:15px;width:20px;height:20px}
#op-one-stop .os-screen-values{font-size:11px;gap:4px;line-height:1.25}
#op-one-stop .os-screen-row{gap:3px;padding-bottom:3px}
#op-one-stop .os-screen-row b{font-size:13px}
#op-one-stop .os-screen-note{font-size:10px;-webkit-line-clamp:2}
#op-one-stop .os-screen-foot{font-size:9px}
#op-one-stop [data-screen-key=premium] .os-screen-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px}
#op-one-stop [data-screen-key=premium] .os-screen-note{grid-column:1/-1}
#os-screen-detail{width:calc(100vw - 8px);height:calc(100dvh - 8px)}
}
`;

/** Existing DOM remains the sole evidence source; moving panels preserves their IDs and event handlers. */
export function installScreenOverview(){
 const $=(id:string)=>document.getElementById(id) as any,board=$('os-screen-overview'),book=$('market-book'),root=$('op-one-stop');
 if(!board||!book||!root||typeof MutationObserver==='undefined'||typeof document.createElement!=='function')return null;
 const text=(el:any)=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const lines=(id:string)=>Array.from($(id)?.querySelectorAll?.('table tbody tr')||[]).filter((r:any)=>!r.querySelector('[colspan]')).map((r:any)=>Array.from(r.cells).map(text)) as string[][];
 const row=(label:string,value:string)=>'<span class="os-screen-row" title="'+esc(label+' · '+(value||'—'))+'"><span>'+esc(label)+'</span><b>'+esc(value||'—')+'</b></span>';
 const note=(v:string)=>'<span class="os-screen-note">'+esc(v)+'</span>';
 const put=(id:string,html:string)=>{const el=$(id);if(el&&el.innerHTML!==html)el.innerHTML=html;};
 let mode='overview',active:any=null,frame=0;
 const dialog=$('os-screen-detail'),slot=$('os-screen-detail-body');
 const close=()=>{if(dialog.open)dialog.close();restore();};
 const restore=()=>{if(!active)return;const a=active;active=null;for(const item of a.items){if(item.next?.parentNode===item.parent)item.parent.insertBefore(item.node,item.next);else item.parent.appendChild(item.node);if(item.open!==undefined)item.node.open=item.open;if(item.hidden!==undefined)item.node.hidden=item.hidden;}a.trigger?.focus?.();refresh();};
 const open=(id:string,trigger?:any,inner?:string)=>{
  const node=$(id);if(!node||node===dialog||node===slot)return;
  if(active){if(active.node===node){if(inner&&$(inner))$(inner).open=true;return;}close();}
  const related=id==='os-futures'?['os-market-radar']:id==='os-walls'?['os-pcr-strip']:[];
  const targets=related.map($).filter(Boolean).concat(node);
  active={node,items:targets.map((el:any)=>({node:el,parent:el.parentNode,next:el.nextSibling,open:el.tagName==='DETAILS'?el.open:undefined,hidden:el.hidden})),trigger:trigger||document.activeElement};
  for(const el of targets){slot.appendChild(el);el.hidden=false;if(el.tagName==='DETAILS')el.open=true;}if(inner&&$(inner))$(inner).open=true;
  $('os-screen-detail-title').textContent=node.getAttribute('aria-label')||text(node.querySelector?.('summary,h3'))||'Market evidence';
  dialog.showModal();
 };
 const apply=()=>{const enabled=String(book.dataset.mainChapter||'1')==='1'&&String(book.dataset.chapter||'1')==='1';document.body.dataset.opScreen=enabled?mode:'chapter';if(!enabled&&active)close();};
 const refresh=()=>{
  apply();
  const selected=root.querySelector('.os-market[aria-pressed="true"]');
  $('os-screen-market').textContent=text(selected?.querySelector('.os-market-head'))+' · '+(text(selected?.querySelector('.os-price'))||'—');
  const source=text($('os-reading-status'))||'Verified data unavailable';$('os-screen-source').textContent=source;$('os-screen-source').title=source;
  const levels=lines('os-future-response').slice(0,2);
  const recorded=root.dataset.osSource==='RECORDED';
  const savedFuture=Array.from(selected?.querySelectorAll('.os-subline')||[]).map(text).map(v=>v.match(/Futures\s+(.+)$/)?.[1]).find(Boolean);
  put('os-screen-levels',recorded?row('Spot · recorded',text(selected?.querySelector('.os-price')))+row('Futures · saved',savedFuture||'—')+note('Saved futures expiry unavailable'):levels.length?levels.map(r=>row(r[0],r[1])+(r[2]&&r[2]!=='—'?note('Day '+r[2]):'')).join(''):note('Verified Spot / futures unavailable'));
  const pcrCards=Array.from($('os-pcr-strip')?.querySelectorAll('.os-pcr')||[]) as any[];
  put('os-screen-pcr',pcrCards.length?pcrCards.slice(0,3).map(card=>row(text(card.querySelector(':scope>strong')),text(card.querySelector(':scope>b')))).join(''):note('Verified Full PCR / OI unavailable'));
  const premiums=lines('os-premium-table');
  put('os-screen-premium',premiums.length?premiums.slice(0,8).map(r=>row(r[0]+' '+r[1]+' · '+r[2],r[3])).join(''):note('No verified exact-contract premiums. Open Data to select a recorded session.'));
  for(const [target,id] of [['stocks','os-stock-ranks'],['sectors','os-sector-ranks']]){
   const rows=lines(id).slice(0,3);put('os-screen-'+target,rows.length?rows.map(r=>row(r[1],r[4])).join('')+note('Tracked quotes · day change; weights unavailable'):note(text($(id)?.querySelector('.os-empty'))||'Verified tracked quotes unavailable'));
  }
  const events=lines('os-events');put('os-screen-events',events.length?events.slice(0,2).map(r=>note(r.slice(0,4).join(' · '))).join(''):note(text($('os-events')?.querySelector('.os-empty'))||'No verified events available'));
  const memory=$('os-memory')?.querySelector('tbody');
  const probability=Array.from($('os-rag-context')?.querySelectorAll('.os-rag-line')||[]).find((r:any)=>text(r.querySelector('span'))==='Probability') as any;
  put('os-screen-memory',note(text(memory)||'Recorded matching history unavailable')+note('Probability: '+(text(probability?.querySelector('b'))||'Unavailable')));
 };
 const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;refresh();});};
 const observer=new MutationObserver(schedule);
 for(const id of ['os-market-radar','os-pcr-strip','os-future-response','os-wall-ladder','os-premium-table','os-stock-ranks','os-sector-ranks','os-events','os-memory','os-reading-status','os-rag-context'])if($(id))observer.observe($(id),{childList:true,subtree:true,characterData:true});
 observer.observe(book,{attributes:true,attributeFilter:['data-main-chapter','data-chapter']});
 observer.observe(root,{attributes:true,attributeFilter:['data-os-source']});
 board.onclick=(e:any)=>{const button=e.target.closest?.('[data-screen-open]');if(button)open(button.dataset.screenOpen,button);};
 $('os-screen-tables').onclick=()=>{mode='tables';apply();};
 $('os-screen-return').onclick=()=>{mode='overview';apply();refresh();};
 $('os-screen-close').onclick=close;dialog.addEventListener('close',()=>{if(!dialog.open)restore();});
 document.addEventListener('click',(e:any)=>{
  if(document.body.dataset.opScreen!=='overview')return;
  const button=e.target.closest?.('button');if(!button)return;
  if(button.closest('#os-date-scope')){queueMicrotask(()=>open('os-date-picker',button));return;}
  const maps:any={'op-research-open-data':['mb-tools','recorded-replay'],'op-research-settings':['mb-tools','mb-settings'],'os-rag-open':['mb-tools','rag-evidence-card'],'os-memory-open':['mb-tools','recorded-replay']};
  const destination=maps[button.id];if(destination){e.preventDefault();e.stopImmediatePropagation();open(destination[0],button,destination[1]);}
 },true);
 window.addEventListener('optionpilot:live-context',()=>queueMicrotask(refresh));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 refresh();return {refresh,open,close};
}
