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

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OptionPilot Pro · Business Dashboard</title><style>
  :root{color-scheme:dark;--bg:#050914;--p:#0b1526;--l:#1d3556;--t:#eef7ff;--m:#8fa4c3;--g:#63f5b5;--c:#4de6ff;--r:#ff7f92;--a:#ffd166}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font-family:Inter,system-ui,sans-serif}.wrap{max-width:980px;margin:auto;padding:14px}
  .hero,.card,.horizon{background:var(--p);border:1px solid var(--l);border-radius:18px;padding:15px}.hero{margin-bottom:10px}.ey{font-size:10px;color:var(--c);font-weight:900;letter-spacing:.12em}.title{font-size:25px;font-weight:900;margin-top:5px}.sub{font-size:12px;color:var(--m);margin-top:6px}
  .candidate{font-size:18px;font-weight:900;margin-top:10px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.hz{font-size:10px;color:var(--m);font-weight:900}.action{font-size:17px;font-weight:900;margin:7px 0 12px}.buy{color:var(--g)}.sell{color:var(--a)}.wait{color:var(--m)}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair div{background:#08111f;border-radius:12px;padding:10px}.pair span{display:block;font-size:9px;color:var(--m);font-weight:900}.pair b{display:block;margin-top:5px;font-size:15px;letter-spacing:1px}
  .section{margin-top:10px}.row{display:flex;gap:8px;flex-wrap:wrap}.pill{font-size:9px;border:1px solid var(--l);border-radius:999px;padding:5px 8px;color:var(--m)}.meta{font-size:11px;color:var(--m);line-height:1.5}
  @media(max-width:720px){.grid{grid-template-columns:1fr}.title{font-size:21px}}
  </style></head><body><main class="wrap">
    <section class="hero"><div class="ey">BUSINESS DASHBOARD V1 · ${esc(model.symbol)}</div><div class="title">${esc(model.headline)}</div><div class="candidate">${candidate}</div><div class="sub">Buyer/Seller view · Intraday / Multiday / Expiry · same canonical buyer candidate as Telegram.</div></section>
    <section class="grid">${horizons}</section>
    <section class="card section"><div class="ey">LIVE SELECTOR</div><div class="meta">SELECT ${model.selector.selectCount} · BLOCK ${model.selector.blockCount}</div><div class="row" style="margin-top:8px">${reasons || '<span class="pill">NO BLOCK REASONS</span>'}</div></section>
    <section class="card section"><div class="meta">READ ONLY · no candidate re-ranking · no Telegram mutation · no execution/order authority.</div></section>
  </main></body></html>`;
}
