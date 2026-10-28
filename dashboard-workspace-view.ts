import { SCREEN_OVERVIEW_CSS, installScreenOverview } from './screen-overview.js';
import { REFERENCE_TERMINAL_CSS } from './reference-terminal-style.js';
import { renderOneShotCard, ONE_SHOT_CSS, installOneShotLiveCard } from './one-shot-live-card.js';
import { installPremiumWorkspace } from './premium-workspace-view.js';
import { deriveLiveThreeIndexPcr, deriveRecordedThreeIndexPcr } from './live-three-index-pcr.js';

const COMMODITY_CARD_HTML=`<details id="op-commodities" hidden aria-label="10 Commodities command card">
<summary><strong>10 · Commodities</strong><span>Crude Oil · Natural Gas</span><small>Feed not connected · Show / hide</small></summary>
<div class="op-commodity-body"><div class="op-commodity-instruments"><strong>CRUDE OIL <small>Missing quote · —</small></strong><strong>NATURAL GAS <small>Missing quote · —</small></strong></div>
<nav aria-label="Commodity categories"><a href="#op-commodity-futures">10.1 Futures</a><a href="#op-commodity-levels">10.2 Levels + Depth</a><a href="#op-commodity-premiums">10.3 Premiums</a><a href="#op-commodity-followers">10.4 Followers</a><a href="#op-commodity-status">10.5 Data status</a></nav>
<details id="op-commodity-futures"><summary>10.1 · Futures</summary><p>Front / next contract · Expiry · LTP · Change: —</p></details>
<details id="op-commodity-levels"><summary>10.2 · Levels + Depth</summary><p>PDH / PDC / PDL · 15m H/L · Bid / Ask · Spread · Volume · OI: —</p></details>
<details id="op-commodity-premiums"><summary>10.3 · Premiums</summary><p>Linked CE / PE · Expiry / countdown · Strike ladder · OI addition / shedding rank: —</p></details>
<details id="op-commodity-followers"><summary>10.4 · Futures followers</summary><p>Premiums following the same underlying futures contract: unavailable.</p></details>
<details id="op-commodity-status" open><summary>10.5 · Data status</summary><p>NOT CONNECTED · Source timestamp: — · Contract identity: unverified.</p><small>Live / stale / missing readings will require verified Kite MCX quotes. No commodity values are available yet.</small></details>
</div></details>`;

const LEGACY_WORKSPACE_NAV_HTML=`<aside id="op-workspace-nav" aria-label="Dashboard chapters"><div class="op-rail-inner"><a class="op-logo" href="/">OP<span>OptionPilot <b>PRO</b></span></a><div class="op-rail-label">YOUR MARKET WORKSPACE</div><div id="op-chapter-links"></div><div id="op-terminal-clock" aria-label="Display clock in IST"><time id="op-terminal-date">IST</time><time id="op-terminal-time">—</time></div><div class="op-rail-foot">NIFTY · SENSEX<br><span>BANKNIFTY · monthly observation</span></div></div></aside><div id="op-workspace-top"><strong>OptionPilot</strong><button id="op-open-commodities" hidden type="button" aria-controls="op-commodities" aria-expanded="false">10 · Commodities</button><div id="op-workspace-feed" role="status">Connecting to market feed</div></div><section id="op-one-stop" aria-label="One-stop market evidence"><div class="op-one-title"><div><span class="op-kicker">ONE CARD / ONE STOP</span><h2>Market command card</h2></div><div id="op-one-status" role="status" aria-live="polite">Waiting for connected live evidence</div></div><div id="op-one-actions" role="group" aria-label="Open existing market tools"><button type="button" data-op-one="LIVE">Live detail</button><button type="button" data-op-one="LADDER">CE / PE ladder</button><button type="button" data-op-one="MULTIDAY">Multi-day research</button><button type="button" data-op-one="RAG">Ask RAG</button><button type="button" data-op-one="RECORDED">Open recorded ladder</button><a class="op-spread-shortcut" href="/api/research/premium-spread/view" title="Recorded exact-contract 1-minute CE minus PE premium gap">1m CE−PE Spread ↗</a></div><details id="op-command-index"><summary>All numbered chapters · Show / hide</summary><nav id="op-command-chapters" aria-label="Command card chapter shortcuts"></nav></details><details id="op-summary-panel" open><summary>Three-index summary · Show / hide</summary><div class="op-one-scroll"><table aria-label="Verified latest Kite market readings"><thead><tr><th>Index / expiry</th><th>Spot</th><th>Future</th><th>CE ₹</th><th>PE ₹</th><th>Full PCR</th><th>CE wall</th><th>PE wall</th></tr></thead><tbody id="op-one-rows"><tr><td colspan="8">Waiting for actual Kite stream · unavailable is not zero</td></tr></tbody></table></div></details><details id="op-atm-weeklies" aria-label="ATM CE and PE by expiry date"><summary>ATM CE / PE · all expiries · Show / hide</summary><div class="op-atm-head"><div><strong>ATM CE × ATM PE · expiry by expiry</strong><small>Actual listed expiry dates — not DTE 0–4</small></div><div class="op-atm-settings"><label>Index <select id="op-atm-index" aria-label="ATM ladder index"><option>NIFTY</option><option>SENSEX</option><option>BANKNIFTY</option></select></label><div id="op-atm-modes" role="group" aria-label="ATM CE PE display"><button type="button" data-atm-mode="BOTH" aria-pressed="true">CE + PE</button><button type="button" data-atm-mode="CE" aria-pressed="false">CE only</button><button type="button" data-atm-mode="PE" aria-pressed="false">PE only</button></div></div></div><div id="op-atm-levels" role="group" aria-label="Premium PDH PDL and FIB controls"><button data-atm-level="PDL" type="button" aria-pressed="true">↓ PDL</button><button data-atm-level="PDH" type="button" aria-pressed="false">↑ PDH</button><button data-atm-level="PDC" type="button" aria-pressed="false">PDC</button><button data-atm-level="FIB" type="button" aria-pressed="false">FIB R3–S3</button><button data-atm-open-fib type="button" aria-label="Open detailed FIB ladder">FIB detail ↗</button><small id="op-atm-level-note">Select multiple levels together · FIB HOLD needs verified same-contract observations.</small></div><div id="op-atm-status" role="status">Awaiting exact expiry inventory</div><div id="op-atm-pairs" class="op-atm-columns"><p>Waiting for fresh subscribed options.</p></div><p class="op-one-note">ATM strike is selected separately for each exact expiry from available matched CE/PE strikes. Not every calendar week is guaranteed in the Kite subscription. BANKNIFTY remains monthly observation.</p></details><p class="op-one-note">One shared stream; exact expiry and source timestamps. PCR and wall values appear only for a complete, current full-chain snapshot. BANKNIFTY = monthly observation. Read-only evidence, not a trading signal.</p></section>${COMMODITY_CARD_HTML}`;

// Preserve exact-contract ATM controls while replacing the old command-table card.
const oneStart=LEGACY_WORKSPACE_NAV_HTML.indexOf('<section id="op-one-stop"');
const oneEnd=LEGACY_WORKSPACE_NAV_HTML.indexOf('<details id="op-commodities"');
const atmStart=LEGACY_WORKSPACE_NAV_HTML.indexOf('<details id="op-atm-weeklies"');
const atmEnd=LEGACY_WORKSPACE_NAV_HTML.indexOf('</details><p class="op-one-note">One shared stream',atmStart)+10;
const actualAtm=LEGACY_WORKSPACE_NAV_HTML.slice(atmStart,atmEnd);
const RESEARCH_CONTROLS_HTML=`<section id="op-research-controls" aria-label="Recorded research controls"><div class="op-recorder-group"><span class="op-recorder-icon" aria-hidden="true">▤</span><div><strong>Recorder Data (Single Button)</strong><small id="op-research-session">Open recorded market session</small></div><button id="op-research-open-data" type="button" aria-controls="recorded-replay">OPEN DATA</button></div><div class="op-date-group"><strong>Date Scope</strong><nav id="os-date-scope" aria-label="Recorded date inventory"><button type="button" data-os-scope="ALL" aria-pressed="true">All Dates</button><button type="button" data-os-scope="LAST5" aria-pressed="false">Last 5</button><button type="button" data-os-scope="EXPIRY" aria-pressed="false">Expiry Days</button></nav></div><div class="op-index-group"><strong>Index</strong><nav id="os-reference-indices" class="os-reference-indices" aria-label="Research index">${['NIFTY','SENSEX','BANKNIFTY'].map(x=>`<button type="button" data-os-select="${x}" aria-pressed="${x==='NIFTY'}">${x}</button>`).join('')}</nav></div></section><details id="os-date-picker"><summary>Saved session dates · choose one session</summary><div id="os-date-options"></div><small id="os-date-note">Date scope filters the available session list; choosing a date loads that single session.</small></details>`;
export const WORKSPACE_NAV_HTML=LEGACY_WORKSPACE_NAV_HTML.slice(0,oneStart)+RESEARCH_CONTROLS_HTML+renderOneShotCard(actualAtm)+'<details id="op-subviews"><summary>Chapter tools</summary><nav id="op-view-links" aria-label="Chapter tools"></nav></details>'+LEGACY_WORKSPACE_NAV_HTML.slice(oneEnd);

export const WORKSPACE_TICKER_HTML=`<details id="op-ticker-tools"><summary>Market ticker</summary><div id="op-workspace-ticker" aria-label="Market snapshot"></div></details>`;

export const WORKSPACE_CSS=`#op-one-actions .op-spread-shortcut{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 12px;border:1px solid #45eac0;border-radius:8px;background:#133c36;color:#b8ffe9;text-decoration:none;font-weight:700}

#op-commodities{border:1px solid #5865a4;border-radius:14px;background:linear-gradient(120deg,#171d32,#122e32);padding:12px;margin:10px 0;color:#edf6ff}
#op-commodities summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:16px}
#op-commodities>summary strong{color:#a9f4df}#op-commodities small{color:#b9c7da;font-size:12px}#op-commodities>summary small{margin-left:auto;color:#f0c88f}
.op-commodity-instruments{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}.op-commodity-instruments strong{padding:10px;border:1px solid #42656d;border-radius:10px;color:#87e7dc}.op-commodity-instruments small{display:block;margin-top:5px}
#op-commodities nav{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}#op-commodities a{color:#c6d8ff;padding:9px;border:1px solid #52618b;border-radius:8px;text-decoration:none}
#op-commodities .op-commodity-body>details{border-top:1px solid #3a4d66;padding:5px 0;scroll-margin-top:15px}#op-commodities p{font-size:14px;line-height:1.6;color:#b9c7da;margin:6px 0}
#op-open-commodities{flex-shrink:0}#op-workspace-top{flex-wrap:wrap}#op-commodities nav a:focus-visible,#op-commodities summary:focus-visible{outline:2px solid #58e5dc;outline-offset:3px}
@media(max-width:600px){#op-workspace-top>strong{flex:1}#market-book #op-workspace-feed{max-width:none;width:100%;box-sizing:border-box}#op-commodities>summary small{margin-left:0;width:100%}#op-commodities nav a{flex:1 1 40%;font-size:13px}}

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
#op-command-chapters{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}#op-command-chapters button{font-size:13px;padding:7px}#op-one-stop>details>summary{cursor:pointer;min-height:44px;padding:10px 0;font-size:15px;color:#b9eeee}#op-one-stop>details{border-top:1px solid #2a5360}#op-one-actions{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}
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

/* PR4: mobile one-stop, all three indices readable without sideways scrolling. */
@media(max-width:600px){
 .op-one-scroll{overflow-x:visible;border:0}
 #op-one-stop table{display:block;min-width:0;width:100%;white-space:normal}
 #op-one-stop thead{display:none}
 #op-one-stop tbody{display:block}
 #op-one-stop tbody tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;border:1px solid #2a5360;border-radius:9px;padding:6px;margin:0 0 7px}
 #op-one-stop tbody tr>th{grid-column:1/-1;border:0;padding:3px 4px;font-size:14px;color:#bcfff0}
 #op-one-stop tbody tr>td{min-width:0;border:0;padding:4px 3px;font-size:13px;line-height:1.3;overflow-wrap:anywhere}
 #op-one-stop tbody tr>td:before{content:attr(data-metric);display:block;font-size:10px;color:#9ed5da;font-weight:700}
 #op-one-stop tbody tr>td:not([data-metric]){grid-column:1/-1}
 #market-book #op-one-stop .op-one-scroll :is(th,td){white-space:normal;overflow-wrap:anywhere}
 #market-book #op-one-stop .op-one-scroll td[colspan]{font-family:system-ui,sans-serif;max-width:100%}
 #op-summary-panel,.op-one-scroll{min-width:0;max-width:100%}
 #op-one-stop tbody tr>td:not([data-metric]):before{display:none}
 #op-one-stop td small{font-size:10px;white-space:normal;overflow-wrap:anywhere}
 #op-atm-pairs{grid-template-columns:repeat(2,minmax(0,1fr));overflow-x:visible;gap:6px}
 #op-atm-pairs.op-atm-solo{grid-template-columns:minmax(0,1fr)}
 #op-atm-pairs .op-atm-side{min-width:0;padding:5px;overflow-wrap:anywhere}
 #op-atm-pairs table{width:100%;min-width:0;table-layout:fixed}
 #op-atm-pairs :is(th,td){font-size:10px;padding:4px 2px;white-space:normal;overflow-wrap:anywhere}
 #op-atm-pairs td small{font-size:9px;white-space:normal;overflow-wrap:anywhere}
}

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
/* Shared chapter density: retain readable values and 44px touch controls. */
body[data-op-workspace] #market-book:not([data-chapter="1"]) #op-one-stop{display:none}
body[data-op-workspace] #market-book .mb-chapter-head h2{display:none}
body[data-op-workspace] #market-book .mb-turn{display:flex;align-items:center;gap:5px;margin:4px 0;padding:4px 0}
body[data-op-workspace] #market-book .mb-current-chapter{display:flex;align-items:center;gap:5px;min-width:0}
body[data-op-workspace] #market-book #mb-page-count{display:none}
body[data-op-workspace] #market-book .mb-turn :is(button,select){font-size:14px;min-height:44px;padding:6px;border-radius:8px}
body[data-op-workspace] #market-book .mb-turn>button{flex:0 0 36px}
body[data-op-workspace] #market-book .mb-detail-toolbar{margin:0;flex:0 0 auto}
body[data-op-workspace] #market-book #mb-details-toggle{font-size:12px;white-space:nowrap}
body[data-op-workspace] #market-book .mb-scope{font-size:13px;line-height:1.35;margin:3px 0 6px;padding:3px 6px}
body[data-op-workspace] #market-book #mb-page.mb-renovated>h3{font-size:20px;margin:12px 0 7px}
body[data-op-workspace] #market-book #mb-page.mb-renovated .mb-box{padding:10px;border-radius:10px}
body[data-op-workspace] #market-book #mb-page.mb-renovated .mb-event{margin:7px 0;padding:8px 10px}
body[data-op-workspace] #market-book .mb-reading-guide{margin:6px 0;padding:8px}
body[data-op-workspace] #market-book .mb-chapter-head{padding-bottom:6px;margin-bottom:6px;gap:5px}
body[data-op-workspace] #market-book .mb-chapter-head .mb-eyebrow{display:none}
/* Reference-image navigation: six destinations, with touch-sized mobile rows. */
#op-research-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;border:1px solid #31546b;border-radius:10px;padding:8px;margin:4px 0 8px;background:#101a2a}
#op-research-controls>div{flex:1;min-width:150px}#op-research-controls strong{color:#79f8e9}#op-research-controls small{display:block;color:var(--op-muted);overflow-wrap:anywhere}
#market-book #op-research-controls button{min-height:44px;padding:7px 12px;font-size:14px}
#market-book #op-research-open-data{border-color:#9569ed;color:#eadcff;background:#38215b}
@media(max-width:600px){#op-research-controls{gap:5px;padding:6px;margin:3px 0 5px}#op-research-controls>div{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:3px 7px;min-width:0}#op-research-controls strong{font-size:13px}#op-research-controls small{font-size:11px;line-height:1.3}#market-book #op-research-controls button{flex:1;min-width:0;min-height:40px;padding:5px 6px;font-size:12px;line-height:1.25}#market-book #op-view-links button{min-height:40px;padding:4px 8px;font-size:12px}#market-book #op-workspace-nav{display:none}}
#market-book #op-chapter-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;overflow:visible}
#market-book #op-chapter-links button{min-width:0;width:100%;padding:7px 3px;font-size:13px;justify-content:center;white-space:nowrap}
#market-book #op-chapter-links button>span{font-size:10px}
#op-view-links{display:flex;gap:5px;overflow-x:auto;max-width:100%;padding:3px 0 6px;scrollbar-width:thin}
#market-book #op-view-links button{flex:0 0 auto;min-height:44px;font-size:13px;padding:6px 10px;white-space:nowrap}
#op-view-links button[aria-pressed=true]{color:#79f8e9!important;border-color:#79f8e9!important;background:#17434b!important}
body[data-op-workspace] #market-book{padding:12px;min-width:0}
#market-book #op-workspace-nav{position:static;width:auto;padding:0;margin:0 0 8px;background:transparent;border:0;border-radius:0}
#market-book .op-rail-inner{position:static;display:grid;grid-template-columns:180px minmax(0,1fr);align-items:center;gap:10px}
#market-book .op-rail-label,#market-book .op-rail-foot{display:none}
#market-book .op-logo{display:flex;font-size:17px;gap:6px}
#market-book .op-logo>span{font-size:17px}#market-book .op-logo b{display:inline;font-size:17px;letter-spacing:0;margin:0}
@media(min-width:901px){#market-book #op-chapter-links{grid-template-columns:repeat(6,minmax(0,1fr))}}
#market-book #op-chapter-links button{min-height:44px;white-space:normal;line-height:1.25}
@media(max-width:900px){#market-book .op-rail-inner{display:block}#market-book .op-logo{display:none}}
/* Dated cash context fits in a single compact card. */
#market-book[data-chapter="11"] .mb-chapter-head,#market-book[data-chapter="11"] .mb-guide-shell{display:none}
#market-book .mb-cash-scope{padding:6px 0;display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}
#market-book .mb-cash-scope p{width:100%;margin:0;font-size:12px;line-height:1.4}
#market-book .mb-cash-actions{display:flex!important;align-items:end;gap:8px;margin:6px 0}
#market-book .mb-cash-actions>label{width:auto;min-width:110px;font-size:12px}
#market-book .mb-cash-actions>button{width:auto;min-height:44px;font-size:13px;padding:6px 10px}
#market-book .mb-cash-card .mb-glance-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
#market-book .mb-cash-card .mb-glance{min-width:0;padding:6px 4px}
#market-book .mb-cash-card .mb-glance span{font-size:12px;line-height:1.3}
#market-book .mb-cash-card .mb-glance strong{font-size:clamp(14px,4vw,24px);white-space:nowrap;letter-spacing:-.3px}
#market-book .mb-cash-card h3{font-size:16px;margin:0 0 4px}
#market-book .mb-cash-card p,#market-book .mb-cash-change{font-size:12px;line-height:1.4;margin:4px 0}
${ONE_SHOT_CSS}
${REFERENCE_TERMINAL_CSS}
${SCREEN_OVERVIEW_CSS}
`;

export function installDashboardWorkspace(api:any){
 const $=(id:string)=>document.getElementById(id) as any;if(!$('op-workspace-nav')||typeof document.querySelectorAll!=='function')return null;
 document.body.dataset.opWorkspace='true';
 // Screenshot destinations reuse existing view IDs and source pipelines.
 // Old device chapter checkboxes cannot hide a chapter in this navigation.
 const chapters:string[]=api.chapters;let active=-1,group=0;
 const groups=[{name:'Research',views:[0,6,12]}, {name:'Ladder',views:[7,2,3]},
  {name:'Futures & Spot',views:[4,1]}, {name:'PCR & Flow',views:[5,9,11]},
  {name:'Sector & Weight',views:[8,10]}, {name:'Memory & Replay',views:[7,6,10]}];
 const replayGroup=5,remembered=[0,7,4,5,8,7];
 // Open the existing saved-session UI; this action performs no fetch or replay.
 const openResearchTool=(id:string)=>{
  const tools=$('mb-tools'),target=$(id);if(!tools||!target)return;
  tools.open=true;target.open=true;target.scrollIntoView?.({block:'start',behavior:'auto'});
  target.querySelector?.('summary')?.focus?.();
 };
 if($('op-research-open-data'))$('op-research-open-data').onclick=()=>openResearchTool('recorded-replay');
 if($('op-research-settings'))$('op-research-settings').onclick=()=>openResearchTool('mb-settings');
 const researchScope=()=>{
  const controls=$('op-research-controls');if(controls)controls.hidden=group!==0;
  const label=$('op-research-session'),date=api.getState?.()?.date;
  if(label)label.textContent=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?'Saved session · '+date+' · recorded data':'Saved session · unavailable';
 };
 const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const premium=installPremiumWorkspace({getState:api.getState,setDate:api.setDate,replay:api.replay});
 const resolveGroup=(page:number)=>groups[group].views.includes(page)?group:Math.max(0,groups.findIndex(g=>g.views.includes(page)));
 const draw=()=>{const page=api.page();group=resolveGroup(page);active=page;remembered[group]=page;
  $('market-book')?.setAttribute('data-main-chapter',String(group+1));researchScope();
  const buttons=groups.map((g,i)=>'<button type="button" data-op-group="'+i+'"'+(group===i?' aria-current="page"':'')+'><span>'+String(i+1).padStart(2,'0')+'</span> '+g.name+'</button>').join('');
  $('op-chapter-links').innerHTML=buttons;const command=$('op-command-chapters');if(command)command.innerHTML=buttons;
  const tools=$('op-view-links');if(tools)tools.innerHTML=groups[group].views.map(i=>'<button type="button" data-op-view="'+i+'"'+(page===i?' aria-pressed="true"':' aria-pressed="false"')+'>'+esc(group===replayGroup&&i===7?'Recorded ladder':i===7?'Option chain':chapters[i])+'</button>').join('');
  if($('mb-chapter')){$('mb-chapter').innerHTML=groups.map((g,i)=>'<option value="'+i+'">'+String(i+1).padStart(2,'0')+' · '+g.name+'</option>').join('');$('mb-chapter').value=String(group);}
  if($('mb-page-count'))$('mb-page-count').textContent=String(group+1).padStart(2,'0')+' / '+groups.length+' · '+groups[group].name;
  if($('mb-nav'))$('mb-nav').innerHTML=buttons;
 };
 const openChapter=(i:number,replay=false)=>{if(!Number.isInteger(i)||i<0||i>=chapters.length)return;
  group=replay?replayGroup:Math.max(0,groups.findIndex(g=>g.views.includes(i)));api.turn(i);draw();};
 const openGroup=(i:number)=>{if(!Number.isInteger(i)||i<0||i>=groups.length)return;group=i;const view=remembered[i];api.turn(view);
  if(view===7)premium?.openLadder({source:i===replayGroup||$('op-one-stop')?.dataset?.osSource==='RECORDED'?'RECORDED':'LIVE',symbol:atmSelected});draw();};
 const mainClick=(e:any)=>{const b=e.target.closest?.('[data-op-group]');if(b)openGroup(Number(b.dataset.opGroup));};
 $('op-chapter-links').onclick=mainClick;if($('op-command-chapters'))$('op-command-chapters').onclick=mainClick;
 if($('mb-nav'))$('mb-nav').onclick=mainClick;
 if($('op-view-links'))$('op-view-links').onclick=(e:any)=>{const b=e.target.closest?.('[data-op-view]'),i=Number(b?.dataset.opView);if(!b||!groups[group].views.includes(i))return;api.turn(i);if(i===7)premium?.openLadder({source:group===replayGroup?'RECORDED':'LIVE'});draw();};
 if($('mb-chapter'))$('mb-chapter').onchange=()=>openGroup(Number($('mb-chapter').value));
 for(const [id,step] of [['mb-prev',-1],['mb-next',1]] as const)$(id).onclick=()=>openGroup((group+step+groups.length)%groups.length);
 window.addEventListener('optionpilot:open-premium-ladder',((e:any)=>{openChapter(7,e.detail?.source==='RECORDED');premium?.openLadder(e.detail);}) as EventListener);

 // Reuse the already-running shared Kite stream: no new source, query, timer or snapshot.
 const oneStatus=$('op-one-status'),oneRows=$('op-one-rows');
 // PR5: only skip identical DOM writes, never source/event processing.
 // Bounded to mounted elements; Kite sampling and observed break handling are untouched.
 const painted=new WeakMap<object,string>();
 const setHtml=(node:any,html:string)=>{if(node&&painted.get(node)!==html){node.innerHTML=html;painted.set(node,html);}};
 const setText=(node:any,value:string)=>{if(node&&node.textContent!==value)node.textContent=value;};
 const setClass=(node:any,value:string)=>{if(node&&node.className!==value)node.className=value;};
 const oneFmt=(v:any,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:d}):'—';
 const oneTime=(v:any)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
 let oneLast=0,oneState='';

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
   setClass(atmPairs,'op-atm-columns');setHtml(atmPairs,'<p>LIVE unavailable · stale and missing premiums withheld</p>');setText(atmStatus,'No connected, fresh expiry snapshot');return;
  }
  const identity=[snap.runtimeId,snap.tradeDate].join('|');if(identity!==atmSession){atmEvents.clear();atmPrevious.clear();atmSession=identity;}
  const group=snap.atmExpiryLadder.find((x:any)=>x.symbol===atmSelected),spot=group?.spot;
  const rows=Array.isArray(group?.rows)?group.rows:[];
  const freshSpot=spot?.state==='LIVE'&&spot.identity?.role==='SPOT'&&spot.identity?.symbol===atmSelected&&
   typeof spot.price==='number'&&Number.isFinite(spot.price)&&spot.price>0&&
   Number.isFinite(Date.parse(spot.observedAt||''))&&serverMs-Date.parse(spot.observedAt)>=-5000&&serverMs-Date.parse(spot.observedAt)<=30000;
  if(!group||!freshSpot){setHtml(atmPairs,'<p>ATM unavailable · waiting for fresh '+esc(atmSelected)+' Spot / inventory</p>');setText(atmStatus,'Spot not fresh or no exact expiry inventory');return;}
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
     const notes=(['PDH','PDC','PDL'] as const).filter(level=>atmLayers.has(level)).map(level=>{
      const value=level==='PDC'?(typeof q?.pdc==='number'&&Number.isFinite(q.pdc)&&q.pdc>0?q.pdc:null):ref[level.toLowerCase() as 'pdh'|'pdl'];
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
     const calendarDte=Math.round((Date.parse(r.expiry+'T00:00:00Z')-Date.parse(snap.tradeDate+'T00:00:00Z'))/86400000);
     const main='<tr><td title="'+esc(r.expiry)+'">'+dd+'/'+mm+'/'+yy.slice(2)+'<small class="os-expiry-dte">'+calendarDte+' calendar days</small></td><td>'+oneFmt(r.strike,0)+'</td><td><strong>'+esc(v.value)+'</strong><small>'+esc(v.time)+'</small>'+notes.join('')+(dayOpenHigh?'<small>DAY O=H ✓</small>':'')+'</td></tr>';
     if(!event)return main;
     const down=event.kind==='PDL',direction=down?'↓':'↑',stamp=oneTime(event.at);
     const ohlc=down&&event.openHigh?'DAY O=H + ':'';
     return main+'<tr class="'+(down?'op-atm-event-down':'op-atm-event-up')+'" data-flash="'+String(event.flash)+'"><td colspan="3">'+direction+' '+ohlc+event.kind+' BREAK · '+stamp+' IST (first observed) · '+side+' '+oneFmt(r.strike,0)+'</td></tr>';
    }).join('')+'</tbody></table></article>';
  setClass(atmPairs,'op-atm-columns'+(sides.length===1?' op-atm-solo':''));
  setHtml(atmPairs,safe.length?sides.map(card).join(''):'<p>No subscribed future expiry with a matched CE/PE strike</p>');
  const missing=(snap.omittedExpiries||[]).filter((x:any)=>typeof x==='string'&&x.startsWith(atmSelected+'|')).length;
  setText(atmStatus,safe.length+' available expiry date(s) · Spot '+oneFmt(spot.price)+' · '+oneTime(d.serverTime)+' IST'+(missing?' · '+missing+' other expiry inventories omitted':''));
 };
 $('op-atm-levels').onclick=(e:any)=>{
  if(e.target.closest?.('[data-atm-open-fib]')){
   api.turn(7);premium?.openLadder({source:'LIVE',symbol:atmSelected,metric:'fib'});
   const target=$('op-premium-workspace');if(target&&typeof target.scrollIntoView==='function')target.scrollIntoView({block:'start',behavior:'auto'});return;
  }
  const level=e.target.closest?.('[data-atm-level]')?.dataset?.atmLevel;
  if(!['PDH','PDC','PDL','FIB'].includes(level))return;
  if(atmLayers.has(level))atmLayers.delete(level);else atmLayers.add(level);
  atmLevelNote.textContent='Combined '+(['PDH','PDC','PDL','FIB'].filter(v=>atmLayers.has(v)).join(' + ')||'No level')+
   ' · FIB shows sourced nearest / observed retest only · not a trading signal';
  $('op-atm-levels').querySelectorAll('[data-atm-level]').forEach((b:any)=>b.setAttribute('aria-pressed',String(atmLayers.has(b.dataset.atmLevel))));
  paintAtm(atmLast);
 };
 $('op-atm-index').onchange=(e:any)=>{if(!['NIFTY','SENSEX','BANKNIFTY'].includes(e.target.value))return;atmSelected=e.target.value;paintAtm(atmLast);oneShot?.select(atmSelected);};
 $('op-atm-modes').onclick=(e:any)=>{const mode=e.target.closest?.('[data-atm-mode]')?.dataset?.atmMode;if(!['BOTH','CE','PE'].includes(mode))return;atmMode=mode;
  $('op-atm-modes').querySelectorAll('[data-atm-mode]').forEach((b:any)=>b.setAttribute('aria-pressed',String(b.dataset.atmMode===mode)));paintAtm(atmLast);
 };

 // PR4: one consistent source validation for summary, ATM and ticker.
 // Presentation only; no added network requests or recurring timers.
 const freshEnvelope=(d:any)=>{
  const snap=d?.snapshot,server=Date.parse(d?.serverTime||''),asOf=Date.parse(snap?.asOf||'');
  const day=Number.isFinite(server)?new Date(server+19800000).toISOString().slice(0,10):null;
  return d?.connected===true&&d?.source==='KITE_WEBSOCKET_FULL'&&
   typeof snap?.runtimeId==='string'&&snap.runtimeId.length>0&&
   Array.isArray(snap.indices)&&Number.isFinite(server)&&server<=Date.now()+5000&&
   Date.now()-server<=5000&&Number.isFinite(asOf)&&server>=asOf&&
   server-asOf<=5000&&snap.tradeDate===day;
 };
 const freshQuote=(d:any,q:any,role:string,symbol?:string,expiry?:string,side?:string,strike?:number)=>{
  if(!freshEnvelope(d))return false;
  const id=q?.identity,server=Date.parse(d.serverTime);
  const observed=Date.parse(q?.observedAt||''),received=Date.parse(q?.receivedAt||'');
  const day=(at:number)=>Number.isFinite(at)?new Date(at+19800000).toISOString().slice(0,10):null;
  return q?.state==='LIVE'&&id?.role===role&&(!symbol||id.symbol===symbol)&&
   (!expiry||id.expiry===expiry)&&(!side||id.side===side)&&
   (strike===undefined||id.strike===strike)&&typeof q.price==='number'&&
   Number.isFinite(q.price)&&q.price>0&&day(observed)===d.snapshot.tradeDate&&
   day(received)===d.snapshot.tradeDate&&server-observed>=-5000&&
   server-observed<=30000&&server-received>=0&&server-received<=30000;
 };
 const oneShot=typeof installOneShotLiveCard==='function'?installOneShotLiveCard({
  getState:api.getState,getModels:api.getModels,setDate:api.setDate,derivePremium:typeof derivePremiumWorkspace==='function'?derivePremiumWorkspace:undefined,validEnvelope:freshEnvelope,validQuote:freshQuote,
  derivePcr:deriveLiveThreeIndexPcr,deriveRecordedPcr:typeof deriveRecordedThreeIndexPcr==='function'?deriveRecordedThreeIndexPcr:undefined,chooseIndex:(symbol:string)=>{api.chooseResearchIndex?.(symbol);atmSelected=symbol;$('op-atm-index').value=symbol;paintAtm(atmLast);}
 }):null;
 if(typeof installScreenOverview==='function')installScreenOverview();
 // PR3: reuse the strict three-index full-PCR verifier; render from the existing stream only.
 const paintOne=(d:any)=>{
  if(!oneStatus||!oneRows)return;
  const connected=freshEnvelope(d);oneState=String(d?.connectionState||'');
  paintAtm(connected?d:null); // stale source revokes ATM and summary together
  const snap=d?.snapshot;
  if(!connected){oneShot?.update(d);const closed=oneState==='MARKET_CLOSED';setText(oneStatus,closed?'MARKET CLOSED · Open recorded ladder for saved observations':'LIVE unavailable · '+String(d?.connectionState||'stale source'));
   setHtml(oneRows,closed?'<tr><td colspan="8">Market closed · saved observations are available through Open recorded ladder.</td></tr>':'<tr><td colspan="8">No fresh verified Kite snapshot · values withheld</td></tr>');oneLast=0;return;}
  if(Date.now()-oneLast<500)return;oneLast=Date.now();oneShot?.update(d);
  const finite=(v:any)=>typeof v==='number'&&Number.isFinite(v);
  const verified=(q:any,role:string,symbol?:string,expiry?:string,side?:string,strike?:number)=>
   freshQuote(d,q,role,symbol,expiry,side,strike);
  const priceCell=(q:any,role:string,symbol:string)=>{
   const ok=verified(q,role,symbol);
   return '<td data-metric="'+(role==='SPOT'?'Spot':'Future')+'">'+(ok?oneFmt(q.price):'—')+'<small>'+(ok?'Kite '+oneTime(q.observedAt)+' IST':'Not verified')+'</small></td>';
  };
  const strictPcr=deriveLiveThreeIndexPcr(d,null,Date.now());
  // PCR numbers and wall strikes are from a *complete, validated* expiry snapshot only.
  const pcrReason=(a:any)=>{
   const q=a?.pcrSnapshot,c=q?.coverage;
   if(!q)return 'Full OI snapshot pending';
   if(q.state==='STALE')return 'OI snapshot expired';
   if(q.fetchState==='RATE_LIMITED')return 'Kite rate limited';
   if(q.fetchState==='REQUEST_REJECTED')return 'Kite quote rejected';
   if(q.fetchState==='SESSION_REQUIRED')return 'Kite login required';
   if(q.fetchState==='IDENTITY_TOO_LONG')return 'Kite symbol too long';
   if(q.fetchState==='UPSTREAM_UNAVAILABLE')return 'Kite quote unavailable';
   if(c&&Number.isInteger(c.expected)&&c.expected>0&&Number.isInteger(c.freshOi))
    return 'OI '+c.freshOi+'/'+c.expected+' · M:'+(c.missing||0)+' S:'+(c.stale||0)+' I:'+(c.invalid||0)+
     (q.checkedAt?' · '+oneTime(q.checkedAt)+' IST':'')+(c.complete?' · verifying':'');
   return 'Full OI coverage unverified';
  };
  const summaryHtml=['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>{
   const matches=snap.indices.filter((x:any)=>x?.symbol===symbol),a=matches.length===1?matches[0]:null;
   if(!a)return '<tr><th scope="row">'+symbol+'</th><td colspan="7">Exact index unavailable</td></tr>';
   const p=strictPcr.rows.find((x:any)=>x.symbol===symbol&&x.expiry===a.expiry);
   const full=p?.current&&finite(p.value)?p:null;
   const leg=(q:any,side:'CE'|'PE')=>{
    const strike=q?.identity?.strike,ok=Number.isFinite(strike)&&
     verified(q,'OPTION',symbol,a.expiry,side,strike)&&a.strike===strike;
    return '<td data-metric="'+side+' ₹">'+(ok?oneFmt(q.price):'—')+'<small>'+side+' '+(ok?oneFmt(strike,0):'—')+'</small>'+
     '<small>'+(ok?'Kite '+oneTime(q.observedAt)+' IST':'Not verified')+'</small></td>';
   };
   return '<tr><th scope="row">'+symbol+'<small>'+esc(a.expiry||'Expiry unavailable')+
    (symbol==='BANKNIFTY'?' · Monthly':'')+'</small></th>'+
    priceCell(a.spot,'SPOT',symbol)+priceCell(a.future,'FUTURE',symbol)+leg(a.ce,'CE')+leg(a.pe,'PE')+
    '<td data-metric="Full PCR">'+(full?oneFmt(full.value,4):'—')+'<small>'+(full?'FULL · OI '+full.current.expected+
      '/'+full.current.expected+' · '+oneTime(new Date(full.current.checked).toISOString())+' IST':esc(pcrReason(a)))+'</small></td>'+
    '<td data-metric="CE wall">'+(full?oneFmt(d.pcrDisplay?.[symbol]?.callWall?.strike,0):'—')+'</td>'+
    '<td data-metric="PE wall">'+(full?oneFmt(d.pcrDisplay?.[symbol]?.putWall?.strike,0):'—')+'</td></tr>';
  }).join('');
  setHtml(oneRows,summaryHtml);
  setText(oneStatus,'Verified Kite · '+oneTime(d.serverTime)+' IST · VIX '+
   (verified(snap.vix,'VIX')?oneFmt(snap.vix.price):'—')+' · — means unavailable');
 };
 const commodityCard=$('op-commodities'),commodityButton=$('op-open-commodities');
 if(commodityButton)commodityButton.onclick=()=>{if(commodityCard){commodityCard.open=!commodityCard.open;commodityButton.setAttribute('aria-expanded',String(commodityCard.open));if(commodityCard.open)commodityCard.scrollIntoView?.({block:'start',behavior:'auto'});}};
 if(commodityCard)commodityCard.ontoggle=()=>commodityButton?.setAttribute('aria-expanded',String(commodityCard.open));
 if(commodityCard)commodityCard.onclick=(e:any)=>{const link=e.target.closest?.('a[href^="#op-commodity-"]');const panel=link&&$(link.getAttribute('href').slice(1));if(panel)panel.open=true;};
 const oneActions=$('op-one-actions');
 if(oneActions)oneActions.onclick=(e:any)=>{
  const action=e.target.closest?.('[data-op-one]')?.dataset?.opOne;
  let target:any=null;
  if(action==='LIVE'){$('mb-tools').open=true;$('op-feed-detail').open=true;target=$('op-feed-detail');}
  else if(action==='LADDER'){openChapter(7);premium?.openLadder({source:'LIVE',symbol:atmSelected});target=$('op-premium-workspace');}
  else if(action==='RECORDED'){openChapter(7,true);premium?.openLadder({source:'RECORDED',symbol:atmSelected});target=$('op-premium-workspace');}
  else if(action==='MULTIDAY'){openChapter(7,true);premium?.openLadder({source:'RECORDED',symbol:atmSelected});target=$('mi-shell');if(target)target.open=true;}
  else if(action==='RAG'){$('mb-tools').open=true;target=$('rag-evidence-card');if(target)target.open=true;}
  if(target&&typeof target.scrollIntoView==='function')target.scrollIntoView({block:'start',behavior:'auto'});
 };
 let lastTicker=0,lastTickerLive=false;
 window.addEventListener('optionpilot:live-context',((e:any)=>{
  const d=e.detail,on=freshEnvelope(d);paintOne(d);
  setText($('op-workspace-feed'),on?'● LIVE · Kite':d?.connectionState==='MARKET_CLOSED'?'MARKET CLOSED':'OFFLINE / STALE');
  $('op-workspace-feed').classList.toggle('op-feed-on',on);
  if(Date.now()-lastTicker<250&&on&&lastTickerLive)return;lastTicker=Date.now();lastTickerLive=on;
  const fmt=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
  const quotes=['NIFTY','SENSEX','BANKNIFTY'].map(symbol=>{
   const matches=on?d.snapshot.indices.filter((a:any)=>a.symbol===symbol):[];
   return {label:symbol,role:'SPOT',symbol,q:matches.length===1?matches[0].spot:null};
  });
  quotes.push({label:'INDIA VIX',role:'VIX',symbol:'',q:on?d.snapshot.vix:null});
  const tickerHtml=quotes.map((r:any)=>{
   const valid=on&&freshQuote(d,r.q,r.role,r.symbol||undefined),q=r.q;
   return '<div class="op-ticker"><span>'+esc(r.label)+'</span><strong>'+fmt(valid?q.price:null)+
    '</strong><small class="'+(valid&&q.changePct>0?'op-positive':valid&&q.changePct<0?'op-negative':'')+'">'+
    (valid&&typeof q.changePct==='number'&&Number.isFinite(q.changePct)?fmt(q.changePct)+'%':'—')+
    ' · '+(valid?oneTime(q.observedAt):'withheld')+'</small></div>';
  }).join('');
  setHtml($('op-workspace-ticker'),tickerHtml);
 }) as EventListener);
 return {render(){if(active!==api.page())draw();researchScope();oneShot?.refresh();const on=api.page()===7;premium?.setVisible(on);if($('op-premium-workspace'))$('mb-page').hidden=on;premium?.refreshRecorded();}};
}

