import { SCREEN_OVERVIEW_HTML } from './screen-overview.js';
/** Production presentation of the approved One Shot design. No network, timers or persistence. */
export function renderOneShotCard(atm:string){
 return `<section id="op-one-stop" class="os-card" data-os-version="ONE_SHOT_LIVE_V1" data-workspace-version="FOUR_EXPIRY_V2" aria-label="One Shot live market command centre">
<div class="os-controls os-reading-actions" aria-label="Dashboard pages"><button type="button" id="os-open-preface" aria-controls="os-preface" aria-expanded="false">00 · ପ୍ରଥମେ ପଢ଼ନ୍ତୁ / Preface</button><button type="button" id="os-open-dashboard" aria-controls="os-dashboard" aria-pressed="true">Live dashboard →</button></div>${SCREEN_OVERVIEW_HTML}<section id="os-preface" class="os-preface" aria-label="Dashboard reading preface" hidden>
<h3 tabindex="-1" id="os-preface-title">00 · ଡ୍ୟାଶବୋର୍ଡ କେମିତି ପଢ଼ିବେ</h3><p>ଏହି କ୍ରମରେ ପଢ଼ନ୍ତୁ: <strong>Spot + PDH/PDL → ତିନି Index PCR → Expiry + CE/PE → Source time</strong></p>
<div class="os-guide-grid">
<article><h4>01 · Spot / PDH / PDL</h4><p>PDH = ପୂର୍ବ sessionର High; PDL = Low; PDC = Close। Spot, Futures ଓ option premiumର ନିଜସ୍ୱ level ଅଲଗା। “Above” ମାନେ ବର୍ତ୍ତମାନ ଉପରେ; “BREAK” ପାଇଁ crossing ଦେଖାଯିବା ଦରକାର।</p></article>
<article><h4>02 · Full PCR · ତିନି Index</h4><p>PE OI ÷ CE OI। Full PCR ସମ୍ପୂର୍ଣ୍ଣ expiryର; ATM ±7 କେବଳ 15 strikeର band। ↑ ↓ ratio ବଦଳୁଛି; ଏହା Spot direction ବା buy/sell signal ନୁହେଁ। ପ୍ରତ୍ୟେକ Indexର expiry ଓ checked time ପଢ଼ନ୍ତୁ।</p></article>
<article><h4>03 · Colourful premium ladder</h4><p><span class="os-ce-label">CE · Call</span> <span class="os-pe-label">PE · Put</span></p><p>ପ୍ରତି cardରେ expiry → calendar DTE → ATM strike → ₹ LTP → % change → quote time। Day % ନିଜ contractର PDC ସହ; Window % ଏକେ contractର ଦୁଇ ସମୟ ସହ। ସବୁଜ/ଲାଲ % ହେଉଛି premium change।</p></article>
<article><h4>04 · Live / Recorded / —</h4><p>LIVE ପାଇଁ verified fresh source ଦରକାର। — ମାନେ ତଥ୍ୟ ମିଳିନାହିଁ, zero ନୁହେଁ। Autoରେ market ବନ୍ଦ ହେଲେ loaded Recorded session ଦେଖାଏ। Live only ବା Recorded ନିଜେ ବାଛିପାରିବେ। Quote time ଓ PCR checked time ଅଲଗା ହୋଇପାରେ। PCR cardର RECORDED ସଂଖ୍ୟା saved observation; ତାହାର date/time ପଢ଼ନ୍ତୁ। ପୁରୁଣା session ପାଇଁ Open recorded ladder / Multi-day research ଖୋଲନ୍ତୁ।</p></article>
<article><h4>05 · FII/DII + Memory</h4><p>FII/DII chapterର dated EOD data ପଢ଼ନ୍ତୁ। Live notable changes ଏହି browser sessionର observation; saved history Recorded / Multi-dayରେ। RAG explanationକୁ ତାହାର source date ସହ ପଢ଼ନ୍ତୁ।</p></article>
<article><h4>06 · ନିଜ ଭାବରେ ଦେଖନ୍ତୁ</h4><p>Index tap କରନ୍ତୁ → Day % ବା Selected window % ବାଛନ୍ତୁ → detailed ladderରେ CE / PE / BOTH। Numbered section tap କରି ଯାଆନ୍ତୁ; Show / hideରେ section ବନ୍ଦ କରନ୍ତୁ।</p></article>
</div><p class="os-caption">Reading guide · 21 October 2026 · ଉପରେ Live dashboard → tap କରି readingsକୁ ଫେରନ୍ତୁ।</p></section>
<div id="os-dashboard">

<nav id="os-evidence-shortcuts" class="os-evidence-shortcuts" aria-label="Verified evidence sections"><span>Research Parameters · open evidence</span><a href="#os-radar">PDH / PDL</a><a href="#os-pulse">Spot × PCR</a><a href="#os-walls">OI walls</a><a href="#os-premium">Premium + spread</a><a href="#os-futures">Spot ↔ Future</a><a href="#os-notables">Events</a></nav>

<div class="os-terminal-head"><div class="os-terminal-evidence"><div class="os-section-head" id="os-radar"><h3><span class="os-selected-heading">Market overview · selected index</span></h3><small>Actual Kite/Recorder values · BANKNIFTY monthly observation</small></div><div id="os-market-radar" class="os-markets" aria-live="off"></div>
<section class="os-pcr-overview" aria-label="All three index PCR"><div class="os-section-head"><h3>Full PCR · three indices</h3><small>PE OI ÷ CE OI · arrows show ratio change</small></div><div id="os-pcr-strip" class="os-pcr-strip"></div></section>
</div><aside id="os-rag-context" class="os-rag-context" aria-label="Recorder RAG context">
 <strong>Today's RAG Context <small>Verified Recorder only</small></strong>
 <div class="os-rag-line"><span>Market Bias</span><b>Verified match unavailable</b></div><div class="os-rag-line"><span>Sector Bias</span><b>Verified match unavailable</b></div><div class="os-rag-line"><span>Heavyweights</span><b>Verified match unavailable</b></div><div class="os-rag-line"><span>FII/DII</span><b>Open dated evidence</b></div><div class="os-rag-line"><span>Historical match</span><b>Open a saved event to compare</b></div>
 <div class="os-rag-line"><span>Probability</span><b>Unavailable · verified matches required</b></div>
 <button type="button" id="os-rag-open">Open Recorder RAG ↗</button>
 <small>No similarity percentage, market bias, sector bias or FII/DII interpretation is generated without matching recorded evidence.</small>
</aside></div>
<nav hidden class="os-fast-links" aria-label="Quick market views"><a href="#os-premium">4 expiries · CE/PE</a><a href="#os-pulse">3m PCR chart</a><a href="#op-research-controls">Recorder / RAG</a></nav>
<details class="os-panel" id="os-futures" open><summary><span class="os-section-number">1</span> Spot & Futures (Levels) <small>Show / hide</small></summary><div class="os-panel-body"><div id="os-future-response"></div><p class="os-caption" data-op-explanation>Same-index futures and exact option contracts, matched observation endpoints. Same direction is descriptive co-movement, not proof that a premium follows a futures contract.</p></div></details>
<details class="os-panel" id="os-walls" open><summary><span class="os-section-number">2</span> PCR & OI (Ladder) <small>Show / hide</small></summary><div class="os-panel-body" id="os-wall-ladder"></div></details>
<div class="os-main-grid os-ladder-grid"><article class="os-panel os-premium" id="os-premium"><div class="os-section-head"><h3><span class="os-section-number">3</span> Premium Ladder (Multi-DTE)</h3><span class="os-badge">FOUR EXPIRY · V2</span><small>Exact dates · current ATM CE / PE</small></div><nav id="os-premium-expiries" aria-label="Premium expiry selection"></nav><div id="os-premium-table"></div></article></div>
<div class="os-rank-grid"><details class="os-panel" id="os-stocks" open><summary><span class="os-section-number">4</span> Heavyweights (Tracked Quotes) <small>Show / hide</small></summary><div class="os-panel-body" id="os-stock-ranks"></div></details><details class="os-panel" id="os-sectors" open><summary><span class="os-section-number">5</span> Sectors (Tracked Proxies) <small>Show / hide</small></summary><div class="os-panel-body" id="os-sector-ranks"></div></details></div>
<details class="os-panel os-terminal-events" id="os-notables" open><summary><span class="os-section-number">6</span> Notable Events (Recorder / RAG) <small>Open / close</small></summary><div class="os-panel-body"><div id="os-events"></div><p class="os-caption" data-op-explanation>Live events are verified observations from this browser session; saved events remain available via Recorder. No reconstructed events.</p></div></details>
<details class="os-panel os-terminal-memory" id="os-memory" open><summary><span class="os-section-number">7</span> Memory & Replay (RAG) <small>Open / close</small></summary><div class="os-panel-body"><div class="os-table-wrap"><table class="os-table" aria-label="Verified historical Recorder matches"><thead><tr><th>Date</th><th>Index</th><th>Condition</th><th>Market Context</th><th>Before</th><th>Event time</th><th>After</th><th>Result</th></tr></thead><tbody><tr><td colspan="8">Verified matching history unavailable · Open Recorder for exact saved-event evidence.</td></tr></tbody></table></div><p class="os-caption" data-op-explanation>Recorded before / event / after comparisons require exact contract and source time. Open the authorized saved-session replay for historical evidence.</p><button type="button" id="os-memory-open">Open saved Recorder & RAG</button><p class="os-caption">No historical win probability is displayed without enough independent, eligible Recorder matches.</p></div></details>
<div class="os-main-grid"><details class="os-panel os-cyan" id="os-pulse"><summary>02 · Spot × Full PCR pulse <small>Show / hide</small></summary><div class="os-panel-body"><div class="os-controls" id="os-window" role="group" aria-label="One Shot observation window">${[1,3,5,6,15,30,60].map(n=>`<button type="button" data-os-window="${n}" aria-pressed="${n===3}">${n}m</button>`).join('')}</div><div class="os-pulse-heading" id="os-spot-context"></div><details class="os-source"><summary>✦ Chart custom</summary><div class="os-workspace-controls"><label>Plot<select id="os-chart-series"><option value="BOTH">Spot + Full PCR</option><option value="SPOT">Spot only</option><option value="PCR">Full PCR only</option></select></label><label>Chart update<select id="os-chart-cadence"><option value="0">Shared live updates</option><option value="180000" selected>3 minutes</option><option value="MANUAL">Manual</option></select></label><button type="button" id="os-chart-refresh">Update chart</button></div></details><div id="os-pulse-chart"></div><details class="os-source"><summary>Chart source</summary><p>Actual received samples, independently scaled spot and PCR axes. Missing intervals are gaps. First-15-minute H/L is shown only when verified recorded references exist; no illustrative guide.</p></details></div></details>
<details class="os-panel os-violet" id="os-vix"><summary>08 · VIX + agreement radar <small>Show / hide</small></summary><div class="os-panel-body"><div id="os-vix-value"></div><div id="os-agreement" class="os-agreement"></div></div></details></div>
<details id="os-reference-settings" class="os-panel"><summary>Settings · source, date, sides &amp; reading guide</summary><div class="os-panel-body"><div class="os-section-head"><strong>Multi-DTE awareness</strong><small id="os-dte-context"></small></div><p class="os-ladder-key"><span class="os-ce-label">CE · Call</span> <span class="os-pe-label">PE · Put</span> Expiry → DTE → ATM strike → ₹ LTP → % change → time</p><div class="os-controls" id="os-dte-metric" role="group" aria-label="Multi-DTE change comparison"><button type="button" data-os-dte-metric="day" aria-pressed="true">Day %</button><button type="button" data-os-dte-metric="window" aria-pressed="false">Selected window %</button></div><div id="os-expiry-clock" class="os-expiry-clock"></div><details class="os-expiry-detail"><summary>Expiry cards · quote times &amp; comparison evidence</summary><div id="os-dte-radar" class="os-dte-grid"></div></details><div id="os-dte-alignment"></div>${atm}<button id="op-research-settings" type="button" aria-controls="mb-settings">Session / Index / Expiry</button><div class="os-hero"><div><span class="os-kicker">OPTIONPILOT PRO · CORTEX / ONE STOP</span><h2>Four expiries.<br><span>One readable workspace.</span></h2></div><div id="op-one-status" role="status" aria-live="polite">Waiting for verified Kite data</div></div>

<div class="os-workspace-controls" aria-label="Four-expiry workspace controls"><label>Index<select id="os-index">${['NIFTY','SENSEX','BANKNIFTY'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Readings<select id="os-source"><option value="AUTO">Auto · recorded when closed</option><option value="LIVE">Live only</option><option value="RECORDED">Recorded session</option></select></label><div class="os-controls" id="os-sides" role="group" aria-label="Premium sides"><button data-os-side="BOTH" aria-pressed="true">CE + PE</button><button data-os-side="CE" aria-pressed="false">ALL CE</button><button data-os-side="PE" aria-pressed="false">ALL PE</button></div></div>
<div id="os-reading-status" class="os-reading-status" role="status"></div>
<details class="os-source"><summary>Recorded date / full inventory</summary><div class="os-workspace-controls"><label>Session<input type="date" id="os-recorded-date"></label><button type="button" id="os-load-recorded">Load full session</button><span id="os-load-status" role="status"></span></div></details>
<div id="op-one-actions" role="group" aria-label="Open existing market tools"><button type="button" data-op-one="LIVE">Live detail</button><button type="button" data-op-one="LADDER">CE / PE ladder</button><button type="button" data-op-one="MULTIDAY">Multi-day research</button><button type="button" data-op-one="RAG">Ask RAG</button><button type="button" data-op-one="RECORDED">Open recorded ladder</button></div>
<details id="os-detailed-views" class="os-detailed-views"><summary>More detail · 10 source-backed views</summary><nav class="os-nav" id="os-navigation" aria-label="One Shot numbered categories">${[['radar','Market radar'],['pulse','Spot × PCR'],['premium','Premium ladder'],['futures','Futures response'],['walls','OI + walls'],['stocks','Heavyweights'],['sectors','Sectors'],['vix','VIX + alignment'],['memory','Memory / replay'],['tools','Sources / tools']].map(([id,label],i)=>`<button type="button" data-os-go="${id}">${String(i+1).padStart(2,'0')} · ${label}</button>`).join('')}</nav></details>
</div></details><details class="os-panel" id="os-tools"><summary>10 · Sources / tools <small>Show / hide</small></summary><div class="os-panel-body"><details id="op-command-index"><summary>All numbered chapters · Show / hide</summary><nav id="op-command-chapters" aria-label="Command card chapter shortcuts"></nav></details><details id="op-summary-panel"><summary>Three-index summary · Show / hide</summary><div class="op-one-scroll"><table aria-label="Verified latest Kite market readings"><thead><tr><th>Index / expiry</th><th>Spot</th><th>Future</th><th>CE ₹</th><th>PE ₹</th><th>Full PCR</th><th>CE wall</th><th>PE wall</th></tr></thead><tbody id="op-one-rows"><tr><td colspan="8">Waiting for actual Kite stream · unavailable is not zero</td></tr></tbody></table></div></details><p class="os-caption">One shared stream; exact expiry and source timestamps. — means unavailable. No simulated prices, synthetic history or execution controls. Weight / index-point contribution requires a verified weight source.</p></div></details>
</div></section>`;
}

export const ONE_SHOT_CSS=`
#market-book #op-one-stop.os-card{--os-cyan:#39e7ff;--os-green:#3aff9c;--os-red:#ff5684;--os-violet:#ae85ff;--os-muted:#aec1de;background:radial-gradient(ellipse at 85% 0%,#49337555,transparent 35%),linear-gradient(145deg,#141a22,#0b0e12);border:1px solid #405887;border-radius:20px;padding:18px;color:#edf6ff;overflow:visible;min-width:0}
#op-one-stop .os-hero{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:12px}#op-one-stop .os-kicker{font-size:11px;letter-spacing:2px;color:#a9b7d5;font-weight:800}#market-book #op-one-stop .os-hero h2{font-size:clamp(27px,3.4vw,42px);line-height:1.08;margin:7px 0;letter-spacing:-1.2px;font-weight:850}#op-one-stop .os-hero h2 span{background:linear-gradient(100deg,#45dfff,#ba87ff,#ff86bd);background-clip:text;color:transparent}#op-one-stop #op-one-status{font-size:12px;line-height:1.5;max-width:280px;border:1px solid #425778;border-radius:12px;padding:10px;background:#152540;text-align:left}
#op-one-stop .os-nav{display:flex;gap:7px;overflow-x:auto;padding:7px 0 14px;scrollbar-width:thin}#market-book #op-one-stop .os-nav button{flex:0 0 auto;background:#1a2843;border:1px solid #405879;font-size:12px;font-weight:750;min-height:42px;padding:8px 12px;white-space:nowrap}#op-one-stop .os-nav button[aria-current]{border-color:#5fe9ff!important;color:#8df4ff!important;background:#16435a!important}
#op-one-stop .os-section-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:7px 0 10px}#market-book #op-one-stop .os-section-head h3{font-size:16px;margin:0;color:#edf6ff}#op-one-stop .os-section-head small,#op-one-stop .os-caption{font-size:12px;color:var(--os-muted);line-height:1.5}#op-one-stop .os-markets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
#market-book #op-one-stop .os-market{position:relative;display:block;min-width:0;text-align:left;border:1px solid #40547b;background:linear-gradient(145deg,#20303b,#121c26);padding:13px;border-radius:15px;color:#edf6ff;box-shadow:0 9px 24px #0003;overflow:hidden}#op-one-stop .os-market:before{content:'';position:absolute;inset:0 12px auto;height:3px;background:var(--os-accent);box-shadow:0 0 18px var(--os-accent)}#market-book #op-one-stop .os-market[aria-pressed=true]{border-color:var(--os-accent);box-shadow:0 0 16px #428dff33}#op-one-stop .os-market-head{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;font-size:13px;font-weight:800;margin:4px 0 10px}#op-one-stop .os-market-head small{font-size:11px;color:var(--os-accent)}#op-one-stop .os-price{display:block;font-size:clamp(20px,2.7vw,30px);line-height:1.2;font-weight:800;letter-spacing:-.6px;font-variant-numeric:tabular-nums}#op-one-stop .os-subline{display:block;font-size:12px;color:var(--os-muted);margin:5px 0;line-height:1.4;overflow-wrap:anywhere}#op-one-stop .os-levels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:9px 0}#op-one-stop .os-levels>span{display:block;min-width:0;text-align:center;background:#ffffff09;border:1px solid #ffffff13;border-radius:7px;padding:5px 2px;font-size:11px;color:#b1c6e4}#op-one-stop .os-levels b{display:block;font-size:12px;color:#eff7ff;overflow-wrap:anywhere}#op-one-stop .os-level-state{display:block;font-size:11px;color:var(--os-accent);min-height:16px}
#op-one-stop .os-main-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(250px,.8fr);gap:12px;margin:12px 0}#op-one-stop .os-panel{min-width:0;border:1px solid #3a4c70;border-radius:15px;padding:0;background:linear-gradient(145deg,#19212b,#11171f);box-shadow:0 8px 24px #0002;margin:10px 0;overflow:hidden}#op-one-stop .os-main-grid>.os-panel,#op-one-stop .os-rank-grid>.os-panel{margin:0}#op-one-stop .os-cyan{background:linear-gradient(140deg,#123448,#131c31 65%);border-color:#32728c}#op-one-stop .os-violet{background:linear-gradient(135deg,#34234e,#18223a 70%);border-color:#755b9c}#op-one-stop details.os-panel>summary{display:flex;justify-content:space-between;gap:8px;align-items:center;cursor:pointer;padding:13px;font-size:15px;font-weight:750;min-height:48px;color:#e4f6ff}#op-one-stop details.os-panel>summary:before{content:'▸';color:#78cde6}#op-one-stop details.os-panel[open]>summary:before{content:'▾'}#op-one-stop details.os-panel>summary small{margin-left:auto;color:#a8b8d3;font-size:11px;font-weight:500}#op-one-stop .os-panel-body{padding:0 13px 13px}#op-one-stop .os-premium{padding:13px}#op-one-stop .os-rank-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#op-one-stop .os-controls{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}#market-book #op-one-stop .os-controls button{font-size:12px;min-height:36px;padding:6px 11px;background:#263653;border:1px solid #4a607e}#market-book #op-one-stop .os-controls button[aria-pressed=true]{color:#efffff;border-color:#41dfff;background:#155e7b}#op-one-stop .os-pcr-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:10px 0 0}#op-one-stop .os-pcr{min-width:0;border:1px solid #3d5879;background:#152c46;border-radius:10px;padding:9px}#op-one-stop .os-pcr>strong{font-size:12px;display:block}#op-one-stop .os-pcr b{display:block;font-size:25px;color:#65e6ff;font-weight:800;font-variant-numeric:tabular-nums;margin:3px 0}#op-one-stop .os-pcr small{font-size:11px;color:#afc2dc;display:block;overflow-wrap:anywhere}
#op-one-stop .os-chart{display:block;width:100%;height:150px;background:#0d1d32;border-radius:10px}#op-one-stop .os-chart text{font:11px system-ui;fill:#b8cbe1}#op-one-stop .os-empty{padding:12px;border:1px dashed #4a6486;border-radius:10px;color:#a8c1df;font-size:13px;line-height:1.6}#op-one-stop .os-source{font-size:12px;margin-top:8px;color:#acbfda}#op-one-stop .os-source summary{cursor:pointer;padding:5px 0}#op-one-stop .os-vix-number{font-size:42px;font-weight:850;color:#ffbd69;letter-spacing:-1px}#op-one-stop .os-agreement{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:12px}#op-one-stop .os-agreement>div{border:1px solid #4b5778;background:#25324b;padding:9px 6px;border-radius:9px;text-align:center;font-size:11px;color:#b1c4df}#op-one-stop .os-agreement b{display:block;font-size:13px;color:#c6ecff;margin-top:3px}#op-one-stop .os-badge{display:inline-block;border:1px solid #455a80;border-radius:8px;padding:5px 8px;margin:4px 4px 0 0;font-size:11px;background:#233452;color:#d8dcff}#op-one-stop .os-up{color:#62ffad!important}#op-one-stop .os-down{color:#ff87a7!important}#op-one-stop .os-alert{border-color:#ff6e9f;color:#ffc2d2;background:#59233f}
#op-one-stop .os-event{display:flex;justify-content:space-between;gap:8px;border:1px solid #3e5577;background:#1b2b46;padding:9px;border-radius:10px;margin-bottom:7px;font-size:12px}#op-one-stop .os-event small{display:block;color:#b3c4dc;font-size:11px}#op-one-stop .os-table-wrap{overflow-x:auto;max-width:100%;min-width:0}#market-book #op-one-stop .os-table{display:table;table-layout:fixed;font-family:system-ui,sans-serif;font-size:12px;min-width:480px;width:100%;border-collapse:collapse;white-space:normal}#market-book #op-one-stop .os-table thead{display:table-header-group}#market-book #op-one-stop .os-table tbody{display:table-row-group}#market-book #op-one-stop .os-table tbody tr{display:table-row}#market-book #op-one-stop .os-table :is(th,td):before{content:none}#market-book #op-one-stop .os-table :is(th,td){display:table-cell;white-space:normal;font-size:12px;padding:8px 5px;overflow-wrap:anywhere;border-bottom:1px solid #3c5070}#op-one-stop .os-table small{display:block;font-size:10px;color:#afc1da}#op-one-stop .os-rank-sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#op-one-stop .os-rank-item{padding:7px 0;border-bottom:1px solid #3a4e6d;font-size:12px}#op-one-stop .os-rank-item b{display:block;font-size:14px}#op-one-stop .os-rank-item small{display:block;color:#b4c7df;font-size:11px}
#op-one-stop #op-atm-weeklies{margin:0;padding:0;background:transparent;border:0}#op-one-stop #op-atm-weeklies>summary{padding:8px 0;font-size:12px;color:#a8bfdc}#op-one-stop .op-atm-head strong{display:none}#op-one-stop .op-atm-head small,#op-one-stop .op-one-note{font-size:11px}#op-one-stop #op-atm-pairs .op-atm-side{background:linear-gradient(135deg,#13413480,#17263e);border-color:#36866c}#op-one-stop #op-atm-pairs .op-atm-side[data-atm-side=PE]{background:linear-gradient(135deg,#57293f80,#17263e);border-color:#995274}#op-one-stop #op-atm-pairs td strong{font-size:20px;font-weight:800}#op-one-stop #op-atm-pairs :is(th,td){white-space:normal;overflow-wrap:anywhere}#op-one-stop #op-atm-pairs .op-atm-levelnote{font-size:11px}#op-one-stop #op-atm-status{font-size:12px}#op-one-stop #op-atm-level-note,#op-one-stop .op-one-note{display:none}#op-one-stop #op-atm-pairs .os-expiry-dte{font-size:10px;color:#b6c9e4}
#market-book #op-one-stop #op-atm-pairs table{display:table;table-layout:fixed;width:100%;min-width:0}#market-book #op-one-stop #op-atm-pairs thead{display:table-header-group}#market-book #op-one-stop #op-atm-pairs tbody{display:table-row-group}#market-book #op-one-stop #op-atm-pairs tbody tr{display:table-row;margin:0;padding:0;border:0}#market-book #op-one-stop #op-atm-pairs :is(th,td){display:table-cell;grid-column:auto;min-width:0;width:auto;white-space:normal;overflow-wrap:anywhere;vertical-align:top}#market-book #op-one-stop #op-atm-pairs :is(th,td):first-child{width:33%}#market-book #op-one-stop #op-atm-pairs :is(th,td):nth-child(2){width:25%}#market-book #op-one-stop #op-atm-pairs td:before{display:none;content:none}
@media(max-width:900px){#op-one-stop .os-main-grid{grid-template-columns:1fr}#op-one-stop .os-rank-grid{grid-template-columns:1fr}}@media(max-width:600px){#market-book #op-one-stop.os-card{padding:10px;border-radius:15px}#op-one-stop .os-hero{display:block}#market-book #op-one-stop .os-hero h2{font-size:29px}#op-one-stop #op-one-status{max-width:none;font-size:12px;margin-top:8px;padding:7px 9px}#op-one-stop .os-kicker{font-size:10px;letter-spacing:1.3px}#op-one-stop .os-markets{gap:5px}#market-book #op-one-stop .os-market{padding:10px 6px;border-radius:11px}#op-one-stop .os-market-head{font-size:11px;margin-bottom:7px;display:block}#op-one-stop .os-market-head small{display:block;font-size:10px;margin-top:3px}#op-one-stop .os-price{font-size:18px;letter-spacing:-.7px}#op-one-stop .os-subline{font-size:10px}#op-one-stop .os-levels{gap:2px}#op-one-stop .os-levels>span{font-size:9px;padding:4px 1px}#op-one-stop .os-levels b{font-size:10px}#op-one-stop .os-level-state{font-size:10px}#op-one-stop .os-section-head small{font-size:11px}#op-one-stop .os-pcr{padding:7px 5px}#op-one-stop .os-pcr>strong{font-size:10px}#op-one-stop .os-pcr b{font-size:21px}#op-one-stop .os-pcr small{font-size:10px}#op-one-stop .os-chart{height:135px}#op-one-stop #op-atm-pairs td strong{font-size:17px}#op-one-stop #op-atm-pairs :is(th,td){font-size:11px}#op-one-stop .os-panel-body{padding:0 9px 10px}#op-one-stop .os-premium{padding:10px}#op-one-stop details.os-panel>summary{font-size:14px;padding:10px}#op-one-stop .os-rank-sides{gap:6px}}

#op-one-stop .os-ladder-grid{grid-template-columns:minmax(0,1fr);align-items:start}
#op-one-stop .os-dte-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:8px;margin:9px 0}
#op-one-stop .os-dte-grid>.os-subline{grid-column:1/-1}
#op-one-stop .os-dte-tile{min-width:0;border:1px solid #51618a;border-radius:12px;padding:10px;background:linear-gradient(145deg,#262342,#14283b)}
#op-one-stop .os-dte-tile h4{margin:0 0 5px;font-size:13px;color:#d5c2ff}
#op-one-stop .os-dte-tile small{display:block;color:#b9cce3;font-size:10px;overflow-wrap:anywhere}
#op-one-stop .os-dte-legs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}
#op-one-stop .os-dte-leg{min-width:0;padding:7px 5px;border-radius:8px;background:#103c3580;border:1px solid #34745d;font-size:11px}
#op-one-stop .os-dte-leg[data-side=PE]{background:#49263a80;border-color:#874767}
#op-one-stop .os-dte-leg b{display:block;font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow-wrap:normal;overflow-x:auto}
#op-one-stop .os-dte-leg em{display:block;font-size:12px;font-style:normal;margin:3px 0}


#op-one-stop [hidden]{display:none!important}
#op-one-stop .os-preface{padding:18px;border:1px solid #7665a2;border-radius:15px;background:linear-gradient(145deg,#242340,#112b39);line-height:1.7}
#op-one-stop .os-preface h3{font-size:22px;margin:0 0 9px;color:#bdefff}
#op-one-stop .os-guide-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#op-one-stop .os-guide-grid article{padding:14px;border:1px solid #526580;border-radius:12px;background:#112138}
#op-one-stop .os-guide-grid h4{margin:0 0 8px;color:#d3c2ff;font-size:16px}
#op-one-stop .os-guide-grid p{font-size:14px;margin:6px 0;color:#e1eaf7}
#op-one-stop .os-ce-label,#op-one-stop .os-pe-label{display:inline-block;padding:4px 9px;border:1px solid #4bcfa0;border-radius:7px;color:#a0ffce;background:#124436;font-weight:750}
#op-one-stop .os-pe-label{border-color:#ef85aa;color:#ffd0df;background:#54283e}
#op-one-stop .os-ladder-key{font-size:12px;line-height:1.8;color:#c6d6ed}
#op-one-stop .os-pcr-overview{padding:12px;border:1px solid #3e859c;border-radius:14px;background:linear-gradient(120deg,#123544,#202640);margin:12px 0}
#op-one-stop .os-pcr-strip{margin-top:7px}
#op-one-stop .os-pcr b span{font-size:22px}
#op-one-stop .os-pcr-recorded{margin-top:8px;padding-top:8px;border-top:1px dashed #7c69a5;color:#dac9ff}
#op-one-stop .os-pcr-recorded>strong{display:block;font-size:20px;color:#dac9ff;font-variant-numeric:tabular-nums}
#op-one-stop .os-dte-leg{border-top:3px solid #56e6ab}
#op-one-stop .os-dte-leg[data-side=PE]{border-top-color:#ff85ae}
#op-one-stop #op-atm-pairs .op-atm-side h4{color:#9fffd0}
#op-one-stop #op-atm-pairs .op-atm-side[data-atm-side=PE] h4{color:#ffd0df}
@media(max-width:600px){#op-one-stop .os-guide-grid{grid-template-columns:1fr}#op-one-stop .os-preface{padding:12px}#op-one-stop .os-pcr-overview{padding:8px}#op-one-stop .os-pcr b span{font-size:16px}}
#op-one-stop .os-workspace-controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:10px 0}#op-one-stop .os-workspace-controls label{display:grid;gap:5px;font-size:12px;color:#bfd0df}#op-one-stop .os-workspace-controls :is(select,input,button){min-height:42px;max-width:100%;border:1px solid #526b7e;border-radius:9px;background:#1c2a35;color:#eff8ff;padding:8px;font:inherit}#op-one-stop .os-workspace-controls .os-controls{margin:0}#op-one-stop .os-reading-status,#op-one-stop .os-expiry-clock{border:1px solid #685c88;background:linear-gradient(110deg,#30243f,#14343b);border-radius:10px;padding:10px;font-size:13px;margin:9px 0}#op-one-stop .os-expiry-clock small{display:block;color:#b6c6d8;font-size:11px;margin-top:5px}#op-one-stop .os-dte-grid{grid-template-columns:repeat(4,minmax(0,1fr))}#op-one-stop .os-missing{background:#151e28;border-style:dashed;box-shadow:none}#op-one-stop .os-pulse-heading{font-size:18px;font-weight:750;margin-bottom:10px}#op-one-stop .os-pulse-heading small{display:block;font-size:12px;color:#b7c8da;font-weight:400}#op-one-stop .os-dte-legs>:only-child{grid-column:1/-1}#op-one-stop .os-dte-leg strong{display:block;color:#d0e5df;font-size:10px;margin:4px 0}#op-one-stop .os-rank-item b{font-size:17px}#op-one-stop .os-card-version{font-size:12px;color:#b9a6df}@media(max-width:1050px){#op-one-stop .os-dte-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){#op-one-stop .os-dte-tile{padding:8px}#op-one-stop .os-dte-leg{padding:6px 4px}#op-one-stop .os-dte-leg b{font-size:16px}#op-one-stop .os-workspace-controls label{flex:1 1 140px;min-width:0}#op-one-stop .os-workspace-controls select{width:100%}}@media(max-width:360px){#op-one-stop .os-dte-grid{grid-template-columns:1fr}}
/* UI-only: preserve existing Kite/Recorder data, source gates, and refresh logic. */
#op-one-stop .os-fast-links{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}
#op-one-stop .os-fast-links a{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:6px 9px;flex:1 1 110px;border:1px solid #43858e;border-radius:9px;background:#153640;color:#adfbff;text-decoration:none;font-size:12px;font-weight:750;text-align:center}
#op-one-stop :is(#os-premium,#os-pulse,#os-radar,#os-walls,#os-memory){scroll-margin-top:18px}
#op-one-stop .os-fast-links a:focus-visible{outline:2px solid #a5f8ff;outline-offset:2px}
@media(max-width:600px){
#market-book #op-one-stop.os-card{padding:8px 9px;border-radius:12px}
#op-one-stop .os-hero{display:flex;gap:0;margin:0 0 6px}
#op-one-stop .os-hero>div:first-child{display:none}
#op-one-stop #op-one-status{margin:0;max-width:100%;width:100%;padding:6px 8px;font-size:11px}
#op-one-stop .os-section-head{margin:5px 0}
#market-book #op-one-stop .os-section-head h3{font-size:14px}
#op-one-stop #os-radar>small{font-size:10px}
#op-one-stop .os-markets{grid-template-columns:minmax(0,1fr);gap:5px;margin:5px 0 7px}
#market-book #op-one-stop .os-market{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:3px 10px;padding:7px 9px;border-radius:9px;min-height:0}
#op-one-stop .os-market-head{grid-column:1;grid-row:1;display:flex;align-items:center;justify-content:flex-start;gap:8px;margin:0;font-size:13px}
#op-one-stop .os-market-head small{display:inline;font-size:11px;margin:0}
#op-one-stop .os-market .os-price{grid-column:2;grid-row:1;text-align:right;font-size:20px}
#op-one-stop .os-market .os-subline{grid-column:1/-1;font-size:11px;margin:0;line-height:1.2}
#op-one-stop .os-market .os-levels{grid-column:1/-1;margin:2px 0;gap:4px}
#op-one-stop .os-market .os-levels>span{font-size:10px;padding:3px 1px}
#op-one-stop .os-market .os-levels b{font-size:12px}
#op-one-stop .os-market .os-level-state{grid-column:1/-1;font-size:11px;min-height:0}
#op-one-stop .os-pcr-overview{padding:7px;margin:6px 0}
#op-one-stop .os-pcr-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
#op-one-stop .os-pcr{padding:6px 4px;min-width:0}
#op-one-stop .os-pcr>strong{font-size:11px}
#op-one-stop .os-pcr b{font-size:18px}
#op-one-stop .os-pcr small{font-size:10px;line-height:1.25;overflow-wrap:anywhere}
#op-one-stop .os-fast-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin:6px 0 9px}
#op-one-stop .os-fast-links a{min-width:0;min-height:40px;font-size:11px;padding:5px 3px;overflow-wrap:anywhere}
#op-one-stop .os-workspace-controls{gap:6px;margin:6px 0}
#op-one-stop .os-reading-status{font-size:11px;margin:5px 0;padding:6px}
#op-one-stop .os-controls{gap:4px}
#market-book #op-one-stop .os-controls button{min-height:40px;font-size:12px;padding:5px 7px}
#market-book #op-one-stop #op-one-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
#market-book #op-one-stop #op-one-actions button{font-size:11px;min-height:40px;white-space:normal;padding:6px 4px}
#op-one-stop .os-nav{padding:4px 0 8px}
#market-book #op-one-stop #os-open-dashboard[aria-pressed=true]{display:none}
}
/* Reference-inspired command centre: one shared verified evidence source. */
#market-book #op-one-stop.os-card{background:#080c17;border-color:#27547d;border-radius:10px;padding:9px;box-shadow:none}
#op-one-stop .os-hero{margin:0 0 6px;gap:8px}
#op-one-stop .os-hero>div:first-child{display:none}
#op-one-stop #op-one-status{max-width:100%;width:100%;border-color:#176972;background:#081d27;color:#a3fcf2;padding:6px 10px;border-radius:5px}
#op-one-stop .os-evidence-shortcuts{display:flex;align-items:center;flex-wrap:wrap;gap:5px;border:1px solid #1b586e;border-radius:7px;padding:6px;background:#0a1b2b;margin:6px 0}
#op-one-stop .os-evidence-shortcuts>span{color:#64e6d4;font-size:11px;font-weight:800;margin-right:8px}
#op-one-stop .os-evidence-shortcuts a{display:inline-flex;align-items:center;min-height:34px;text-decoration:none;background:#132c40;border:1px solid #336486;border-radius:5px;padding:4px 9px;color:#e2faff;font-size:11px;font-weight:650}
#op-one-stop .os-evidence-shortcuts a:focus-visible{outline:2px solid #76f9ee;outline-offset:2px}
#op-one-stop .os-terminal-head{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(230px,1fr);gap:8px;align-items:start}
#op-one-stop .os-terminal-evidence{min-width:0}
#op-one-stop .os-rag-context{min-width:0;border:1px solid #315374;border-radius:8px;background:#0a1727;padding:8px;font-size:11px}
#op-one-stop .os-rag-context>strong{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;color:#5cdbed;font-size:14px}
#op-one-stop .os-rag-context>strong small{font-size:10px;color:#a9bdda;font-weight:500}
#op-one-stop .os-rag-line{display:grid;grid-template-columns:100px minmax(0,1fr);border-top:1px solid #29435b;gap:5px;padding:7px 0;color:#b8d0e6}
#op-one-stop .os-rag-line b{font-size:11px;color:#e4f4fd;overflow-wrap:anywhere}
#op-one-stop .os-rag-context button,#op-one-stop .os-terminal-memory button{border:1px solid #3184d0;border-radius:6px;color:#ffffff;background:#0753b8;padding:7px 10px;min-height:38px;cursor:pointer}
#op-one-stop .os-rag-context>small{display:block;color:#9eb9d3;line-height:1.4;margin-top:7px}
#op-one-stop .os-markets{gap:5px;margin:5px 0}
#market-book #op-one-stop .os-market{padding:7px;border-radius:7px;box-shadow:none}
#op-one-stop .os-market-head{margin:2px 0 4px;font-size:12px}
#op-one-stop .os-price{font-size:clamp(18px,2vw,26px)}
#op-one-stop .os-levels{margin:5px 0;gap:3px}
#op-one-stop .os-pcr-overview{padding:7px;border-radius:7px;margin:7px 0}
#op-one-stop .os-pcr-strip{gap:5px;margin:4px 0 0}
#op-one-stop .os-pcr{padding:6px;border-radius:6px;background:#101c30}
#op-one-stop .os-pcr b{font-size:21px}
#op-one-stop .os-section-head{margin:5px 0}
#market-book #op-one-stop .os-section-head h3{color:#50daf0;font-size:15px}
#op-one-stop .os-main-grid{gap:7px;margin:6px 0}
#op-one-stop .os-rank-grid{grid-template-columns:minmax(0,1fr);gap:6px;margin:6px 0}
#op-one-stop .os-panel{margin:6px 0;border-radius:8px;box-shadow:none;background:#0c1625}
#op-one-stop .os-premium{padding:8px}
#op-one-stop .os-panel-body{padding:0 8px 8px}
#op-one-stop details.os-panel>summary{min-height:38px;padding:7px 8px;color:#51dbef;font-size:14px}
#market-book #op-one-stop .os-table :is(th,td){padding:5px 4px;font-size:11px}
#op-one-stop .os-rank-sides{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#op-one-stop .os-rank-item{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:2px 6px;padding:3px 0}
#op-one-stop .os-rank-item b{display:inline;font-size:13px}
#op-one-stop .os-rank-item small{display:inline;font-size:10px}
#op-one-stop .os-event{margin:3px 0;border-radius:5px;padding:5px 8px}
#op-one-stop .os-terminal-events,#op-one-stop .os-terminal-memory{margin:6px 0}
#op-one-stop .os-terminal-memory p{margin:3px 0 7px}
#op-one-stop .os-workspace-controls{gap:6px;margin:6px 0}
#op-one-stop .os-reading-status{margin:5px 0;padding:6px}
#op-one-stop .os-nav{padding:3px 0 7px;gap:4px}
#market-book #op-one-stop .os-nav button{min-height:36px;padding:5px 8px;font-size:11px}
@media(max-width:850px){#op-one-stop .os-terminal-head{grid-template-columns:minmax(0,1fr)}#op-one-stop .os-rag-context{margin-top:3px}}
@media(max-width:600px){#market-book #op-one-stop.os-card{padding:7px}#op-one-stop .os-evidence-shortcuts{flex-wrap:nowrap;overflow-x:auto}#op-one-stop .os-evidence-shortcuts>span{flex:0 0 auto}#op-one-stop .os-evidence-shortcuts a{flex:0 0 auto}#op-one-stop .os-rag-context>strong{font-size:12px}#op-one-stop .os-rag-line{grid-template-columns:85px minmax(0,1fr)}#op-one-stop .os-rank-sides{grid-template-columns:minmax(0,1fr)}#op-one-stop .os-market{min-height:0}#market-book #op-one-stop .os-table{min-width:480px}}
/* Six existing, functional destinations remain one horizontally scrolling bar on phones. */
@media(max-width:900px){
#market-book #op-workspace-nav{display:block;margin:0 0 5px}
#market-book .op-rail-inner{display:block;padding:0}
#market-book #op-chapter-links{display:flex;gap:4px;overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin}
#market-book #op-chapter-links button{flex:0 0 auto;width:auto;min-height:38px;padding:5px 10px;font-size:11px;white-space:nowrap}
}
/* On the Research command page, remove duplicate mobile chrome; functionality remains in six tabs and source panel. */
@media(max-width:600px){
#market-book[data-main-chapter='1'] #op-view-links{display:flex;gap:3px;padding:0 0 3px}#market-book[data-main-chapter='1'] #op-view-links button{min-height:32px;padding:3px 8px;font-size:11px}
#market-book #op-workspace-top{display:none}
#market-book #op-workspace-nav:before{content:'OPTIONPILOT PRO';display:block;color:#a8f8fe;font-size:13px;font-weight:850;letter-spacing:.4px;padding:2px 1px 5px}
#market-book #op-one-stop.os-card .os-hero{margin-bottom:3px}
#market-book #op-one-stop.os-card #op-one-status{padding:4px 7px}
#market-book #op-one-stop.os-card .os-evidence-shortcuts{margin:4px 0;padding:4px}
#market-book #op-one-stop.os-card .os-section-head{margin:3px 0}
#market-book #op-one-stop.os-card .os-markets{gap:3px}
#market-book #op-one-stop.os-card .os-market{padding:5px 7px}
#market-book #op-one-stop.os-card .os-market .os-levels{margin:0}
#market-book #op-one-stop.os-card .os-market .os-subline{line-height:1.1}
}
/* Four data-first view hubs retain the Kite and Recorder renderers below. */
#op-one-stop .os-command-deck{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:5px 0 9px}
#op-one-stop .os-command-deck a{min-width:0;display:flex;align-items:center;gap:9px;min-height:66px;padding:9px 11px;color:#e6f9ff;text-decoration:none;border:1px solid #31506e;border-top:3px solid #28d9eb;background:linear-gradient(145deg,#112d37,#111b2e);border-radius:9px;box-shadow:inset 0 1px #ffffff12}
#op-one-stop .os-command-deck a:nth-child(2){border-top-color:#35efa5;background:linear-gradient(145deg,#12362b,#13212a)}
#op-one-stop .os-command-deck a:nth-child(3){border-top-color:#eab45c;background:linear-gradient(145deg,#332717,#1c2130)}
#op-one-stop .os-command-deck a:nth-child(4){border-top-color:#bc98ff;background:linear-gradient(145deg,#292043,#191c31)}
#op-one-stop .os-command-deck a[aria-current=page]{outline:2px solid #77fcf2;outline-offset:-2px;box-shadow:0 0 15px #2ce1e83b,inset 0 1px #ffffff22}
#op-one-stop .os-command-deck a:focus-visible{outline:3px solid #fff;outline-offset:2px}
#op-one-stop .os-hub-num{flex:0 0 auto;font:800 22px/1 ui-monospace,monospace;color:#5deffd}
#op-one-stop .os-command-deck a:nth-child(2) .os-hub-num{color:#6df4ae}
#op-one-stop .os-command-deck a:nth-child(3) .os-hub-num{color:#f7be65}
#op-one-stop .os-command-deck a:nth-child(4) .os-hub-num{color:#d0a9ff}
#op-one-stop .os-command-deck strong{display:block;font-size:13px;letter-spacing:.5px}
#op-one-stop .os-command-deck small{display:block;font-size:11px;line-height:1.35;color:#b6cce2;margin-top:4px}
#op-one-stop .os-detailed-views{border:1px solid #27445a;background:#0c1a2a;border-radius:7px;margin:6px 0}
#op-one-stop .os-detailed-views>summary{cursor:pointer;color:#a9ddf0;font-size:12px;padding:8px 10px;min-height:35px}
#op-one-stop .os-detailed-views .os-nav{flex-wrap:wrap;overflow:visible;padding:4px 8px 9px}
#op-one-stop #os-radar,#op-one-stop #os-premium,#op-one-stop #os-pulse,#op-one-stop #os-memory{scroll-margin-top:58px}
@media(max-width:760px){
#op-one-stop .os-command-deck{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
#op-one-stop .os-command-deck a{min-height:51px;padding:6px 8px;gap:7px}
#op-one-stop .os-hub-num{font-size:19px}
#op-one-stop .os-command-deck strong{font-size:12px}
#op-one-stop .os-command-deck small{font-size:10px;margin-top:1px}
#op-one-stop .os-rag-context>small{display:none}
#op-one-stop .os-rag-context{padding:6px}
#op-one-stop .os-rag-line{padding:4px 0}
#op-one-stop .os-pcr b{font-size:22px}
#op-one-stop .os-market .os-price{font-size:23px}
}
/* Reference screenshot presentation: six top tabs and seven compact evidence tables. */
body[data-op-workspace]{background:#03080c!important}
body[data-op-workspace] #market-book{background:#03080c;border-color:#163a4e;border-radius:8px;padding:8px;min-height:0}
#market-book .op-logo{font-size:0}#market-book .op-logo>span{font-size:18px;text-transform:uppercase;white-space:nowrap}#market-book .op-logo b{color:#00d9f5}
#market-book #op-chapter-links button{border:1px solid #20465c;border-radius:5px;color:#def5ff;background:#050c12;min-height:38px;font-size:11px;text-transform:uppercase;white-space:nowrap}
#market-book #op-chapter-links button>span{color:#ffbf16;font-size:21px}
#market-book #op-chapter-links button[aria-current=page]{background:#005bff;color:white;border-color:#318dff;box-shadow:0 0 9px #006aff66}
#market-book #op-research-open-data{background:linear-gradient(#a600f7,#7400e9);color:white;border-color:#cb43ff;text-transform:uppercase;box-shadow:0 0 9px #a600f744}
#market-book #op-research-controls{background:#08080f;border-color:#624578;border-radius:6px;margin-bottom:6px}
#market-book #op-one-stop.os-card{background:#03080c;border:0;padding:0;border-radius:0;--os-cyan:#00daed;--os-green:#00ed76;--os-red:#ff3655}
#op-one-stop .os-reference-indices{display:flex;gap:5px;justify-content:flex-end;margin:5px 0}
#market-book #op-one-stop .os-reference-indices button{min-height:34px;padding:4px 18px;font-size:12px;border:1px solid #20546d;background:#050c12;border-radius:5px}
#market-book #op-one-stop .os-reference-indices button[aria-pressed=true]{background:#005bff;color:white;border-color:#318dff}
#op-one-stop .os-terminal-head{grid-template-columns:minmax(0,2.2fr) minmax(230px,1fr)}
#op-one-stop .os-markets{grid-template-columns:minmax(0,1fr)}
#market-book #op-one-stop .os-market[aria-pressed=false]{display:none}
#market-book #op-one-stop .os-market{background:#050c12;border:1px solid #26536d;padding:7px 10px;border-radius:5px}
#op-one-stop .os-market-head{font-size:21px;color:#b0e6ff}#op-one-stop .os-price{font-size:28px}
#op-one-stop .os-levels>span{border-radius:4px;border:1px solid #4d5d62;background:#061117;padding:4px;display:flex;justify-content:space-between;gap:4px}
#op-one-stop .os-levels>span:nth-child(1),#op-one-stop .os-levels>span:nth-child(1) b{border-color:#a92d42;color:#ff4059}
#op-one-stop .os-levels>span:nth-child(2),#op-one-stop .os-levels>span:nth-child(2) b{border-color:#a48815;color:#ffe633}
#op-one-stop .os-levels>span:nth-child(3),#op-one-stop .os-levels>span:nth-child(3) b{border-color:#008951;color:#00ed76}
#op-one-stop .os-rag-context{background:#061018;border-color:#30699b;border-radius:5px}
#op-one-stop .os-panel{background:#040d13;border-color:#20516b;border-radius:5px;margin:5px 0}
#op-one-stop details.os-panel>summary,#market-book #op-one-stop .os-section-head h3{color:#00d7ec;font-size:15px;font-weight:750}
#op-one-stop details.os-panel>summary:before{content:'▸';color:#0cf139;background:#064d14;border-radius:4px;padding:2px 5px}
#op-one-stop .os-panel-body{padding:0 3px 4px}#op-one-stop .os-premium{padding:5px 3px}
#market-book #op-one-stop .os-table{table-layout:auto;white-space:nowrap;min-width:620px;font-family:'Arial Narrow',system-ui,sans-serif}
#market-book #op-one-stop .os-table :is(th,td){white-space:nowrap;overflow-wrap:normal;padding:4px 6px;font-size:12px;border:1px solid #15303c;background:#030b10;line-height:1.35}
#market-book #op-one-stop .os-table th{background:#071823;color:#deeff4;font-weight:500}
#op-one-stop .os-up{color:#00ed76!important}#op-one-stop .os-down{color:#ff3655!important}
#op-one-stop .os-expiry-detail{margin:4px 0;font-size:11px;color:#a8c1d0}#op-one-stop .os-expiry-detail>summary{cursor:pointer;min-height:28px;padding:5px}
#op-one-stop .os-rank-grid{gap:0;margin:0}#op-one-stop .os-pcr-overview{background:#030b10;margin:4px 0;padding:4px;border-radius:4px}
#op-one-stop .os-pcr{background:#06111b;border-radius:4px;padding:5px}#op-one-stop .os-pcr small{font-size:10px}
#op-one-stop .os-workspace-controls{margin:4px 0}#op-one-stop .os-reading-status{padding:4px 6px;border-radius:4px;background:#06131a;border-color:#234957;font-size:11px}
#market-book #op-one-stop .os-controls button[aria-pressed=true]{background:#005bff;border-color:#318dff}
#op-one-stop .os-ladder-key{margin:3px 0;font-size:10px}#op-one-stop .os-expiry-clock{padding:4px 6px;margin:4px 0;background:#06131a;border-color:#234957;font-size:11px}
@media(max-width:850px){#op-one-stop .os-terminal-head{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){#market-book #op-one-stop.os-card{padding:0}#op-one-stop .os-market-head{font-size:17px}#op-one-stop .os-reference-indices{justify-content:stretch}#market-book #op-one-stop .os-reference-indices button{flex:1;min-width:0;padding:4px;min-height:40px}#market-book #op-one-stop .os-table :is(th,td){font-size:11px;padding:4px 5px}#op-one-stop .os-levels>span{display:block}#op-one-stop .os-rag-context{margin-bottom:4px}}
@media(prefers-reduced-motion:reduce){#op-one-stop *{animation:none!important;transition:none!important}}
`;

export function installOneShotLiveCard(api:any){
 const $=(id:string)=>document.getElementById(id) as any,root=$('op-one-stop');if(!root||!$('os-market-radar'))return null;
 const symbols=['NIFTY','SENSEX','BANKNIFTY'],accents=['#40e5ff','#ffba68','#b48aff'];
 const n=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const positive=(v:any)=>n(v)!==null&&v>0?v:null;
 const fmt=(v:any,d=2)=>n(v)!==null?v.toLocaleString('en-IN',{maximumFractionDigits:d}):'—';
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const time=(v:any)=>Number.isFinite(typeof v==='number'?v:Date.parse(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 const day=(t:number)=>Number.isFinite(t)?new Date(t+19800000).toISOString().slice(0,10):'';
 const cache=new WeakMap<object,string>(),write=(id:string,html:string)=>{const node=$(id);if(node&&cache.get(node)!==html){node.innerHTML=html;cache.set(node,html);}};
 const empty=(text:string)=>'<div class="os-empty">'+esc(text)+'</div>';
 const pct=(v:any)=>n(v)===null?'—':(v>0?'+':'')+fmt(v)+'%';
 const tone=(v:any)=>n(v)===null?'':v>0?'os-up':v<0?'os-down':'';
 const badge=(text:string,cls='')=>'<span class="os-badge '+cls+'">'+esc(text)+'</span>';
 const table=(heads:string[],rows:string[][])=>'<div class="os-table-wrap"><table class="os-table"><thead><tr>'+heads.map(s=>'<th>'+esc(s)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?'':'<tr><td colspan="'+heads.length+'">Unavailable · verified source rows required</td></tr>')+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 let premiumExpiry='';
 let selected='NIFTY',dteMetric='day',minutes=3,sourceMode='AUTO',sideMode='BOTH',chartSeries='BOTH',chartCadence=180000,chartManual=false,chartAt=0,chartKey='',loadBusy=false,last:any=null,pcr:any=null,session='',lastPaint=0,paintedLive=false;
 const series=new Map<string,Array<{at:number;value:number}>>(),conflicts=new Map<string,number>(),pcrIds=new Map<string,string>(),previous=new Map<string,any>(),breaks=new Map<string,any>();
 const events:any[]=[];
 const valid=(d:any,q:any,role:string,symbol?:string)=>api.validQuote(d,q,role,symbol)&&Number.isInteger(q.identity?.token)&&q.identity.token>0&&
  (role!=='FUTURE'||/^\d{4}-\d{2}-\d{2}$/.test(q.identity?.expiry||'')&&Number.isFinite(Date.parse(q.identity.expiry+'T00:00:00Z'))&&new Date(q.identity.expiry+'T00:00:00Z').toISOString().slice(0,10)===q.identity.expiry&&q.identity.expiry>=d.snapshot.tradeDate);
 const change=(d:any,q:any,role:string,symbol?:string)=>valid(d,q,role,symbol)&&positive(q.pdc)!==null?(q.price/q.pdc-1)*100:null;
 const indexRow=(d:any,symbol:string)=>{const rows=(d?.snapshot?.indices||[]).filter((a:any)=>a.symbol===symbol);return rows.length===1?rows[0]:null;};
 const sample=(key:string,at:number,value:any)=>{
  if(n(value)===null||!Number.isFinite(at))return;
  const rejected=conflicts.get(key);if(rejected!==undefined){if(at<=rejected)return;conflicts.delete(key);}
  let rows=series.get(key)||[],prior=rows.at(-1);
  if(prior&&at===prior.at){if(value!==prior.value){series.delete(key);conflicts.set(key,at);if(conflicts.size>48)conflicts.delete(conflicts.keys().next().value!);}return;}
  if(prior&&at<prior.at)return;
  if(prior&&at-prior.at>(key.endsWith('|PCR')?210000:35000))rows=[];
  if(rows.length&&at-rows.at(-1)!.at<10000)return;
  rows.push({at,value});if(rows.length>600)rows.splice(0,rows.length-600);series.set(key,rows);
  if(series.size>48)series.delete(series.keys().next().value!);
 };
 const refs=(d:any,symbol:string,q:any)=>{
  const m=api.getModels?.()?.[symbol],at=Date.parse(m?.spot?.at||'');
  const ready=api.getState?.()?.date===d?.snapshot?.tradeDate&&m?.tradeDate===d?.snapshot?.tradeDate&&day(at)===d?.snapshot?.tradeDate&&at<=Date.parse(q?.observedAt||'');
  const pdh=ready?positive(m.spot.pdh):null,pdl=ready?positive(m.spot.pdl):null;
  const opening=ready?m.spotPcr?.opening?.spot:null;
  const opened=opening?.complete===true&&positive(opening.high)!==null&&positive(opening.low)!==null&&opening.high>=opening.low&&
   opening.at===new Date(d.snapshot.tradeDate+'T09:30:00+05:30').toISOString()&&opening.fromAt===new Date(d.snapshot.tradeDate+'T09:15:00+05:30').toISOString()&&Date.parse(opening.at)<=Date.parse(q.observedAt);
  return {pdh:pdh!==null&&pdl!==null&&pdh<=pdl?null:pdh,pdl:pdh!==null&&pdl!==null&&pdh<=pdl?null:pdl,pdc:positive(q?.pdc),h15:opened?opening.high:null,l15:opened?opening.low:null};
 };
 const futureRefs=(d:any,a:any)=>{
  const f=a?.future,ok=!!a&&valid(d,f,'FUTURE',a.symbol);
  // Kite FULL provides contract-specific previous close, not previous-session high/low.
  // Never copy spot levels to the futures contract.
  return {pdh:null,pdc:ok?positive(f.pdc):null,pdl:null,ready:ok,expiry:ok?f.identity.expiry:null};
 };
 const allFutureLevels=(d:any)=>table(['Instrument','LTP','Day %','PDH','PDC','PDL','15m H','15m L','OI','Basis','Source time · IST'],symbols.filter(symbol=>symbol===selected).flatMap(symbol=>{
  const a=d?indexRow(d,symbol):null,q=a?.spot,f=a?.future,ok=!!a&&valid(d,q,'SPOT',symbol),fo=!!a&&valid(d,f,'FUTURE',symbol),r=ok?refs(d,symbol,q):{},fr=futureRefs(d,a);
  const basis=ok&&fo&&Math.abs(Date.parse(q.observedAt)-Date.parse(f.observedAt))<=5000?f.price-q.price:null;
  return [[esc(symbol)+' Spot',fmt(ok?q.price:null),pct(ok?change(d,q,'SPOT',symbol):null),fmt(r.pdh),fmt(r.pdc),fmt(r.pdl),fmt(r.h15),fmt(r.l15),'—','—',ok?time(q.observedAt):'Unavailable'],
   [esc(symbol)+' Fut<small>'+esc(fr.expiry||'—')+'</small>',fmt(fo?f.price:null),pct(fo?change(d,f,'FUTURE',symbol):null),fmt(fr.pdh),fmt(fr.pdc),fmt(fr.pdl),'—','—',fmt(fo&&n(f.oi)!==null&&f.oi>=0?f.oi:null,0),fmt(basis),fo?time(f.observedAt):'Unavailable']];
 }))+'<small class="os-subline">Kite FULL · previous close. Futures PDH/PDL: same-contract previous-session high/low source unavailable. Spot levels are never substituted. Basis requires source times within 5s.</small>';
 const observe=(d:any,a:any)=>{
  const q=a.spot,symbol=a.symbol;if(!valid(d,q,'SPOT',symbol)){previous.delete(symbol);breaks.delete(symbol);return;}
  const r=refs(d,symbol,q),old=previous.get(symbol),at=Date.parse(q.observedAt),identity=q.identity?.token??symbol;
  if(old&&old.identity===identity&&at>old.at&&at-old.at<=30000){
   for(const [level,kind] of [['pdh','PDH BREAK'],['pdl','PDL BREAK']] as const){const value=r[level];
    const crossed=value!==null&&old[level]===value&&(level==='pdh'?old.price<=value&&q.price>value:old.price>=value&&q.price<value);
    if(crossed){const event={symbol,label:kind,at:q.observedAt,detail:'Spot '+fmt(q.price)+' · '+level.toUpperCase()+' '+fmt(value),level,value};breaks.set(symbol,event);events.unshift(event);}
   }
  }
  const e=breaks.get(symbol);if(e&&(r[e.level]!==e.value||(e.level==='pdh'?q.price<=e.value:q.price>=e.value)))breaks.delete(symbol);
  if(!old||at>old.at)previous.set(symbol,{identity,at,price:q.price,...r});
  if(events.length>24)events.length=24;
 };
 const graph=(d:any)=>{
  const now=Date.parse(d?.serverTime||''),a=series.get(selected+'|SPOT')||[],b=series.get(selected+'|PCR')||[],cut=now-minutes*60000;
  const xs=a.filter(p=>p.at>=cut&&p.at<=now),ys=b.filter(p=>p.at>=cut&&p.at<=now);
  const aq=indexRow(d,selected)?.spot,opening=aq&&valid(d,aq,'SPOT',selected)?refs(d,selected,aq):null;
  const paths=(rows:typeof a,color:string,top:number,height:number)=>{
   if(rows.length<2)return '';
   const levels=color==='#3be6ff'?[['15m sampled H',opening?.h15],['15m sampled L',opening?.l15]].filter((r:any)=>positive(r[1])!==null):[];
   const numbers=[...rows.map(p=>p.value),...levels.map((r:any)=>r[1] as number)];
   const low=Math.min(...numbers),high=Math.max(...numbers),span=high-low||Math.max(Math.abs(high)*.001,.0001);
   let result='',lastAt=0;
   for(const p of rows){const x=50+(p.at-cut)/(minutes*60000)*500,y=top+height-(p.value-low)/span*height;const gap=color==='#ff8ed9'?(pcr?.rows?.find((r:any)=>r.symbol===selected)?.current?.period||60000)+30000:35000;result+=(lastAt&&p.at-lastAt<=gap?' L':' M')+x.toFixed(1)+' '+y.toFixed(1);lastAt=p.at;}
   return levels.map((r:any)=>{const y=top+height-(r[1]-low)/span*height;return '<path d="M50 '+y.toFixed(1)+'H555" stroke="#a4ffde" stroke-dasharray="4 6"/><text x="330" y="'+Math.max(10,y-3).toFixed(1)+'">'+esc(r[0])+' '+fmt(r[1],0)+'</text>';}).join('')+'<path d="'+result+'" fill="none" stroke="'+color+'" stroke-width="2.5"/><text x="4" y="'+(top+10)+'">'+fmt(high,color==='#ff8ed9'?4:0)+'</text><text x="4" y="'+(top+height)+'">'+fmt(low,color==='#ff8ed9'?4:0)+'</text>';
  };
  if(xs.length<2&&ys.length<2)return empty(selected+' · collecting '+minutes+'m source history · Spot / PCR paths need two actual observations each.');
  return '<svg class="os-chart" viewBox="0 0 570 160" role="img" aria-label="'+esc(selected+' actual spot and full PCR samples')+'"><path d="M50 73H555 M50 145H555" stroke="#3a506d" stroke-dasharray="3 5"/>'+(chartSeries!=='PCR'?paths(xs,'#3be6ff',12,52):'')+(chartSeries!=='SPOT'?paths(ys,'#ff8ed9',90,52):'')+'<text x="65" y="11">Spot · '+esc(selected)+'</text><text x="65" y="87">Full PCR · '+esc(pcr?.rows?.find((r:any)=>r.symbol===selected)?.expiry||'—')+'</text><text x="50" y="157">'+time(cut)+'</text><text x="480" y="157">'+time(now)+'</text></svg>'+(xs.length<2||ys.length<2?'<small class="os-subline">'+(xs.length<2?'Spot':'PCR')+' history building · no substituted curve</small>':'');
 };
 const rank=(d:any,role:string)=>{
  const rows=(d?.snapshot?.participation||[]).filter((q:any)=>q?.identity?.role===role);
  const usable=rows.filter((q:any)=>valid(d,q,role)&&n(change(d,q,role))!==null&&q.identity?.token&&rows.filter((x:any)=>x.identity?.token===q.identity.token).length===1);
  const sorted=[...usable].sort((a:any,b:any)=>Math.abs(change(d,b,role))-Math.abs(change(d,a,role))).slice(0,10);
  return (!usable.length?empty(role==='STOCK'?'Fresh heavyweight quotes unavailable.':'Fresh sector quotes unavailable.'):'')+table(['#',role==='STOCK'?'Stock':'Sector / proxy','Weight %','Price','Day %','Contribution','Trend','Quote time · IST','RAG / similar event'],sorted.map((q:any,i:number)=>[
   String(i+1),esc(q.identity.label),'—',(role==='STOCK'?'₹ ':'Index points ')+fmt(q.price),'<span class="'+tone(change(d,q,role))+'">'+pct(change(d,q,role))+'</span>','—','<span class="'+tone(change(d,q,role))+'">'+(change(d,q,role)>0?'▲':change(d,q,role)<0?'▼':'→')+'</span>',time(q.observedAt),'Unmatched'
  ]))+'<small class="os-subline">'+usable.length+'/'+rows.length+' fresh tracked quotes · ordered by absolute day change · official weight, contribution and historical matches unavailable.</small>';

 };
 const endpoint=(key:string,target:number)=>{const rows=series.get(key)||[];return rows.filter(p=>p.at<=target&&target-p.at<=15000).at(-1);};
 const expiryTabs=(rows:any[])=>{
  const dates=[...new Set<string>(rows.map(r=>r.expiry))];
  return [''].concat(dates).map(date=>'<button type="button" data-os-expiry="'+esc(date)+'" aria-pressed="'+(premiumExpiry===date)+'">'+esc(date||'All expiries')+'</button>').join('');
 };
 const premiumTable=(d:any,rows:any[])=>table(['Type','Strike','Expiry','LTP ₹','Day %','OI','PDH','PDC','PDL','Source time · IST'],rows.filter(r=>!premiumExpiry||r.expiry===premiumExpiry).flatMap(r=>['CE','PE'].filter(side=>sideMode==='BOTH'||sideMode===side).map(side=>{
  const q=r[side.toLowerCase()],ok=!!d&&valid(d,q,'OPTION',selected)&&q.identity.expiry===r.expiry&&q.identity.strike===r.strike&&q.identity.side===side;
  return [side,fmt(r.strike,0),esc(r.expiry),fmt(ok?q.price:null),'<span class="'+tone(ok?change(d,q,'OPTION',selected):null)+'">'+pct(ok?change(d,q,'OPTION',selected):null)+'</span>',fmt(ok&&n(q.oi)!==null&&q.oi>=0?q.oi:null,0),'—',fmt(ok?positive(q.pdc):null),'—',ok?time(q.observedAt):'Unavailable'];
 })))+(rows.length?'':empty('No verified exact-contract premiums. Open Data to choose a saved session.'));
 const renderDte=(d:any,rows:any[])=>{
  write('os-premium-expiries',expiryTabs(rows));
  write('os-premium-table',premiumTable(d,rows));
  write('os-dte-context',esc(selected+' · '+(dteMetric==='day'?'vs contract PDC':minutes+'m matched contracts')+(selected==='BANKNIFTY'?' · monthly observation':'')));
  if(!d||!rows.length){write('os-dte-radar',Array.from({length:4},(_,i)=>'<article class="os-dte-tile os-missing"><small>EXPIRY '+(i+1)+'</small><h4>Inventory unavailable</h4><small>No verified contract date · no price substituted</small></article>').join('')+empty('No fresh verified expiry inventory · choose Recorded or load a saved full session.'));write('os-expiry-clock','Expiry end · verified contract timestamp unavailable');return;}
  write('os-expiry-clock','Next listed expiry · '+esc(rows[0].expiry)+' · '+Math.round((Date.parse(rows[0].expiry+'T00:00:00Z')-Date.parse(d.snapshot.tradeDate+'T00:00:00Z'))/86400000)+' calendar days as of '+esc(d.snapshot.tradeDate)+'<small>Exact expiry-end time not supplied by this feed.</small>');
  const tiles=rows.map(r=>{
   const dte=Math.round((Date.parse(r.expiry+'T00:00:00Z')-Date.parse(d.snapshot.tradeDate+'T00:00:00Z'))/86400000);
   const legs=['CE','PE'].map(side=>{
    const q=r[side.toLowerCase()],ok=valid(d,q,'OPTION',selected)&&q.identity.expiry===r.expiry&&q.identity.strike===r.strike&&q.identity.side===side;
    const key=ok?selected+'|OPTION|'+q.identity.token+'|'+r.expiry+'|'+r.strike+'|'+side:'';
    const base=ok?endpoint(key,Date.parse(q.observedAt)-minutes*60000):null;
    const delta=ok?(dteMetric==='day'?change(d,q,'OPTION',selected):base?(q.price/base.value-1)*100:null):null;
    return {side,q,ok,base,delta};
   });
   // Pair window changes require matching baseline AND current source times.
   const synced=legs.every(l=>l.ok)&&Math.abs(Date.parse(legs[0].q.observedAt)-Date.parse(legs[1].q.observedAt))<=5000;
   const matched=synced&&legs.every(l=>l.base)&&Math.abs(legs[0].base!.at-legs[1].base!.at)<=5000;
   const status=!synced?'PAIR INCOMPLETE / UNSYNCED':dteMetric==='window'&&!matched?'BUILDING MATCHED HISTORY':'SOURCE MATCHED';
   return '<article class="os-dte-tile" data-expiry="'+esc(r.expiry)+'"><h4>'+esc(r.expiry)+'</h4><small>'+dte+' calendar days · ATM '+fmt(r.strike,0)+'</small><div class="os-dte-legs">'+legs.filter(l=>sideMode==='BOTH'||l.side===sideMode).map(l=>{
    const value=dteMetric==='window'&&!matched?null:l.delta;
    const stamp=!l.ok?'Not verified':dteMetric==='window'&&matched?time(l.base!.at)+' → '+time(l.q.observedAt)+' IST':time(l.q.observedAt)+' IST';
    return '<div class="os-dte-leg" data-side="'+l.side+'">'+l.side+' · LTP ₹<b>'+fmt(l.ok?l.q.price:null)+'</b><em class="'+tone(value)+'">'+pct(value)+'</em><small>'+(dteMetric==='day'?'vs own PDC':minutes+'m window')+'</small><small>'+esc(stamp)+'</small></div>';
   }).join('')+'</div><small>'+status+'</small></article>';
  });
  const omitted=(d.snapshot.omittedExpiries||[]).filter((x:any)=>typeof x==='string'&&x.startsWith(selected+'|')).length;
  write('os-dte-radar',tiles.join('')+Array.from({length:Math.max(0,4-rows.length)},(_,i)=>'<article class="os-dte-tile os-missing"><small>EXPIRY '+(rows.length+i+1)+'</small><h4>Not in subscribed inventory</h4><small>No invented date or premium</small></article>').join('')+'<small class="os-subline">'+rows.length+' subscribed expiry date(s)'+(omitted?' · '+omitted+' omitted inventories':'')+' · '+(dteMetric==='day'?'Each leg % vs its own previous close; LTP times shown separately.':'Window % requires the same token / expiry / strike / side at both endpoints; up to 15s baseline tolerance, CE/PE source times within 5s. ATM rolls build new history.')+'</small>');
 };
 const response=(d:any,a:any,optionRows:any[])=>{
  if(!a||!valid(d,a.future,'FUTURE',selected))return empty('Fresh exact '+selected+' futures contract unavailable.');
  const f=a.future,fat=Date.parse(f.observedAt),fk=selected+'|FUTURE|'+f.identity.token+'|'+f.identity.expiry,fb=endpoint(fk,fat-minutes*60000);
  const rows=optionRows.flatMap(r=>['CE','PE'].map(side=>({expiry:r.expiry,strike:r.strike,side,q:r[side.toLowerCase()]}))).filter(r=>valid(d,r.q,'OPTION',selected)&&r.q.identity.expiry===r.expiry&&r.q.identity.strike===r.strike&&r.q.identity.side===r.side).map(r=>{
   const key=selected+'|OPTION|'+r.q.identity.token+'|'+r.expiry+'|'+r.strike+'|'+r.side,base=fb?endpoint(key,fb.at+5000):null;
   const aligned=fb&&base&&Math.abs(base.at-fb.at)<=5000&&Math.abs(Date.parse(r.q.observedAt)-fat)<=5000;
   const fc=aligned?(f.price/fb!.value-1)*100:null,oc=aligned?(r.q.price/base!.value-1)*100:null;
   const status=fc===null||oc===null?'Building matched '+minutes+'m history':fc===0||oc===0?'Flat endpoint':Math.sign(fc)===Math.sign(oc)?'Same direction':'Opposite direction';
   return [esc(r.expiry+' · '+r.strike+' '+r.side),fmt(r.q.price),pct(oc),pct(fc),esc(status)+'<small>'+esc(aligned?time(base!.at)+' → '+time(r.q.observedAt)+' IST':'Freshness and matched baseline required')+'</small>'];
  });
  const spotOk=valid(d,a.spot,'SPOT',selected)&&Math.abs(Date.parse(a.spot.observedAt)-fat)<=5000;
  return '<span class="os-badge">'+esc(selected+' future '+f.identity.expiry)+' · '+fmt(f.price)+' · '+time(f.observedAt)+' IST</span><small class="os-subline">PDC '+fmt(positive(f.pdc))+' · OI '+fmt(f.oi,0)+' · Basis '+fmt(spotOk?f.price-a.spot.price:null)+' · contract PDH / PDL: source unavailable</small>'+table(['Premium / expiry','LTP ₹',minutes+'m Δ %','Future Δ %','Matched response'],rows.length?rows:[['—','—','—','—','No fresh matched ATM option contracts']]);
 };
 // Recorded panels use only the already-loaded archive and never enter the live series/maps.
 let recordedCache:any=null,recordedView:any=null;
 const recordedData=()=>{
  const s=api.getState?.()||{},input=s.current?.[selected],prior=s.baseline?.[selected];
  const key=[s.date,input,prior,selected,dteMetric,minutes,s.scope];
  if(recordedCache&&key.every((v,i)=>v===recordedCache[i]))return recordedView;
  recordedCache=key;
  const date=s.date,goodDate=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  if(!goodDate(date)||typeof api.derivePremium!=='function')return recordedView={date:null,rows:[],market:[],chain:[]};
  const rawOptions=(input?.options||[]).filter((r:any)=>r.symbol===selected&&day(Date.parse(r.minute_bucket))===date&&Date.parse(r.minute_bucket)<=Date.now()&&goodDate(String(r.expiry||'').slice(0,10))&&String(r.expiry).slice(0,10)>=date);
  const options=rawOptions.map((r:any)=>{
   const bucket=Date.parse(r.minute_bucket),quote=Date.parse(r.quote_timestamp||'');
   const stale=n(r.quote_age_seconds)!==null&&r.quote_age_seconds>60||r.quote_timestamp&&(!Number.isFinite(quote)||day(quote)!==date||bucket-quote>60000||quote-bucket>60000);
   return stale?{...r,truth_verdict:'STALE_QUOTE'}:r;
  });
  const market=(input?.market||[]).filter((r:any)=>r.symbol===selected&&day(Date.parse(r.minute_bucket))===date&&Date.parse(r.minute_bucket)<=Date.now());
  const chain=(input?.chain||[]).filter((r:any)=>r.symbol===selected&&day(Date.parse(r.minute_bucket))===date&&Date.parse(r.minute_bucket)<=Date.now());
  const model=api.derivePremium({date,rows:options,prior:prior?.options||[],minutes:dteMetric==='day'?'DAY':String(minutes)});
  const expiries=[...new Set<string>(model.rows.map((r:any)=>r.expiry))].sort().slice(0,4);
  const rows=expiries.map(expiry=>{
   const contracts=model.rows.filter((r:any)=>r.expiry===expiry),at=Math.max(...contracts.map((r:any)=>Date.parse(r.at)));
   const spots=market.filter((r:any)=>Date.parse(r.minute_bucket)<=at&&at-Date.parse(r.minute_bucket)<=60000),spotAt=Math.max(...spots.map((r:any)=>Date.parse(r.minute_bucket))),spotRows=spots.filter((r:any)=>Date.parse(r.minute_bucket)===spotAt);
   const spot=spotRows.length===1&&spotRows[0].truth_verdict==='TRUE'&&positive(spotRows[0].spot_ltp)!==null?spotRows[0].spot_ltp:null;
   const strikes=[...new Set<number>(contracts.map((r:any)=>r.strike))].sort((a,b)=>a-b),strike=spot===null?null:strikes.reduce((a,b)=>Math.abs(b-spot)<Math.abs(a-spot)?b:a);
   const leg=(side:string)=>{const rs=contracts.filter((r:any)=>r.strike===strike&&r.type===side&&Date.parse(r.at)===at);if(rs.length!==1)return null;const raw=options.filter((r:any)=>String(r.expiry).slice(0,10)===expiry&&r.strike===strike&&r.option_type===side&&Date.parse(r.minute_bucket)===at);return {...rs[0],quoteAt:raw.length===1?raw[0].quote_timestamp:null};};
   return {expiry,strike,at,ce:leg('CE'),pe:leg('PE')};
  });
  return recordedView={date,rows,market,chain,scope:s.scope};
 };
 let renderedRecordedKey:any[]=[],recordedHtml=new Map<string,string>();
 const renderRecorded=()=>{
  const state=api.getState?.(),paintKey=[state?.date,state?.current?.[selected],state?.baseline?.[selected],...symbols.map(k=>state?.current?.[k]),selected,sideMode,dteMetric,minutes,chartSeries,state?.scope,premiumExpiry];
  if(renderedRecordedKey.length&&paintKey.every((v,i)=>v===renderedRecordedKey[i])){recordedHtml.forEach((html,id)=>write(id,html));return;}
  renderedRecordedKey=paintKey;recordedHtml.clear();const put=(id:string,html:string)=>{recordedHtml.set(id,html);write(id,html);};
  const view=recordedData(),rows=view.rows,date=view.date;
  put('os-premium-expiries',expiryTabs(rows));
  put('os-premium-table',table(['Type','Strike','Expiry','LTP ₹',dteMetric==='day'?'Day %':'Window %','PDH','PDC','PDL','Saved time · IST','Quote time · IST'],rows.filter(r=>!premiumExpiry||r.expiry===premiumExpiry).flatMap(r=>['CE','PE'].filter(side=>sideMode==='BOTH'||sideMode===side).map(side=>{
   const q=r[side.toLowerCase()],ok=q?.state==='RECORDED';
   const matched=r.ce?.state==='RECORDED'&&r.pe?.state==='RECORDED'&&r.ce.at===r.pe.at&&r.ce.fromAt&&r.ce.fromAt===r.pe.fromAt;
   const value=ok&&(dteMetric==='day'||matched)?q.change:null;
   return [side,fmt(r.strike,0),esc(r.expiry),fmt(ok?q.price:null),'<span class="'+tone(value)+'">'+pct(value)+'</span>',fmt(ok?q.pdh:null),fmt(ok?q.pdc:null),fmt(ok?q.pdl:null),time(r.at),ok&&q.quoteAt?time(q.quoteAt):'Unavailable'];
  })))+(rows.length?'':empty('No loaded recorded premiums · Open Data to choose a saved session.')));
  put('os-dte-context',esc(selected+' · RECORDED · '+(date||'no session loaded')+(selected==='BANKNIFTY'?' · monthly observation':'')));
  put('os-expiry-clock',rows.length?'Recorded expiry · '+esc(rows[0].expiry)+' · '+Math.round((Date.parse(rows[0].expiry+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000)+' calendar days as of '+esc(date)+'<small>Historical session clock · exact expiry-end timestamp unavailable.</small>':'Expiry clock · load a recorded session with verified contract inventory');
  const sides=sideMode==='BOTH'?['CE','PE']:[sideMode];
  put('os-dte-radar',Array.from({length:4},(_,i)=>{
   const r=rows[i];if(!r)return '<article class="os-dte-tile os-missing"><small>EXPIRY '+(i+1)+'</small><h4>No recorded inventory</h4><small>Load full session · no invented expiry</small></article>';
   const matched=r.ce?.state==='RECORDED'&&r.pe?.state==='RECORDED'&&r.ce.at===r.pe.at&&(dteMetric==='day'||r.ce.fromAt&&r.ce.fromAt===r.pe.fromAt);
   const legs=sides.map(side=>{const q=r[side.toLowerCase()],ok=q?.state==='RECORDED',value=ok&&(dteMetric==='day'||matched)?q.change:null;
    return '<div class="os-dte-leg" data-side="'+side+'">'+side+' · RECORDED ₹<b>'+fmt(ok?q.price:null)+'</b><em class="'+tone(value)+'">'+pct(value)+'</em><small>'+(dteMetric==='day'?'vs own PDC':minutes+'m same contract')+'</small><strong>PDH '+fmt(ok?q.pdh:null)+' · PDC '+fmt(ok?q.pdc:null)+' · PDL '+fmt(ok?q.pdl:null)+'</strong><small>'+esc(ok?q.reaction:'Not verified at this saved minute')+'</small>'+(ok&&q.eventAt?'<small>Observed '+time(q.eventAt)+' IST</small>':'')+'<small>Saved '+time(r.at)+' IST</small><small>Quote '+(ok&&q.quoteAt?time(q.quoteAt)+' IST':'time unavailable')+'</small></div>';
   }).join('');
   return '<article class="os-dte-tile" data-recorded-expiry="'+esc(r.expiry)+'"><h4>'+esc(r.expiry)+'</h4><small>'+Math.round((Date.parse(r.expiry+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000)+' calendar days · ATM '+fmt(r.strike,0)+'</small><div class="os-dte-legs">'+legs+'</div><small>'+(!r.strike?'Verified Spot anchor unavailable':matched?'Same saved minute · quote freshness not asserted':'Incomplete pair / matched history unavailable')+'</small></article>';
  }).join(''));
  put('os-dte-alignment',badge('RECORDED · '+(date||'no date'))+'<small class="os-subline">Saved minute timestamps · '+esc(view.scope==='FULL'?'full session loaded':'loaded selection only · Load full session for broader inventory')+' · not live alignment</small>');
  const all=api.getState?.(),saved=typeof api.deriveRecordedPcr==='function'&&date?api.deriveRecordedPcr(all,new Date(Date.now()).toISOString(),null,Date.now()):null;
  put('os-pcr-strip',symbols.map(symbol=>{const r=saved?.rows?.find((x:any)=>x.symbol===symbol),v=n(r?.value),arrow=r?.direction==='UP'?'↑':r?.direction==='DOWN'?'↓':r?.direction==='FLAT'?'→':'—';return '<div class="os-pcr" data-pcr-index="'+symbol+'"><strong>'+symbol+(symbol==='BANKNIFTY'?' · M':'')+'</strong><small>RECORDED · Full OI PCR</small><b>'+(v===null?'—':v.toFixed(4))+' '+arrow+'</b><small>'+esc(date||'No session')+' · '+time(r?.current?.checked)+' IST</small><small>Expiry '+esc(r?.expiry||'unavailable')+'</small><small>Spot '+fmt(r?.spotValue)+' · '+time(r?.spotAt)+' IST</small></div>';}).join(''));
  // The market radar follows the explicit Recorded source; live-only evidence below stays gated.
  put('os-market-radar',symbols.map((symbol,i)=>{
   const source=(all?.current?.[symbol]?.market||[]).filter((r:any)=>r.symbol===symbol&&day(Date.parse(r.minute_bucket))===date&&Date.parse(r.minute_bucket)<=Date.now()),at=Math.max(...source.map((r:any)=>Date.parse(r.minute_bucket))),rs=source.filter((r:any)=>Date.parse(r.minute_bucket)===at),q=rs.length===1&&rs[0].truth_verdict==='TRUE'?rs[0]:null;
   const spot=positive(q?.spot_ltp),pdc=positive(q?.spot_prev_close),pctValue=spot!==null&&pdc!==null?(spot/pdc-1)*100:null;
   return '<button type="button" class="os-market" style="--os-accent:'+accents[i]+'" data-os-index="'+symbol+'" aria-pressed="'+(symbol===selected)+'"><span class="os-market-head">'+symbol+'<small>RECORDED · '+esc(date||'—')+'</small></span><strong class="os-price">'+fmt(spot)+'</strong><small class="os-subline '+tone(pctValue)+'">'+pct(pctValue)+' vs PDC</small><span class="os-levels">'+['pdh','pdc','pdl'].map(k=>'<span>'+k.toUpperCase()+'<b>'+fmt(positive(q?.[k==='pdc'?'spot_prev_close':k]))+'</b></span>').join('')+'</span><small class="os-subline">Saved '+time(at)+' IST · Futures '+fmt(positive(q?.future_ltp))+'</small><small class="os-subline">Futures expiry not in saved market row</small></button>';
  }).join(''));
  const latestAt=Math.max(...view.market.map((r:any)=>Date.parse(r.minute_bucket))),lastRows=view.market.filter((r:any)=>Date.parse(r.minute_bucket)===latestAt),q=lastRows.length===1&&lastRows[0].truth_verdict==='TRUE'?lastRows[0]:null;
  const open=positive(q?.spot_open),pdc=positive(q?.spot_prev_close),gap=open!==null&&pdc!==null?open-pdc:null;
  put('os-spot-context',esc(selected)+' · '+fmt(positive(q?.spot_ltp))+'<small>RECORDED · '+esc(date||'no session')+' · '+time(latestAt)+' IST · '+(gap===null?'Gap unknown: verified session Open / PDC not loaded':(gap>0?'Gap up':gap<0?'Gap down':'Flat open')+' '+fmt(gap)+' points ('+pct(gap/pdc!*100)+')')+'</small>');
  const expiry=saved?.rows?.find((r:any)=>r.symbol===selected)?.expiry;
  const points=(items:any[],field:string,verify:(r:any)=>boolean)=>{
   const at=[...new Set<number>(items.map(r=>Date.parse(r.minute_bucket)))].sort((a,b)=>a-b);
   return at.map(t=>{const rs=items.filter(r=>Date.parse(r.minute_bucket)===t),q=rs.length===1?rs[0]:null;return {at:t,value:q&&verify(q)?n(q[field]):null};});
  };
  const spot=points(view.market,'spot_ltp',r=>r.truth_verdict==='TRUE'&&positive(r.spot_ltp)!==null);
  const ratio=points(view.chain.filter((r:any)=>String(r.expiry).slice(0,10)===expiry),'full_chain_oi_pcr',r=>r.truth_verdict==='TRUE'&&/^(Exact archived full-chain source|Normalized full-chain source)$/.test(r.full_pcr_source||'')&&n(r.full_chain_oi_pcr)!==null&&r.full_chain_oi_pcr>=0);
  const end=Math.max(...spot.map(p=>p.at),...ratio.map(p=>p.at)),cut=end-minutes*60000;
  const path=(data:any[],color:string,top:number)=>{const rows=data.filter(p=>p.at>=cut&&p.at<=end),values=rows.filter(p=>p.value!==null);if(values.length<2)return '';const low=Math.min(...values.map(p=>p.value)),high=Math.max(...values.map(p=>p.value)),span=high-low||1;let d='',prev=0;for(const p of rows){if(p.value===null){prev=0;continue;}d+=(prev&&p.at-prev<=(date>='2026-10-19'?90000:210000)?' L':' M')+(50+(p.at-cut)/(minutes*60000)*500).toFixed(1)+' '+(top+50-(p.value-low)/span*50).toFixed(1);prev=p.at;}return '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2.5"/><text x="4" y="'+(top+10)+'">'+fmt(high,color==='#ff8ed9'?4:0)+'</text><text x="4" y="'+(top+50)+'">'+fmt(low,color==='#ff8ed9'?4:0)+'</text>';};
  const paths=(chartSeries!=='PCR'?path(spot,'#3be6ff',12):'')+(chartSeries!=='SPOT'?path(ratio,'#ff8ed9',90):'');
  put('os-pulse-chart',paths?'<svg class="os-chart" viewBox="0 0 570 165" role="img" aria-label="Recorded Spot and Full PCR"><text x="65" y="11">Recorded Spot · '+esc(selected)+'</text><text x="65" y="87">Full PCR · '+esc(expiry||'—')+'</text>'+paths+'<text x="50" y="161">'+time(cut)+'</text><text x="470" y="161">'+time(end)+' IST</text></svg>':empty('RECORDED · load full session or choose a longer window; each plot needs two verified observations.'));
 };

 const update=(payload:any,force=false)=>{
  const clock=new Date(Date.now());if($('op-terminal-date'))$('op-terminal-date').textContent=clock.toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'});if($('op-terminal-time'))$('op-terminal-time').textContent=time(clock.toISOString());
  $('os-reference-indices')?.querySelectorAll?.('[data-os-select]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.osSelect===selected)));
  const live=api.validEnvelope(payload),d=live?payload:null,key=live?d.snapshot.runtimeId+'|'+d.snapshot.tradeDate:'';last=payload;
  if(live&&paintedLive&&key===session&&!force&&Date.now()-lastPaint<500)return;lastPaint=Date.now();paintedLive=live;
  if(key!==session){session=key;series.clear();conflicts.clear();pcrIds.clear();previous.clear();breaks.clear();events.length=0;pcr=null;}
  pcr=api.derivePcr(d,pcr,Date.now());
  const groups=live&&Array.isArray(d.snapshot.atmExpiryLadder)?d.snapshot.atmExpiryLadder:[];
  const matching=groups.filter((g:any)=>g.symbol===selected),group=matching.length===1?matching[0]:null;
  const optionRows=group&&valid(d,group.spot,'SPOT',selected)&&Array.isArray(group.rows)?group.rows.filter((r:any)=>/^\d{4}-\d{2}-\d{2}$/.test(r?.expiry||'')&&Number.isFinite(Date.parse(r.expiry+'T00:00:00Z'))&&new Date(r.expiry+'T00:00:00Z').toISOString().slice(0,10)===r.expiry&&r.expiry>=d.snapshot.tradeDate&&positive(r.strike)!==null&&group.rows.filter((x:any)=>x?.expiry===r.expiry).length===1).sort((a:any,b:any)=>a.expiry.localeCompare(b.expiry)).slice(0,4):[];
  if(live){
   for(const symbol of symbols){const a=indexRow(d,symbol);if(!a)continue;
    observe(d,a);if(valid(d,a.spot,'SPOT',symbol))sample(symbol+'|SPOT',Date.parse(a.spot.observedAt),a.spot.price);else series.delete(symbol+'|SPOT');
    if(valid(d,a.future,'FUTURE',symbol))sample(symbol+'|FUTURE|'+a.future.identity.token+'|'+a.future.identity.expiry,Date.parse(a.future.observedAt),a.future.price);
    const r=pcr.rows.find((x:any)=>x.symbol===symbol),identity=r?.current?r.expiry+'|'+r.current.period:'';
    if(pcrIds.get(symbol)!==identity){series.delete(symbol+'|PCR');conflicts.delete(symbol+'|PCR');pcrIds.set(symbol,identity);}
    if(r?.current)sample(symbol+'|PCR',r.current.checked,r.value);else series.delete(symbol+'|PCR');
   }
   for(const r of optionRows)for(const side of ['CE','PE']){const q=r[side.toLowerCase()];if(valid(d,q,'OPTION',selected)&&q.identity.expiry===r.expiry&&q.identity.strike===r.strike&&q.identity.side===side)sample(selected+'|OPTION|'+q.identity.token+'|'+r.expiry+'|'+r.strike+'|'+side,Date.parse(q.observedAt),q.price);}
  }
  renderDte(d,optionRows);
  const useRecorded=sourceMode==='RECORDED'||sourceMode==='AUTO'&&payload?.connectionState==='MARKET_CLOSED';
  const savedState=api.getState?.();
  if($('os-recorded-date')&&document.activeElement!==$('os-recorded-date')&&!loadBusy&&savedState?.date)$('os-recorded-date').value=savedState.date;
  write('os-reading-status',useRecorded?'RECORDED · '+esc(savedState?.date||'load a session')+' · radar / ladder / PCR / chart use saved observations. Other panels retain LIVE source gates.':live?'LIVE · fresh Kite observations · four-expiry workspace V2':'LIVE unavailable · '+esc(payload?.connectionState||'connecting')+' · choose Recorded for saved observations.');
  write('os-market-radar',symbols.map((symbol,i)=>{const a=live?indexRow(d,symbol):null,q=a?.spot,f=a?.future,ok=a&&valid(d,q,'SPOT',symbol),fo=a&&valid(d,f,'FUTURE',symbol),r=ok?refs(d,symbol,q):{pdh:null,pdl:null,pdc:null},v=pcr.rows.find((x:any)=>x.symbol===symbol),c=ok?change(d,q,'SPOT',symbol):null,e=breaks.get(symbol);
   const position=!ok?'Fresh quote unavailable':e?e.label+' · '+time(e.at)+' IST':r.pdh!==null&&q.price>r.pdh?'Above PDH':r.pdl!==null&&q.price<r.pdl?'Below PDL':r.pdh===null||r.pdl===null?'PDH / PDL source —':'No observed PDH / PDL break';
   return '<button type="button" class="os-market" style="--os-accent:'+accents[i]+'" data-os-index="'+symbol+'" aria-pressed="'+(symbol===selected)+'"><span class="os-market-head">'+symbol+'<small class="'+tone(c)+'">'+pct(c)+'</small></span><strong class="os-price">'+fmt(ok?q.price:null)+'</strong><small class="os-subline">Spot · FUT '+fmt(fo?f.price:null)+'</small><small class="os-subline">SPOT · PDH / PDC / PDL</small><span class="os-levels">'+(['pdh','pdc','pdl'] as const).map(k=>'<span>'+k.toUpperCase()+'<b>'+fmt(r[k],2)+'</b></span>').join('')+'</span><small class="os-subline">FUT '+esc(fo?f.identity.expiry:'—')+' · PDH / PDC / PDL</small><span class="os-levels">'+(['pdh','pdc','pdl'] as const).map(k=>'<span>'+k.toUpperCase()+'<b>'+fmt(futureRefs(d,a)[k],2)+'</b></span>').join('')+'</span><span class="os-level-state">'+esc(position)+'</span><small class="os-subline">Full PCR '+fmt(v?.value,4)+' · '+(symbol==='BANKNIFTY'?'Monthly · ':'')+(ok?time(q.observedAt)+' IST':'—')+'</small></button>';
  }).join(''));
  const plotKey=selected+'|'+minutes+'|'+chartSeries+'|'+session+'|'+pcrIds.get(selected)+'|'+(series.has(selected+'|SPOT')?'SPOT':'NO_SPOT')+'|'+(series.has(selected+'|PCR')?'PCR':'NO_PCR');
  if(force||!live||plotKey!==chartKey||!chartManual&&Date.now()-chartAt>=chartCadence){chartKey=plotKey;chartAt=Date.now();write('os-pulse-chart',live?graph(d):empty((payload?.connectionState==='MARKET_CLOSED'?'Market closed':'Live feed unavailable')+' · choose Recorded for saved observations.'));}
  const spot=live?indexRow(d,selected)?.spot:null,spotOk=live&&valid(d,spot,'SPOT',selected),open=spotOk?positive(spot.dayOpen):null,pdc=spotOk?positive(spot.pdc):null,gap=open!==null&&pdc!==null?open-pdc:null;
  write('os-spot-context',esc(selected)+' · '+fmt(spotOk?spot.price:null)+'<small>LIVE · '+(spotOk?time(spot.observedAt)+' IST':'quote unavailable')+' · '+(gap===null?'Gap unknown: verified session Open / PDC required':(gap>0?'Gap up':gap<0?'Gap down':'Flat open')+' '+fmt(gap)+' points ('+pct(gap/pdc!*100)+')')+'</small>');
  // Saved PCR is a separately labelled observation, never a substitute for live OI.
  // Use only today's already-loaded archive, at/before source time and exact live expiry.
  const recordedState=api.getState?.(),recorded=live&&recordedState?.date===d.snapshot.tradeDate&&typeof api.deriveRecordedPcr==='function'&&pcr.rows.some((r:any)=>r.value===null)?api.deriveRecordedPcr(recordedState,d.serverTime,null,Date.now()):null;
  write('os-pcr-strip',symbols.map(symbol=>{
   const r=pcr.rows.find((x:any)=>x.symbol===symbol),direction=r?.direction||'WAIT',arrow=direction==='UP'?'↑':direction==='DOWN'?'↓':direction==='FLAT'?'→':'—';
   const colour=direction==='UP'?'os-up':direction==='DOWN'?'os-down':'';
   const c=r?.coverageInfo,coverage=r?.current?'OI '+r.current.expected+'/'+r.current.expected+' verified':c&&c.fresh+c.stale+c.missing+c.invalid===c.expected?'OI '+c.fresh+'/'+c.expected+' fresh · stale '+c.stale+' · missing '+c.missing+' · invalid '+c.invalid:'';
   const saved=recorded?.rows.find((x:any)=>x.symbol===symbol&&x.expiry===r?.expiry&&x.current&&n(x.value)!==null);
   const savedHtml=r?.value===null&&saved?'<div class="os-pcr-recorded"><small>RECORDED · Full PCR</small><strong>'+saved.value.toFixed(4)+'</strong><small>'+esc(recordedState.date)+' · '+time(saved.current.checked)+' IST</small><small>Expiry '+esc(saved.expiry)+' · saved full-chain source</small></div>':'';
   const reported=r?.reportedPcr,reportedHtml=reported&&!r?.current?'<div class="os-pcr-reported"><small>Full-chain reported PCR · MIXED SOURCE TIMES</small><b>'+reported.value.toFixed(4)+'</b><small>'+reported.reported+'/'+reported.expected+' contracts · '+reported.olderThan30s+' older than 30s</small><small>Source '+time(reported.sourceMinAt)+' → '+time(reported.sourceMaxAt)+' IST · checked '+time(reported.checkedAt)+' IST</small><small>Latest reported OI · no fresh alignment</small></div>':'';
   return '<div class="os-pcr" data-pcr-index="'+symbol+'"><strong>'+symbol+(symbol==='BANKNIFTY'?' · M':'')+'</strong><small>'+ (r?.current?'LIVE · Full OI PCR':'UNAVAILABLE · Fresh Full PCR')+'</small><b>'+ (n(r?.value)!==null?r.value.toFixed(4):'—')+' <span class="'+colour+'" aria-label="PCR '+direction.toLowerCase()+'">'+arrow+'</span></b><small>Expiry '+esc(r?.expiry||'unavailable')+'</small><small>ATM ±7 band: '+fmt(r?.bandValue,4)+(r?.bandCheckedAt?' · 30/30 verified · '+time(r.bandCheckedAt)+' IST':'')+'</small><small>'+esc(r?.current?'Checked '+time(r.current.checked)+' IST · '+r.current.period/60000+'m snapshots':r?.pcrStatus?.replaceAll('_',' ')||'UNAVAILABLE')+'</small>'+(coverage?'<small>'+esc(coverage)+(c&&!r?.current?' · checked '+time(c.checked)+' IST':'')+'</small>':'')+'<small>'+esc(r?.baseline?'Compared '+time(r.baseline.checked)+' → '+time(r.current.checked)+' IST':r?.current?'Arrow: waiting for comparable snapshot':'Full expiry OI not verified')+'</small>'+reportedHtml+savedHtml+'</div>';
  }).join(''));
  const v=live?d.snapshot.vix:null,vo=live&&valid(d,v,'VIX');
  write('os-vix-value','<small class="os-subline">INDIA VIX · '+(vo?time(v.observedAt)+' IST':'SOURCE UNAVAILABLE')+'</small><div class="os-vix-number">'+fmt(vo?v.price:null)+'</div><span class="'+tone(vo?change(d,v,'VIX'):null)+'">'+pct(vo?change(d,v,'VIX'):null)+' vs previous close</span>');
  const futureCount=live?symbols.filter(symbol=>{const a=indexRow(d,symbol);return a&&valid(d,a.future,'FUTURE',symbol);}).length:0;
  const fullCount=pcr.rows.filter((r:any)=>r.current).length;
  const peeps=live?(d.snapshot.participation||[]):[],stockCount=peeps.filter((q:any)=>q.identity?.role==='STOCK'&&valid(d,q,'STOCK')).length;
  write('os-agreement','<div>FUTURES<b>'+futureCount+'/3 fresh</b></div><div>FULL OI<b>'+fullCount+'/3 verified</b></div><div>STOCKS<b>'+stockCount+' fresh</b></div>'+badge('Full PCR Δ · '+pcr.alignment.replaceAll('_',' ')));
  const aligned= symbols.map(s=>breaks.get(s)),times=aligned.map(e=>Date.parse(e?.at||'')),now=Date.parse(d?.serverTime||'');
  const triple=live&&aligned.every(Boolean)&&new Set(aligned.map(e=>e.label)).size===1&&Math.max(...times)-Math.min(...times)<=5000&&times.every(t=>now-t>=0&&now-t<=60000);
  const sideSummary=(side:string)=>{const quotes=optionRows.map(r=>({r,q:r[side.toLowerCase()]})),values=quotes.map(({r,q})=>valid(d,q,'OPTION',selected)&&q.identity.expiry===r.expiry&&q.identity.strike===r.strike&&q.identity.side===side?change(d,q,'OPTION',selected):null),stamps=quotes.map(({q})=>Date.parse(q?.observedAt||''));
   const synced=values.length>0&&values.every(x=>x!==null)&&Math.max(...stamps)-Math.min(...stamps)<=5000;
   const state=!synced?'UNAVAILABLE':values.every(x=>x!>0)?'ALL UP':values.every(x=>x!<0)?'ALL DOWN':values.every(x=>x===0)?'FLAT':'MIXED';return badge(side+' · '+state+' · '+values.filter(x=>x!==null).length+'/'+values.length+' expiries',state==='ALL UP'?'os-up':state==='ALL DOWN'?'os-down':'');};
  write('os-dte-alignment',sideSummary('CE')+sideSummary('PE')+'<small class="os-subline">'+esc(selected)+' · day returns vs each contract previous close · timestamps within 5s · no cross-contract trade score</small>');
  write('os-events',(triple?badge('🚨 3-index same-side '+aligned[0].label,'os-alert'):'')+(events.length?table(['Time · IST','Index','Event','Verified observation'],events.slice(0,8).map(e=>[time(e.at),esc(e.symbol),esc(e.label),esc(e.detail)])):table(['Time · IST','Index','Event','Verified observation'],[])+empty(live?'No verified level crossing observed in this browser session.':'Market closed / disconnected · live events cleared; use recorded research for saved events.')));
  write('os-future-response',allFutureLevels(d)+(live?'<details class="os-source"><summary>Same-contract futures / premium response</summary>'+response(d,indexRow(d,selected),optionRows)+'</details>':empty('Fresh futures and premium observations required · no stale comparison.')));
  write('os-wall-ladder',table(['Index / expiry','Full PCR / band','CE OI / Δ','PE OI / Δ','CE / PE wall','Fresh futures OI'],symbols.map(symbol=>{
   const r=pcr.rows.find((x:any)=>x.symbol===symbol),a=live?indexRow(d,symbol):null,raw=r?.current?d?.pcrDisplay?.[symbol]:null,cw=raw?.callWall,pw=raw?.putWall;
   const delta=(key:string)=>r?.current&&r?.baseline?r.current[key]-r.baseline[key]:null;
   const oi=(key:string)=>fmt(r?.current?.[key],0)+'<small>Δ '+(delta(key)>0?'+':'')+fmt(delta(key),0)+(r?.baseline?' · '+time(r.baseline.checked)+' → '+time(r.current.checked)+' IST':' · baseline pending')+'</small>';
   return [esc(symbol)+'<small>'+esc(r?.expiry||'—')+'</small>',fmt(r?.value,4)+' / '+fmt(r?.bandValue,4),oi('ceTotal'),oi('peTotal'),fmt(positive(cw?.strike),0)+' / '+fmt(positive(pw?.strike),0)+'<small>OI '+fmt(positive(cw?.oi),0)+' / '+fmt(positive(pw?.oi),0)+'</small>',fmt(a&&valid(d,a.future,'FUTURE',symbol)&&n(a.future.oi)!==null&&a.future.oi>=0?a.future.oi:null,0)];
  })));

  if($('os-stocks')?.open||!live)write('os-stock-ranks',rank(d,'STOCK'));
  if($('os-sectors')?.open||!live)write('os-sector-ranks',rank(d,'SECTOR'));
  if(useRecorded)renderRecorded();
  root.dataset.osSource=useRecorded?'RECORDED':'LIVE';
 };
 const showPreface=(show:boolean,focus=false)=>{
  $('os-preface').hidden=!show;$('os-dashboard').hidden=show;
  $('os-open-preface').setAttribute('aria-expanded',String(show));$('os-open-dashboard').setAttribute('aria-pressed',String(!show));
  if(focus)(show?$('os-preface-title'):$('os-open-dashboard')).focus?.();
 };
 // Four primary data hubs navigate the existing source-backed panels without a fetch.
  if($('os-command-deck'))$('os-command-deck').onclick=(e:any)=>{
   const link=e.target.closest?.('[data-os-hub]');if(!link)return;
   const id=link.getAttribute('href')?.slice(1),target=id?$(id):null;if(!target)return;
   e.preventDefault();if(target.tagName==='DETAILS')target.open=true;
   $('os-command-deck').querySelectorAll?.('[data-os-hub]').forEach((a:any)=>{if(a===link)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
   target.scrollIntoView?.({block:'start',behavior:'auto'});
  };
  // Reuse existing Recorder/RAG actions; no new endpoint, prediction or broker action.
 if($('os-rag-open'))$('os-rag-open').onclick=()=>$('op-one-actions')?.querySelector?.('[data-op-one="RAG"]')?.click?.();
 if($('os-memory-open'))$('os-memory-open').onclick=()=>$('op-one-actions')?.querySelector?.('[data-op-one="RECORDED"]')?.click?.();
 $('os-open-preface').onclick=()=>showPreface($('os-preface').hidden,true);
 $('os-open-dashboard').onclick=()=>showPreface(false,true);
 showPreface(false);
 const selectIndex=(next:string)=>{if(!symbols.includes(next))return;selected=next;if($('os-index'))$('os-index').value=next;api.chooseIndex(next);update(last,true);};
 $('os-index').onchange=(e:any)=>selectIndex(e.target.value);
 $('os-source').onchange=(e:any)=>{if(!['AUTO','LIVE','RECORDED'].includes(e.target.value))return;sourceMode=e.target.value;update(last,true);};
 $('os-sides').onclick=(e:any)=>{const side=e.target.closest?.('[data-os-side]')?.dataset?.osSide;if(!['BOTH','CE','PE'].includes(side))return;sideMode=side;$('os-sides').querySelectorAll?.('[data-os-side]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.osSide===side)));update(last,true);};
 $('os-chart-series').onchange=(e:any)=>{if(!['BOTH','SPOT','PCR'].includes(e.target.value))return;chartSeries=e.target.value;update(last,true);};
 $('os-chart-cadence').onchange=(e:any)=>{if(!['0','180000','MANUAL'].includes(e.target.value))return;chartManual=e.target.value==='MANUAL';chartCadence=chartManual?0:Number(e.target.value);update(last,true);};
 $('os-chart-refresh').onclick=()=>update(last,true);
 $('os-load-recorded').onclick=async()=>{const date=$('os-recorded-date').value,s=api.getState?.();if(loadBusy||s?.loading||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!api.setDate)return;loadBusy=true;$('os-load-recorded').disabled=true;write('os-load-status','Loading '+esc(date)+' full session…');try{await api.setDate(date,{scope:'FULL',fullSession:true});if(api.getState?.()?.date!==date||api.getState?.()?.scope!=='FULL')throw Error('Full session did not load; earlier selection retained');sourceMode='RECORDED';$('os-source').value='RECORDED';write('os-load-status','Loaded '+esc(date)+' · absent contracts stay unavailable');}catch(e:any){write('os-load-status','Load failed · '+esc(e?.message||'try again'));}finally{loadBusy=false;$('os-load-recorded').disabled=false;update(last,true);}};
 $('os-navigation').onclick=(e:any)=>{const id=e.target.closest?.('[data-os-go]')?.dataset?.osGo;if(!['radar','pulse','premium','futures','walls','stocks','sectors','vix','memory','tools'].includes(id))return;const target=$('os-'+id);if(target){if(target.tagName==='DETAILS')target.open=true;target.scrollIntoView?.({block:'start',behavior:'auto'});}root.querySelectorAll?.('[data-os-go]').forEach((b:any)=>{if(b.dataset.osGo===id)b.setAttribute('aria-current','location');else b.removeAttribute?.('aria-current');});};
 let dateScope='ALL';
 const showDateScope=(scope:string)=>{
  const state=api.getState?.(),datePattern=/^\d{4}-\d{2}-\d{2}$/;
  const dates=[...new Set<string>((Array.isArray(state?.recordedDates)?state.recordedDates:[]).filter((v:any)=>typeof v==='string'&&datePattern.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v))].sort();
  const knownExpiries=new Set(recordedData().rows.map((r:any)=>r.expiry));
  const visible=scope==='LAST5'?dates.slice(-5):scope==='EXPIRY'?dates.filter(v=>knownExpiries.has(v)):dates;
  dateScope=scope;$('os-date-scope')?.querySelectorAll?.('[data-os-scope]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.osScope===scope)));
  write('os-date-options',visible.length?visible.map(date=>'<button type="button" data-os-date="'+esc(date)+'">'+esc(date)+'</button>').join(''):empty(scope==='EXPIRY'?'No saved session matches a loaded verified expiry. Load a saved session first.':'Saved date inventory is not loaded. Open Data / session settings.'));
  write('os-date-note',esc((scope==='EXPIRY'?'Expiry Days uses only expiry dates from the loaded verified option inventory. ':'')+'Choose one date to load one full recorded session. This does not run an all-date backtest.'));
  if($('os-date-picker'))$('os-date-picker').open=true;
 };
 if($('os-date-scope'))$('os-date-scope').onclick=(e:any)=>{const scope=e.target.closest?.('[data-os-scope]')?.dataset?.osScope;if(['ALL','LAST5','EXPIRY'].includes(scope))showDateScope(scope);};
 if($('os-date-options'))$('os-date-options').onclick=(e:any)=>{const date=e.target.closest?.('[data-os-date]')?.dataset?.osDate;if(typeof date!=='string')return;$('os-recorded-date').value=date;$('os-load-recorded').click?.();};
 if($('os-premium-expiries'))$('os-premium-expiries').onclick=(e:any)=>{const button=e.target.closest?.('[data-os-expiry]');if(!button)return;premiumExpiry=button.dataset.osExpiry||'';update(last,true);};
 if($('os-reference-indices'))$('os-reference-indices').onclick=(e:any)=>{const next=e.target.closest?.('[data-os-select]')?.dataset?.osSelect;if(symbols.includes(next))selectIndex(next);};
 $('os-market-radar').onclick=(e:any)=>{const next=e.target.closest?.('[data-os-index]')?.dataset?.osIndex;if(!symbols.includes(next))return;selectIndex(next);};
 $('os-dte-metric').onclick=(e:any)=>{const mode=e.target.closest?.('[data-os-dte-metric]')?.dataset?.osDteMetric;if(!['day','window'].includes(mode))return;dteMetric=mode;$('os-dte-metric').querySelectorAll?.('[data-os-dte-metric]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.osDteMetric===mode)));update(last,true);};
 $('os-window').onclick=(e:any)=>{const next=Number(e.target.closest?.('[data-os-window]')?.dataset?.osWindow);if(![1,3,5,6,15,30,60].includes(next))return;minutes=next;$('os-window').querySelectorAll?.('[data-os-window]').forEach((b:any)=>b.setAttribute('aria-pressed',String(Number(b.dataset.osWindow)===minutes)));update(last,true);};
 for(const id of ['os-stocks','os-sectors'])if($(id))$(id).ontoggle=()=>{if($(id).open)update(last,true);else write(id==='os-stocks'?'os-stock-ranks':'os-sector-ranks','');};
 update(null,true);
 return {update,select(symbol:string){if(symbols.includes(symbol)){selected=symbol;if($('os-index'))$('os-index').value=symbol;update(last,true);}},refresh(){update(last,true);}};
}

