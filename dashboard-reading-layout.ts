/** Shared presentation only: no fetch, market calculation or database writes. */
export const DASHBOARD_READING_HTML = `<aside id="op-reading-tools" aria-label="Dashboard reading settings"><strong>Reading</strong><label>Text size<select id="op-reading-size"><option value="comfortable">Comfortable</option><option value="large">Extra large</option></select></label><label>Tables<select id="op-reading-tables"><option value="cards">Labelled rows</option><option value="wide">Wide table</option></select></label><label>ବିବରଣୀ<select id="op-reading-notes"><option value="hide">ଲୁଚାନ୍ତୁ · Hide</option><option value="show">ଦେଖନ୍ତୁ · Show</option></select></label></aside>`;
export const DASHBOARD_READING_CSS = `
body:not([data-op-notes=show]) [data-op-explanation]{display:none!important}

body[data-op-reading]{--op-reading-text:18px;--op-reading-value:32px;--op-reading-note:16px;font-variant-numeric:tabular-nums;background:#081225;color:#edf3ff}
body[data-op-reading=large]{--op-reading-text:21px;--op-reading-value:36px;--op-reading-note:18px}
#op-reading-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;padding:10px 12px;margin:0;background:#0c1930;color:#eff5ff;border-bottom:1px solid #536681;font:16px/1.5 system-ui}
#op-reading-tools label{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;font:16px/1.5 system-ui;color:#d5e3fa}
#op-reading-tools select{font:16px/1.5 system-ui;padding:7px 10px;min-height:44px;background:#14243c;color:#fff;border:1px solid #69809f;border-radius:6px;max-width:100%}
body[data-op-reading] [data-op-small]{font-size:var(--op-reading-note)!important;line-height:1.5!important}
body[data-op-reading] :is(.metric-label,.metric-change,.timestamp,.mb-label,.mb-note,.mb-route,.mb-foot,.mb-rank-row,.mb-rank-name small){font-size:var(--op-reading-note)!important;line-height:1.5}
body[data-op-reading] :is(.mb-value,.reading-values,.annex-fact,.metric-card){font-size:var(--op-reading-text);line-height:1.5;overflow-wrap:anywhere}
body[data-op-reading] :is(.metric-value,.mb-number){font-size:var(--op-reading-value)!important;line-height:1.3;overflow-wrap:anywhere}
body[data-op-reading] header{position:static}
body[data-op-reading] :is(.container,main){max-width:none;width:100%;min-width:0}
body[data-op-reading] :is(.tab-content,.panel,.mb-box,.metric-card){min-width:0;overflow-wrap:anywhere}
body[data-op-reading] :is(button,input,select){min-height:44px}
body[data-op-reading] .metric-label{color:#c9d7ea}
body[data-op-reading] :is(th,td){vertical-align:top;line-height:1.5;overflow-wrap:anywhere}
body[data-op-reading] .tabs{flex-wrap:wrap;gap:8px}
body[data-op-reading] .chip-nav{flex-wrap:wrap;overflow:visible}
body[data-op-reading] .tab-btn{font-size:var(--op-reading-note);padding:10px 14px}
body[data-op-reading] .bottom-nav button{font-size:14px;min-height:48px}
body[data-op-reading] :is(.metrics-grid,.mb-grid){align-items:start}
body[data-op-tables=cards] table[data-op-wide=true],body[data-op-tables=cards] table[data-op-wide=true] tbody{display:block;width:100%}
body[data-op-tables=cards] table[data-op-wide=true] thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
body[data-op-tables=cards] table[data-op-wide=true] tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px;border:1px solid #536681;border-radius:8px;margin:8px 0;padding:8px;background:#0f1b2c}
body[data-op-tables=cards] table[data-op-wide=true] td{display:block;min-width:0;width:100%;white-space:normal!important;text-align:left!important;padding:8px 10px;border-bottom:1px solid #33465d;font-size:var(--op-reading-text)!important;overflow-wrap:anywhere}
body[data-op-tables=cards] table[data-op-wide=true] td:before{content:attr(data-op-label);display:block;color:#c7d7ef;font:600 var(--op-reading-note)/1.5 system-ui;margin-bottom:4px}
body[data-op-reading] .mb-more-rows{padding:10px;border:1px solid #536681;border-radius:8px;margin:10px 0}
@media(max-width:800px){
 #op-reading-tools{gap:8px;padding:8px}#op-reading-tools>strong{width:100%}
 body[data-op-reading] .container{padding:8px}
 body[data-op-reading] .metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 body[data-op-reading] .metric-card{padding:10px;text-align:left}
 body[data-op-reading] .tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));overflow:visible}
 body[data-op-reading] .tab-btn{white-space:normal}
 body[data-op-tables=cards] table[data-op-card-table],body[data-op-tables=cards] table[data-op-card-table] :is(tbody,tr,td){display:block;width:100%;min-width:0}
 body[data-op-tables=cards] table[data-op-card-table] thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
 body[data-op-tables=cards] table[data-op-card-table] tr{margin:8px 0;border:1px solid #536681;border-radius:8px;padding:6px;background:#0f1b2c}
 body[data-op-tables=cards] table[data-op-card-table] td{white-space:normal!important;text-align:left!important;padding:8px 10px;border-bottom:1px solid #33465d;font-size:var(--op-reading-text)!important;overflow-wrap:anywhere}
 body[data-op-tables=cards] table[data-op-card-table] td:before{content:attr(data-op-label);display:block;color:#c7d7ef;font:600 var(--op-reading-note)/1.5 system-ui;margin-bottom:4px}
 body[data-op-tables=cards] table[data-op-card-table] td:last-child{border-bottom:0}
 body[data-op-tables=cards] .mb-table{overflow:visible;max-height:none}
}
`;

/** Browser installer, deliberately self-contained for serialized dashboards. */
export function installDashboardReading() {
  if (typeof document.querySelectorAll !== 'function' || typeof window === 'undefined') return;
  const body = document.body, size = document.getElementById('op-reading-size') as HTMLSelectElement | null;
  const tables = document.getElementById('op-reading-tables') as HTMLSelectElement | null;
  const notes = document.getElementById('op-reading-notes') as HTMLSelectElement | null;
  if (!body || !size || !tables) return;
  const apply = () => {
    body.dataset.opReading = size.value === 'large' ? 'large' : 'comfortable';
    body.dataset.opTables = tables.value === 'wide' ? 'wide' : 'cards';
    body.dataset.opNotes = notes?.value === 'show' ? 'show' : 'hide';
    try { window.localStorage.setItem('optionpilot.reading', JSON.stringify({size:size.value,tables:tables.value,notes:body.dataset.opNotes})); } catch {}
  };
  try {const v=JSON.parse(window.localStorage.getItem('optionpilot.reading') || '{}');if(['comfortable','large'].includes(v.size))size.value=v.size;if(['cards','wide'].includes(v.tables))tables.value=v.tables;if(notes&&['hide','show'].includes(v.notes))notes.value=v.notes;} catch {}
  size.onchange = apply; tables.onchange = apply; if(notes)notes.onchange = apply; apply();
  const decorate = (root: Element) => {
    const candidates = new Set([...root.querySelectorAll('table'), ...(root.closest('table') ? [root.closest('table')!] : [])]);
    for (const table of candidates) {
      if(table.closest('#op-premium-workspace'))continue;
      const headers = Array.from(table.querySelectorAll('thead tr:last-child th')).map(h=>h.textContent?.trim() || 'Value');
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      if (!headers.length || !rows.length || table.querySelector('[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"])') || rows.some(r=>r.children.length !== headers.length)) continue;
      table.setAttribute('data-op-card-table','true');
      if(headers.length>=7)table.setAttribute('data-op-wide','true');
      rows.forEach(row=>Array.from(row.children).forEach((cell,i)=>cell.setAttribute('data-op-label',headers[i])));
    }
    const small:Element[]=[];
    for (const el of root.querySelectorAll('p,small,label,button,th,td,span,div')) {
      if (el.getAttribute('data-op-small')==='true' || el.closest('#op-reading-tools,#dashboard-live,#op-premium-workspace,#op-workspace-nav,#op-workspace-top,#op-workspace-ticker,svg,script,style') || !Array.from(el.childNodes).some(n=>n.nodeType===3 && n.textContent?.trim())) continue;
      const font = Number.parseFloat(window.getComputedStyle(el).fontSize);
      if (font > 0 && font < 16) small.push(el);
    }
    // Measure first, then write: avoid forcing layout after each marked element.
    small.forEach(el=>el.setAttribute('data-op-small','true'));
  };
  decorate(body);
  if (typeof MutationObserver !== 'undefined') {
    const pending = new Set<Element>();let scheduled = false;
    const observer = new MutationObserver(records=>{
      records.forEach(r=>{if(r.target instanceof Element&&!r.target.closest('#dashboard-live')&&!r.target.closest('#op-premium-workspace')&&!r.target.closest('#op-workspace-nav')&&!r.target.closest('#op-workspace-top')&&!r.target.closest('#op-workspace-ticker'))pending.add(r.target);});
      if(!pending.size||scheduled)return;scheduled=true;
      window.requestAnimationFrame(()=>{scheduled=false;const roots=[...pending].filter(root=>root.isConnected);pending.clear();for(const root of roots)if(!roots.some(parent=>parent!==root&&parent.contains(root)))decorate(root);});
    });
    observer.observe(body,{childList:true,subtree:true});
  }
}

export function withDashboardReading(html: string): string {
  if (html.includes('id="op-reading-tools"') || !html.includes('</body>')) return html;
  return html.replace('</head>', '<style>' + DASHBOARD_READING_CSS + '</style></head>')
    .replace(/<body([^>]*)>/i, '<body$1 data-op-reading="comfortable" data-op-tables="cards">' + DASHBOARD_READING_HTML)
    .replace('</body>', '<script>(()=>{const __name=(fn,_name)=>fn;(' + installDashboardReading.toString() + ')();})();</script></body>');
}
