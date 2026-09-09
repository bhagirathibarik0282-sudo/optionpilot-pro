import type { BusinessDashboardV1Model } from "./business-dashboard-v1.js";

function esc(value: unknown): string {
  return String(value ?? "—").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
function stars(n: number): string {
  const x = Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
  return "★".repeat(x) + "☆".repeat(5 - x);
}

export function renderBusinessDashboardV1Html(model: BusinessDashboardV1Model): string {
  const candidate = model.candidate
    ? `${esc(model.candidate.symbol)} ${esc(model.candidate.optionSide)} ${esc(model.candidate.strike)} · ${esc(model.candidate.expiryDate)} · ₹${esc(model.candidate.premiumLtp)}`
    : "No verified buyer candidate";
  const horizons = model.horizons.map((h) => `
    <article class="horizon">
      <div class="hz">${esc(h.horizon)}</div>
      <div class="action ${h.action === "BUYER_EDGE" ? "buy" : h.action === "SELLER_EDGE" ? "sell" : "wait"}">${esc(h.headline)}</div>
      <div class="pair"><div><span>BUYER</span><b>${stars(h.buyerStars)}</b></div><div><span>SELLER</span><b>${stars(h.sellerStars)}</b></div></div>
    </article>`).join("");
  const reasons = model.selector.reasonCodes.slice(0,6).map((x)=>`<span class="pill">${esc(x.replaceAll("_"," "))}</span>`).join("");
  const intelligence = model.intelligence.map((x)=>`<div class="intel" data-intel-key="${esc(x.key)}"><span>${esc(x.label)}</span><b class="wait" data-state>${esc(x.state)}</b><small data-detail>${esc(x.detail)}</small></div>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OptionPilot Pro · Business Dashboard</title><style>
  :root{color-scheme:dark;--bg:#050914;--p:#0b1526;--l:#1d3556;--t:#eef7ff;--m:#8fa4c3;--g:#63f5b5;--c:#4de6ff;--r:#ff7f92;--a:#ffd166}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font-family:Inter,system-ui,sans-serif}.wrap{max-width:980px;margin:auto;padding:14px}
  .hero,.card,.horizon{background:var(--p);border:1px solid var(--l);border-radius:18px;padding:15px}.hero{margin-bottom:10px}.ey{font-size:10px;color:var(--c);font-weight:900;letter-spacing:.12em}.title{font-size:25px;font-weight:900;margin-top:5px}.sub{font-size:12px;color:var(--m);margin-top:6px}
  .candidate{font-size:18px;font-weight:900;margin-top:10px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.hz{font-size:10px;color:var(--m);font-weight:900}.action{font-size:17px;font-weight:900;margin:7px 0 12px}.buy{color:var(--g)!important}.sell{color:var(--a)!important}.wait{color:var(--m)!important}.bad{color:var(--r)!important}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair div{background:#08111f;border-radius:12px;padding:10px}.pair span{display:block;font-size:9px;color:var(--m);font-weight:900}.pair b{display:block;margin-top:5px;font-size:15px;letter-spacing:1px}
  .section{margin-top:10px}.row{display:flex;gap:8px;flex-wrap:wrap}.intelgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.intel{background:#08111f;border-radius:12px;padding:10px}.intel span,.intel b,.intel small{display:block}.intel span{font-size:10px;font-weight:900}.intel b{font-size:10px;margin-top:5px}.intel small{font-size:10px;color:var(--m);margin-top:5px;line-height:1.4}.pill{font-size:9px;border:1px solid var(--l);border-radius:999px;padding:5px 8px;color:var(--m)}.meta{font-size:11px;color:var(--m);line-height:1.5}.truth{margin-top:8px;font-size:10px;color:var(--m)}
  @media(max-width:720px){.grid,.intelgrid{grid-template-columns:1fr}.title{font-size:21px}}
  </style></head><body><main class="wrap">
    <section class="hero"><div class="ey">BUSINESS DASHBOARD V1 · ${esc(model.symbol)}</div><div class="title">${esc(model.headline)}</div><div class="candidate">${candidate}</div><div class="sub">Buyer/Seller · Intraday / Multiday / Expiry · same canonical buyer candidate as Telegram.</div><div class="truth" id="truth-status">Refreshing exposed live truth…</div></section>
    <section class="grid">${horizons}</section>
    <section class="card section"><div class="ey">BUSINESS INTELLIGENCE · LIVE VALUES WHEN EXPOSED</div><div class="intelgrid">${intelligence}<div class="intel" data-intel-key="HISTORICAL_EDGE"><span>Historical Edge</span><b class="wait" data-state>WAIT</b><small data-detail>Loading historical evidence coverage</small></div></div></section>
    <section class="card section"><div class="ey">LIVE SELECTOR</div><div class="meta">SELECT ${model.selector.selectCount} · BLOCK ${model.selector.blockCount}</div><div class="row" style="margin-top:8px">${reasons || '<span class="pill">NO BLOCK REASONS</span>'}</div></section>
    <section class="card section"><div class="meta">READ ONLY · no candidate re-ranking · no Telegram mutation · no execution/order authority. A card is never marked LIVE from a label alone.</div></section>
  </main>
  <script>
  (function(){
    var symbol=${JSON.stringify(model.symbol)};
    function card(key){return document.querySelector('[data-intel-key="'+key+'"]');}
    function setCard(key,state,detail,cls){var el=card(key);if(!el)return;var s=el.querySelector('[data-state]');var d=el.querySelector('[data-detail]');s.textContent=state;s.className=cls||'wait';d.textContent=detail;}
    function num(v,d){return Number.isFinite(Number(v))?Number(v).toFixed(d==null?2:d):'—';}
    function notWired(key,label){setCard(key,'NOT WIRED',label+' source is not exposed to Business Dashboard V1; no value fabricated.','bad');}
    fetch('/api/research/h1-live-selector-decisions',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('HTTP_'+r.status);return r.json();}).then(function(x){
      var metrics=(x.responseMetrics||[]).filter(function(r){return r.identity&&r.identity.symbol===symbol;});
      var decisions=(x.decisions||[]).filter(function(r){return r.symbol===symbol;});
      metrics.sort(function(a,b){return (a.identity.dte||999)-(b.identity.dte||999);});
      if(metrics.length){
        var m=metrics[0];
        setCard('PREMIUM_REALITY','LIVE',m.identity.side+' '+m.identity.expiryDate+' ₹'+num(m.identity.premiumLtp,2)+' · move '+num(m.metrics.premiumMovePct,2)+'% · ΔΔ '+num(m.metrics.absoluteDeltaChange,4)+' · γ '+num(m.metrics.currentGamma,6),'buy');
        var expiries=[];metrics.forEach(function(r){var k=r.identity.expiryDate+' DTE '+r.identity.dte;if(expiries.indexOf(k)<0)expiries.push(k);});
        setCard('MULTI_DTE','LIVE',expiries.slice(0,4).join(' · '),'buy');
      } else {
        setCard('PREMIUM_REALITY','WAIT','No live exact premium metric exposed for '+symbol,'wait');
        setCard('MULTI_DTE','WAIT','No live exact multi-DTE metric exposed for '+symbol,'wait');
      }
      if(decisions.length){
        var liquid=decisions.filter(function(d){return d.gates&&d.gates.liquidityOk===true;}).length;
        var spread=decisions.filter(function(d){return d.gates&&d.gates.spreadOk===true;}).length;
        setCard('LIQUIDITY','LIVE',liquid+'/'+decisions.length+' liquidity pass · '+spread+'/'+decisions.length+' spread pass','buy');
      } else setCard('LIQUIDITY','WAIT','No selector gate decisions exposed','wait');
      notWired('SMC_CANDLE','SMC/Candle interpretation');
      notWired('FUTURES','Futures value/confirmation');
      notWired('OI_PCR_WALLS','OI/PCR/wall migration');
      notWired('IV_SKEW','IV/skew');
      notWired('HEAVYWEIGHTS_SECTORS','Heavyweight/sector live detail');
      document.getElementById('truth-status').textContent='Live selector truth refreshed · '+metrics.length+' exact contract metrics · '+decisions.length+' decisions';
    }).catch(function(e){document.getElementById('truth-status').textContent='Live selector truth unavailable · '+e.message;});

    fetch('/api/research/broad-market-size/dashboard',{cache:'no-store'}).then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});}).then(function(v){var x=v.body||{};
      if(v.ok&&x.ready){
        setCard('MARKET_DNA','LIVE',(x.regime||'—')+' · rotation '+(x.rotationState||'—')+' · breadth '+num(x.participationBreadthPct,1)+'% · weighted '+num(x.weightedConstituentBreadthPct,1)+'%','buy');
        var w=x.historicalWindowReady||{};var ready=Object.keys(w).filter(function(k){return w[k]===true;});
        setCard('HISTORICAL_EDGE','CONTEXT', 'Latest '+(x.latestHistoricalTradeDate||'—')+' · ready windows '+(ready.length?ready.join(', '):'none')+' · coverage only, not a claimed trade edge','wait');
      } else {
        setCard('MARKET_DNA','WAIT','Market DNA context not ready','wait');
        setCard('HISTORICAL_EDGE','WAIT','Historical context not ready; no edge claimed','wait');
      }
    }).catch(function(){setCard('MARKET_DNA','WAIT','Market DNA context unavailable','wait');setCard('HISTORICAL_EDGE','WAIT','Historical context unavailable','wait');});
  })();
  </script></body></html>`;
}
