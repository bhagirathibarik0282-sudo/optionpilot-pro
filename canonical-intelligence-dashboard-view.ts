import type { CanonicalIntelligenceDashboardModel } from "./canonical-intelligence-dashboard-model.ts";

function esc(value: unknown): string {
  return String(value ?? "—").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function renderCanonicalIntelligenceDashboardHtml(model: CanonicalIntelligenceDashboardModel): string {
  const status = model.ready ? "READY" : "UNAVAILABLE";
  const weighted = model.weightedConstituentBreadthReady ? pct(model.weightedConstituentBreadthPct) : "NOT READY";
  const windows = Object.entries(model.historicalWindowReady).map(([k, v]) => `<span class="pill ${v ? "ok" : "bad"}">${esc(k.toUpperCase())} ${v ? "✓" : "✕"}</span>`).join("");
  const blockers = model.blockers.length ? model.blockers.map((x) => `<span class="pill bad">${esc(x)}</span>`).join("") : `<span class="pill ok">NO BLOCKERS</span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OptionPilot Pro · Intelligence</title><style>
  :root{color-scheme:dark;--bg:#050914;--p:#0b1526;--l:#1d3556;--t:#eef7ff;--m:#8fa4c3;--g:#63f5b5;--c:#4de6ff;--r:#ff7f92;--a:#ffd166}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,rgba(77,230,255,.12),transparent 32%),var(--bg);color:var(--t);font-family:Inter,system-ui,sans-serif}.wrap{max-width:1180px;margin:auto;padding:16px}.hero,.card{background:var(--p);border:1px solid var(--l);border-radius:18px;padding:16px}.hero{margin-bottom:12px}.ey{font-size:10px;color:var(--c);font-weight:900;letter-spacing:.14em}.title{font-size:28px;font-weight:900;margin-top:6px}.sub{color:var(--m);font-size:12px;margin-top:7px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.label{font-size:9px;color:var(--m);font-weight:800;letter-spacing:.08em}.value{font-size:18px;font-weight:900;margin-top:6px}.oktxt{color:var(--g)}.warn{color:var(--a)}.section{margin-top:12px}.pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.pill{font-size:9px;font-weight:900;padding:5px 8px;border-radius:999px;border:1px solid var(--l)}.pill.ok{color:var(--g);border-color:rgba(99,245,181,.35)}.pill.bad{color:var(--r);border-color:rgba(255,127,146,.35)}.safety{margin-top:12px;color:var(--m);font-size:10px;line-height:1.5}@media(max-width:720px){.grid{grid-template-columns:1fr 1fr}.title{font-size:22px}} </style></head><body><main class="wrap">
  <section class="hero"><div class="ey">CANONICAL MARKET DNA · ${esc(status)}</div><div class="title">OptionPilot Intelligence</div><div class="sub">Same canonical live + recovered historical context used by the backend. No independent dashboard recomputation.</div></section>
  <section class="grid">
    <div class="card"><div class="label">REGIME</div><div class="value ${model.ready ? "oktxt" : "warn"}">${esc(model.regime)}</div></div>
    <div class="card"><div class="label">ROTATION</div><div class="value">${esc(model.rotationState)}</div></div>
    <div class="card"><div class="label">DIVERGENCE</div><div class="value">${esc(model.divergenceState)}</div></div>
    <div class="card"><div class="label">7-INDEX PARTICIPATION</div><div class="value">${pct(model.participationBreadthPct)}</div></div>
    <div class="card"><div class="label">LARGE-CAP CONCENTRATION</div><div class="value">${pct(model.largeCapConcentrationSpreadPct)}</div></div>
    <div class="card"><div class="label">SIZE ROTATION</div><div class="value">${pct(model.sizeRotationSpreadPct)}</div></div>
    <div class="card"><div class="label">TRUE WEIGHTED BREADTH</div><div class="value ${model.weightedConstituentBreadthReady ? "oktxt" : "warn"}">${weighted}</div></div>
    <div class="card"><div class="label">HISTORY</div><div class="value">${esc(model.historicalObservationFloor)} rows</div><div class="sub">latest ${esc(model.latestHistoricalTradeDate)}</div></div>
  </section>
  <section class="card section"><div class="label">HISTORICAL WINDOWS</div><div class="pills">${windows}</div></section>
  <section class="card section"><div class="label">READINESS / BLOCKERS</div><div class="pills">${blockers}</div><div class="safety">7/7 coverage: ${model.exactSevenCoverage ? "YES" : "NO"} · archive beyond 320: ${model.archiveBeyond320Ready ? "YES" : "NO"} · 10-year window: ${model.tenYearWindowReady ? "YES" : "NO"}. Context-only; no direction, verdict, candidate, Telegram or execution authority.</div></section>
  </main></body></html>`;
}
