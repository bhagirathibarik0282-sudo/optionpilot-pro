/** Screenshot-aligned presentation only. Data provenance and loaders remain in existing modules. */
export const REFERENCE_TERMINAL_CSS=`
body[data-op-workspace]{display:flex;flex-direction:column;background:#02070b!important;margin:0}
body[data-op-workspace] #observations-view{order:0;padding:5px 10px;gap:5px}
body[data-op-workspace] #op-display-tools{order:3;margin:8px 10px;font-size:12px}
body[data-op-workspace] #market-book{padding:0;border:0;background:#02070b;border-radius:0}
#market-book #op-workspace-nav{margin:0 0 6px;padding:0}
#market-book #op-workspace-nav:before{display:none}
#market-book .op-rail-inner{display:grid;grid-template-columns:190px minmax(0,1fr) auto;gap:5px;align-items:center}
#market-book .op-logo{display:flex!important;line-height:1;font-size:0;gap:0}
#market-book .op-logo>span,#market-book .op-logo b{font-family:'Arial Narrow',Arial,sans-serif;font-size:19px;font-weight:800;letter-spacing:-.6px;text-transform:uppercase}
#market-book .op-logo b{color:#00cff2}
#market-book #op-chapter-links{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;overflow:visible;padding:0}
#market-book #op-chapter-links button{display:flex;gap:4px;min-height:34px;padding:2px 5px;font:600 10px/1.1 'Arial Narrow',Arial,sans-serif;border:1px solid #174763;border-radius:4px;background:#030a10;white-space:nowrap;color:#e9f6ff}
#market-book #op-chapter-links button>span{font-size:23px;color:#ffbf15;line-height:1}
#market-book #op-chapter-links button[aria-current=page]{background:#005bff;color:white;box-shadow:0 0 7px #0066ff88;border-color:#358eff}
#op-terminal-clock{display:flex;gap:3px;font:11px/1.3 'Arial Narrow',Arial,sans-serif;white-space:nowrap}
#op-terminal-clock time{padding:7px 5px;border:1px solid #173d50;border-radius:4px;background:#06121b;color:#e5f5ff}
#op-terminal-clock time:last-child{color:#00e873;border-color:#126c3a;background:#041c10}
#market-book #op-workspace-top{display:none}
#market-book #op-subviews{margin:4px 0;font-size:12px;order:9;border:1px solid #17394c;border-radius:4px;padding:4px}
#market-book #op-research-controls{display:grid;grid-template-columns:minmax(300px,1.3fr) minmax(220px,.9fr) minmax(240px,1fr);gap:6px;align-items:stretch;border:0;background:transparent;padding:0;margin:0 0 6px;border-radius:0}
#market-book #op-research-controls>div{min-width:0;border:1px solid #184260;border-radius:6px;background:#040d15;padding:5px 8px;display:flex;flex-direction:column;gap:5px}
#market-book #op-research-controls .op-recorder-group{border-color:#5c286e;background:linear-gradient(100deg,#10051b,#090b13);flex-direction:row;align-items:center;gap:9px}
#market-book #op-research-controls .op-recorder-group>div{flex:1;min-width:0}
#market-book .op-recorder-icon{font-size:32px;color:#d899ff;line-height:1}
#market-book #op-research-controls strong{font:500 13px/1.3 'Arial Narrow',Arial,sans-serif;color:#01d1ea}
#market-book #op-research-controls .op-recorder-group strong{color:#f4eafb}
#market-book #op-research-controls small{font-size:10px;color:#d7cede;line-height:1.2}
#market-book #op-research-controls nav{display:flex;gap:5px;margin:0}
#market-book #op-research-controls button{min-height:29px;min-width:0;padding:4px 8px;border-radius:4px;border:1px solid #1d5575;background:#030b13;font:11px/1.1 'Arial Narrow',Arial,sans-serif;white-space:nowrap;flex:1;color:#eaf5ff}
#market-book #op-research-controls .op-recorder-group button{flex:none;min-height:44px;padding:7px 13px;background:linear-gradient(#a700ed,#7900e9);border-color:#b127f3;color:white}
#market-book #op-research-controls button[aria-pressed=true]{background:#005bff;border-color:#147bff;color:white}
#market-book #os-date-picker{font-size:12px;border:1px solid #26516c;border-radius:5px;margin:3px 0 6px;padding:5px}
#market-book #os-date-picker:not([open]){display:none}
#os-date-options{display:flex;flex-wrap:wrap;gap:5px;margin:5px 0}#os-date-options button{font-size:12px;min-height:36px;padding:5px 8px}
#os-date-note{color:#b5cddd;font-size:11px}
#market-book #op-one-stop.os-card{display:flex;flex-direction:column;border:0;padding:0;background:#02070b;font-family:'Arial Narrow',Arial,sans-serif}
#op-one-stop .os-reading-actions{order:2;margin:4px 0;font-size:10px}
#market-book #op-one-stop .os-reading-actions button{font-size:10px;min-height:26px;padding:3px 6px}
#op-one-stop #os-dashboard{display:flex;flex-direction:column;gap:0;min-width:0}
#market-book #op-one-stop .os-evidence-shortcuts{order:-1;margin:0 0 6px;padding:4px 5px;min-height:35px;gap:9px;background:#040e16;border-color:#18536d;border-radius:5px;flex-wrap:wrap}
#market-book #op-one-stop .os-evidence-shortcuts>span{font-size:12px;color:#00cee6;letter-spacing:0}
#market-book #op-one-stop .os-evidence-shortcuts a{border:0;background:none;min-height:24px;padding:2px;font-size:11px;font-weight:400}
#op-one-stop .os-evidence-shortcuts a:before{content:'✓';display:inline-grid;place-items:center;background:#0878e9;color:#061722;width:15px;height:17px;margin-right:5px;border-radius:2px;font-weight:900}
#market-book #op-one-stop .os-terminal-head{display:grid;grid-template-columns:minmax(0,2.15fr) minmax(220px,1fr);gap:8px;align-items:start;margin-bottom:5px}
#op-one-stop #os-radar{display:none}
#op-one-stop .os-markets{grid-template-columns:minmax(0,1fr);margin:0 0 4px;gap:0}
#market-book #op-one-stop .os-market{display:grid;grid-template-columns:auto minmax(100px,1fr) auto;gap:4px 8px;padding:5px 8px;border-color:#225771;box-shadow:none;border-radius:4px;min-height:0;align-items:center}
#op-one-stop .os-market:before{display:none}
#op-one-stop .os-market-head{grid-column:1;grid-row:1;display:flex;gap:8px;font-size:22px;line-height:1.1;margin:0;color:#a5ddf5}
#op-one-stop .os-market-head small{font-size:12px}
#op-one-stop .os-market .os-price{grid-column:2/-1;grid-row:1;font-size:26px;text-align:left;line-height:1.1;margin:0}
#op-one-stop .os-market>.os-subline{grid-column:1/-1;line-height:1.2;margin:0;font-size:10px}
#op-one-stop .os-market>.os-subline:nth-of-type(2),#op-one-stop .os-market>.os-subline:nth-of-type(3){display:none}
#op-one-stop .os-market>.os-levels{grid-column:1/-1;grid-row:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:1px 0;gap:7px}
#op-one-stop .os-market>.os-levels~.os-levels{display:none}
#op-one-stop .os-levels>span{display:flex;justify-content:space-between;align-items:center;gap:4px;padding:5px 7px;border-radius:4px;font-size:12px}
#op-one-stop .os-levels b{font-size:17px;line-height:1.1}
#op-one-stop .os-market>.os-level-state{grid-column:1/-1;font-size:10px;line-height:1.2;min-height:0}
#op-one-stop .os-pcr-overview{margin:0;padding:3px 4px;border-radius:4px;background:#030a10}
#op-one-stop .os-pcr-overview>.os-section-head{display:none}
#op-one-stop .os-pcr-strip{margin:0;gap:4px}
#op-one-stop .os-pcr{padding:3px 4px;border-radius:3px;min-width:0}
#op-one-stop .os-pcr>strong{display:inline;font-size:10px}
#op-one-stop .os-pcr b{display:inline;font-size:15px;margin:0 3px}
#op-one-stop .os-pcr small{font-size:9px;line-height:1.15;margin:0;overflow-wrap:anywhere}
#op-one-stop .os-pcr b span{font-size:13px}
#op-one-stop .os-rag-context{padding:4px 6px;border-radius:5px;font-size:11px;background:#040f19;border-color:#27628d}
#op-one-stop .os-rag-context>strong{font-size:14px;line-height:1.4;padding:0 0 4px;border-bottom:1px solid #16425b}
#op-one-stop .os-rag-context>strong small{font-size:9px}
#op-one-stop .os-rag-line{grid-template-columns:90px minmax(0,1fr);padding:5px 0;gap:5px;line-height:1.2;font-size:11px;border-color:#122e3d}
#op-one-stop .os-rag-line b{font-size:10px;font-weight:400;color:#e6f2f9}
#op-one-stop .os-rag-context>small{display:none}
#market-book #op-one-stop #os-rag-open{font-size:11px;min-height:26px;padding:3px 6px;margin-top:3px;width:100%;background:#063462}
#market-book #op-one-stop .os-panel{margin:0 0 5px;border:1px solid #1d5978;background:#030b11;border-radius:5px;box-shadow:none;min-width:0}
#market-book #op-one-stop details.os-panel>summary{justify-content:flex-start;gap:7px;min-height:30px;padding:0 4px;font:600 15px/1.3 'Arial Narrow',Arial,sans-serif;color:#00d9ee}
#op-one-stop details.os-panel>summary:before{display:none}
#op-one-stop details.os-panel>summary>small{font-size:9px;color:#7198ab}
#op-one-stop .os-section-number{display:inline-grid;place-items:center;width:27px;height:28px;flex:none;background:linear-gradient(#13d100,#008400);color:#052d00;border:1px solid #14b300;border-radius:6px;font-size:20px;font-weight:800;line-height:1;vertical-align:middle;margin-right:4px}
#market-book #op-one-stop .os-panel-body{padding:0 2px 3px}
#market-book #op-one-stop .os-table{min-width:610px;table-layout:auto;border-collapse:collapse;white-space:nowrap;line-height:1.25}
#market-book #op-one-stop .os-table :is(th,td){font-family:'Arial Narrow',Arial,sans-serif;font-size:12px;line-height:1.3;padding:5px 5px;white-space:nowrap;background:#030b11;border:1px solid #123449;vertical-align:middle}
#market-book #op-one-stop .os-table th{font-weight:400;color:#dce9f1;background:#061721}
#market-book #op-one-stop .os-table :is(th,td):first-child{color:#c8eafa}
#market-book #op-one-stop .os-table small{display:inline;margin-left:3px;font-size:9px;line-height:1.2;margin:0}
#op-one-stop .os-table-wrap{overflow-x:auto;min-width:0;max-width:100%;scrollbar-width:thin}
#op-one-stop .os-empty{font-size:10px;padding:5px 6px;min-height:0;line-height:1.3}
#op-one-stop .os-subline,#op-one-stop .os-caption{font-size:10px;line-height:1.3;margin:3px 0}
#op-one-stop .os-ladder-grid{display:block;margin:0}
#market-book #op-one-stop .os-premium{padding:0 2px 3px}
#op-one-stop #os-premium>.os-section-head:first-child{margin:0 2px 3px;min-height:30px;gap:4px}
#market-book #op-one-stop #os-premium h3{font:600 15px/1.3 'Arial Narrow',Arial,sans-serif}
#op-one-stop #os-premium>.os-section-head:nth-child(2){margin:0 4px 3px;font-size:10px}
#op-one-stop #os-premium>.os-section-head:nth-child(2)>strong{display:none}
#op-one-stop #os-premium>.os-section-head:first-child>.os-badge{font-size:9px;padding:2px 5px;margin:0;background:#004fdb;border-color:#1485ff}
#op-one-stop .os-ladder-key{display:none}
#op-one-stop #os-dte-metric{float:right;margin:0 4px 3px;gap:3px}
#market-book #op-one-stop #os-dte-metric button{font-size:10px;min-height:24px;padding:3px 7px}
#op-one-stop #os-expiry-clock{padding:3px 5px;margin:0 4px 3px;border-radius:3px;font-size:10px}
#op-one-stop #os-expiry-clock small{display:inline;font-size:9px;margin-left:5px}
#op-one-stop #os-dte-alignment{font-size:10px;padding:2px 4px}
#op-one-stop #os-dte-alignment .os-badge{font-size:9px;padding:2px 4px;margin:0 3px 0 0}
#op-one-stop .os-expiry-detail,#op-one-stop #op-atm-weeklies{font-size:10px;margin:0;padding:0;border:0}
#op-one-stop .os-expiry-detail>summary,#op-one-stop #op-atm-weeklies>summary{font-size:10px;min-height:21px;padding:3px 5px}
#op-one-stop .os-rank-grid{display:block;margin:0;gap:0}
#market-book #op-one-stop #os-memory-open{font-size:11px;min-height:28px;padding:4px 8px;margin:4px}
#op-one-stop #os-memory p{font-size:10px;margin:3px 4px}
#op-one-stop #os-reference-settings .os-hero{display:flex;margin:4px 0}
#op-one-stop #os-reference-settings .os-hero>div:first-child{display:none}
#op-one-stop #os-reference-settings .os-controls,#op-one-stop #os-reference-settings .os-workspace-controls{margin:5px}
#op-one-stop .os-main-grid:has(#os-pulse){display:block;margin:0}
#op-one-stop #os-premium-expiries{display:flex;gap:4px;overflow-x:auto;order:0;padding:0 4px 4px;max-width:100%;margin:0}
#market-book #op-one-stop #os-premium-expiries button{flex:0 0 auto;border:1px solid #225c7d;border-radius:4px;background:#040e17;color:#e5f4ff;font-size:11px;min-height:29px;padding:4px 10px}
#market-book #op-one-stop #os-premium-expiries button[aria-pressed=true]{background:#005bff;border-color:#2689ff;color:white}
#op-one-stop #os-premium-table{clear:both}
#op-one-stop #os-future-response>.os-subline{font-size:9px;line-height:1.15}
#op-one-stop #os-stock-ranks>.os-empty,#op-one-stop #os-sector-ranks>.os-empty{padding:2px 5px;border:0;background:none;font-size:9px}
/* Legacy terminal mobile rules used !important on every small element. Scope them out of this reference view. */
#market-book #op-one-stop small,#market-book #op-research-controls small,#market-book #os-date-picker small{font-size:10px!important;line-height:1.2!important}
#market-book #op-one-stop .os-table small,#market-book #op-one-stop .os-pcr small,#market-book #op-one-stop .os-rag-context>strong small{font-size:9px!important;line-height:1.2!important}
body[data-op-reading=large] #market-book #op-one-stop small{font-size:13px!important;line-height:1.35!important}
@media(max-width:1100px){#market-book .op-rail-inner{grid-template-columns:180px minmax(0,1fr) auto}#op-terminal-clock{display:flex}#market-book #op-chapter-links button{font-size:9px;padding:3px}#market-book #op-research-controls{grid-template-columns:1.25fr .9fr 1fr}}
@media(max-width:760px){#op-terminal-clock{display:none}#market-book #op-research-controls .op-date-group button{font-size:9px;padding:3px 2px}body[data-op-workspace] #observations-view{padding:5px}#market-book .op-rail-inner{grid-template-columns:minmax(0,1fr)}#market-book .op-logo>span,#market-book .op-logo b{font-size:17px}#market-book #op-chapter-links{display:flex;overflow-x:auto;gap:4px;padding:3px 0}#market-book #op-chapter-links button{flex:0 0 auto;width:auto;min-height:38px;padding:4px 8px;font-size:10px}#market-book #op-research-controls{grid-template-columns:1fr 1fr;gap:5px}#market-book #op-research-controls .op-recorder-group{grid-column:1/-1;padding:5px 7px}#market-book #op-research-controls>div{padding:5px;min-width:0}#market-book #op-research-controls button{font-size:10px;padding:4px;min-height:34px}#market-book #op-research-controls strong{font-size:12px}#market-book #op-research-controls .op-recorder-group button{min-height:38px}#market-book #op-one-stop .os-terminal-head{grid-template-columns:minmax(0,1fr);gap:4px}#market-book #op-one-stop .os-evidence-shortcuts{flex-wrap:nowrap;overflow-x:auto;gap:7px}#market-book #op-one-stop .os-evidence-shortcuts>span{font-size:11px;flex-shrink:0}#market-book #op-one-stop .os-evidence-shortcuts a{flex-shrink:0}#market-book #op-one-stop .os-market{grid-template-columns:auto minmax(0,1fr);gap:3px 6px;padding:5px 6px}#op-one-stop .os-market-head{font-size:20px}#op-one-stop .os-market .os-price{font-size:23px}#op-one-stop .os-levels>span{font-size:11px;padding:5px 4px}#op-one-stop .os-levels b{font-size:15px}#op-one-stop .os-rag-line{grid-template-columns:90px minmax(0,1fr);padding:4px 0}#op-one-stop .os-pcr small{font-size:9px}#market-book #op-one-stop .os-table :is(th,td){font-size:11px;padding:5px}#market-book #op-one-stop details.os-panel>summary{font-size:13px;min-height:32px}#market-book #op-one-stop #os-premium h3{font-size:13px}}
`;
