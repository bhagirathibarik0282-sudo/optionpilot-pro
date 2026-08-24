import type { ResearchDashboardModel } from "./research-dashboard-model.js";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function num(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function tone(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "muted";
  return value > 0 ? "pos" : value < 0 ? "neg" : "muted";
}

function qualityTone(value: string | null | undefined): string {
  const v = String(value ?? "").toUpperCase();
  if (v.includes("GOOD") || v.includes("READY") || v.includes("COMPLETE")) return "ok";
  if (v.includes("WARN") || v.includes("PARTIAL") || v.includes("STALE")) return "warn";
  if (v.includes("BAD") || v.includes("INVALID") || v.includes("MISSING")) return "bad";
  return "neutral";
}

export function renderResearchDashboardHtml(model: ResearchDashboardModel): string {
  const regime = model.regime;
  const interpretation =
    regime.state === "BROAD_RISK_ON" && regime.transition === "DECELERATING"
      ? "Broad participation is positive, but momentum is decelerating."
      : regime.evidence?.[0] ?? "Research context available.";

  const best20 = [...model.rows]
    .filter((r) => Number.isFinite(r.return20d))
    .sort((a, b) => (b.return20d ?? -Infinity) - (a.return20d ?? -Infinity))[0];

  const best60 = [...model.rows]
    .filter((r) => Number.isFinite(r.return60d))
    .sort((a, b) => (b.return60d ?? -Infinity) - (a.return60d ?? -Infinity))[0];

  const positive20 = model.rows.filter((r) => (r.return20d ?? 0) > 0).length;
  const positive60 = model.rows.filter((r) => (r.return60d ?? 0) > 0).length;
  const warningCount = model.warnings.length;

  const indexCards = model.rows.map((r) => `
    <article class="index-card">
      <div class="index-top">
        <div>
          <div class="index-name">${esc(r.indexName ?? r.indexCode)}</div>
          <div class="index-code">${esc(r.indexCode)}</div>
        </div>
        <span class="qdot ${qualityTone(r.dataQuality)}" title="${esc(r.dataQuality)}"></span>
      </div>
      <div class="close">${num(r.close)}</div>
      <div class="mini-grid">
        <div><span>1D</span><b class="${tone(r.return1d)}">${pct(r.return1d)}</b></div>
        <div><span>5D</span><b class="${tone(r.return5d)}">${pct(r.return5d)}</b></div>
        <div><span>20D</span><b class="${tone(r.return20d)}">${pct(r.return20d)}</b></div>
        <div><span>60D</span><b class="${tone(r.return60d)}">${pct(r.return60d)}</b></div>
      </div>
      <div class="rs-row"><span>RS vs NIFTY · 20D</span><b class="${tone(r.rsVsNifty50_20d)}">${pct(r.rsVsNifty50_20d)}</b></div>
    </article>`).join("");

  const rows = model.rows.map((r) => `
    <tr>
      <td>
        <div class="table-name">${esc(r.indexName ?? r.indexCode)}</div>
        <div class="table-sub">${esc(r.indexCode)} · ${esc(r.tradeDate ?? "—")}</div>
      </td>
      <td class="${tone(r.return1d)}">${pct(r.return1d)}</td>
      <td class="${tone(r.return5d)}">${pct(r.return5d)}</td>
      <td class="${tone(r.return20d)}">${pct(r.return20d)}</td>
      <td class="${tone(r.return60d)}">${pct(r.return60d)}</td>
      <td class="${tone(r.return120d)}">${pct(r.return120d)}</td>
      <td class="${tone(r.return252d)}">${pct(r.return252d)}</td>
      <td class="${tone(r.rsVsNifty50_20d)}">${pct(r.rsVsNifty50_20d)}</td>
      <td class="${tone(r.rsVsNifty50_60d)}">${pct(r.rsVsNifty50_60d)}</td>
      <td><span class="quality-pill ${qualityTone(r.dataQuality)}">${esc(r.dataQuality)}</span></td>
    </tr>`).join("");

  const warnings = model.warnings.length
    ? model.warnings.slice(0, 8).map((w) => `<span class="warning-chip">${esc(w)}</span>`).join("")
    : `<span class="warning-chip clean">No active research-data warnings</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#050914">
<title>OptionPilot Pro · Intelligence Layer</title>
<style>
  :root{
    color-scheme:dark;
    --bg:#050914;--panel:#0a1120;--panel2:#0c1628;--line:#1c2c49;
    --text:#eef5ff;--muted:#8295b6;--cyan:#4de6ff;--green:#63f5b5;
    --red:#ff7f92;--amber:#ffd166;--violet:#bc9cff;
  }
  *{box-sizing:border-box}
  html{background:var(--bg)}
  body{margin:0;min-height:100vh;background:
    radial-gradient(circle at 12% -10%,rgba(77,230,255,.12),transparent 30%),
    radial-gradient(circle at 92% 2%,rgba(188,156,255,.10),transparent 28%),
    var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
  .shell{max-width:1360px;margin:auto;padding:18px}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.04em}
  .logo{width:10px;height:10px;border-radius:50%;background:var(--cyan);box-shadow:0 0 18px var(--cyan)}
  .mode{font-size:10px;font-weight:900;letter-spacing:.12em;color:var(--cyan);border:1px solid rgba(77,230,255,.35);background:rgba(77,230,255,.08);padding:6px 9px;border-radius:999px}
  .refresh{appearance:none;border:1px solid var(--line);background:#0d1729;color:var(--text);padding:8px 11px;border-radius:10px;font-weight:700;cursor:pointer}
  .refresh:hover{border-color:#34557f}
  .hero{position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(13,25,45,.98),rgba(7,15,29,.98));border:1px solid #213653;border-radius:22px;padding:20px;box-shadow:0 18px 55px rgba(0,0,0,.34)}
  .hero:after{content:"";position:absolute;right:-60px;top:-70px;width:240px;height:240px;border-radius:50%;background:rgba(77,230,255,.055);filter:blur(2px)}
  .hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.35fr .65fr;gap:18px}
  .eyebrow{font-size:11px;color:var(--muted);letter-spacing:.16em;font-weight:800;text-transform:uppercase;margin-bottom:7px}
  h1{margin:0;font-size:clamp(22px,3vw,36px);line-height:1.06}
  .subtitle{margin-top:10px;color:#9fb0ca;font-size:13px;max-width:720px;line-height:1.55}
  .hero-badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}
  .badge{font-size:11px;font-weight:900;letter-spacing:.05em;padding:7px 10px;border-radius:999px;border:1px solid var(--line);background:#0b1627}
  .badge.risk{color:var(--green);border-color:rgba(99,245,181,.35)}
  .badge.transition{color:var(--amber);border-color:rgba(255,209,102,.34)}
  .badge.quality{color:var(--violet);border-color:rgba(188,156,255,.34)}
  .regime-box{align-self:stretch;border:1px solid #203653;background:rgba(5,12,24,.7);border-radius:16px;padding:16px;display:flex;flex-direction:column;justify-content:center}
  .regime-label{font-size:10px;color:var(--muted);font-weight:800;letter-spacing:.12em}
  .regime-state{margin-top:7px;font-size:21px;font-weight:900;color:var(--green);word-break:break-word}
  .regime-strength{margin-top:5px;color:#a9b8cf;font-size:12px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px}
  .stat-label{font-size:10px;color:var(--muted);font-weight:800;letter-spacing:.08em;text-transform:uppercase}
  .stat-value{margin-top:7px;font-size:19px;font-weight:900}
  .stat-note{margin-top:4px;font-size:11px;color:#8295b6}
  .section{margin-top:14px;background:rgba(9,17,32,.88);border:1px solid var(--line);border-radius:19px;padding:16px}
  .section-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:12px}
  .section-title{font-weight:900;font-size:14px;letter-spacing:.03em}
  .section-sub{font-size:11px;color:var(--muted)}
  .cards{display:grid;grid-template-columns:repeat(7,minmax(150px,1fr));gap:9px;overflow:auto;padding-bottom:3px}
  .index-card{min-width:150px;background:linear-gradient(180deg,#0d182a,#091321);border:1px solid #1c304d;border-radius:15px;padding:12px}
  .index-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
  .index-name{font-size:12px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:125px}
  .index-code{font-size:9px;color:var(--muted);margin-top:3px}
  .qdot{width:8px;height:8px;border-radius:50%;background:#6f7e93;box-shadow:0 0 10px currentColor}
  .qdot.ok{background:var(--green)}.qdot.warn{background:var(--amber)}.qdot.bad{background:var(--red)}
  .close{font-size:18px;font-weight:900;margin:11px 0 8px}
  .mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .mini-grid div{background:#08111f;border-radius:8px;padding:7px}
  .mini-grid span,.rs-row span{display:block;font-size:8px;color:var(--muted);font-weight:800;letter-spacing:.05em}
  .mini-grid b,.rs-row b{display:block;font-size:11px;margin-top:3px}
  .rs-row{display:flex;justify-content:space-between;align-items:end;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #172842}
  .rs-row span{max-width:82px}.rs-row b{margin:0;white-space:nowrap}
  .table-wrap{overflow:auto;border:1px solid #182943;border-radius:14px}
  table{width:100%;border-collapse:collapse;min-width:1040px}
  th,td{padding:11px 12px;border-bottom:1px solid #15243a;text-align:right;font-size:12px;white-space:nowrap}
  th{position:sticky;top:0;background:#0f1b2e;color:#8295b6;font-size:10px;letter-spacing:.05em;z-index:2}
  th:first-child,td:first-child{text-align:left}
  .table-name{font-weight:850;color:#f3f7ff}.table-sub{font-size:9px;color:#7084a4;margin-top:3px}
  .pos{color:var(--green)}.neg{color:var(--red)}.muted{color:#9aa9bf}
  .quality-pill{display:inline-block;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:900;border:1px solid #33435d;color:#aab7ca}
  .quality-pill.ok{color:var(--green);border-color:rgba(99,245,181,.3)}
  .quality-pill.warn{color:var(--amber);border-color:rgba(255,209,102,.3)}
  .quality-pill.bad{color:var(--red);border-color:rgba(255,127,146,.3)}
  .insight{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}
  .insight-card{background:#08111e;border:1px solid #1a2a43;border-radius:14px;padding:14px}
  .insight-main{font-size:14px;font-weight:850;line-height:1.45}
  .evidence{margin-top:8px;color:#8fa2bf;font-size:11px;line-height:1.5}
  .warnings{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
  .warning-chip{font-size:9px;font-weight:800;color:var(--amber);border:1px solid rgba(255,209,102,.25);background:rgba(255,209,102,.05);border-radius:999px;padding:5px 7px}
  .warning-chip.clean{color:var(--green);border-color:rgba(99,245,181,.25);background:rgba(99,245,181,.05)}
  .safety{margin-top:14px;border:1px solid rgba(77,230,255,.18);background:rgba(77,230,255,.04);border-radius:13px;padding:11px 13px;color:#8fa7c7;font-size:10px;line-height:1.5}
  .safety b{color:var(--cyan)}
  @media(max-width:900px){.hero-grid,.insight{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.cards{grid-template-columns:repeat(7,160px)}}
  @media(max-width:560px){.shell{padding:10px}.topbar{margin-bottom:9px}.hero{padding:15px;border-radius:17px}.stats{gap:7px}.stat{padding:11px}.stat-value{font-size:16px}.section{padding:11px;border-radius:15px}.cards{grid-template-columns:repeat(7,154px)}.refresh{padding:7px 9px}}
</style>
</head>
<body>
<div class="shell">
  <div class="topbar">
    <div class="brand"><span class="logo"></span>OPTIONPILOT PRO <span class="mode">INTELLIGENCE LAYER</span></div>
    <button class="refresh" onclick="location.reload()">↻ Refresh</button>
  </div>

  <section class="hero">
    <div class="hero-grid">
      <div>
        <div class="eyebrow">Broad Market · Size Rotation · Research Intelligence</div>
        <h1>Market Intelligence Layer</h1>
        <div class="subtitle">Seven-index regime map designed to show breadth, size leadership and relative strength without changing production trading decisions.</div>
        <div class="hero-badges">
          <span class="badge risk">${esc(regime.state)}</span>
          <span class="badge transition">${esc(regime.transition)}</span>
          <span class="badge quality">DATA: ${esc(model.overallDataQuality)}</span>
          <span class="badge">STRENGTH: ${esc(regime.strength)}</span>
        </div>
      </div>
      <div class="regime-box">
        <div class="regime-label">CURRENT MARKET REGIME</div>
        <div class="regime-state">${esc(regime.state)}</div>
        <div class="regime-strength">Transition: ${esc(regime.transition)} · Strength: ${esc(regime.strength)}</div>
      </div>
    </div>
  </section>

  <section class="stats">
    <div class="stat"><div class="stat-label">20D Breadth</div><div class="stat-value">${positive20}/7 positive</div><div class="stat-note">indices above 20D return baseline</div></div>
    <div class="stat"><div class="stat-label">60D Breadth</div><div class="stat-value">${positive60}/7 positive</div><div class="stat-note">medium-term participation</div></div>
    <div class="stat"><div class="stat-label">20D Leader</div><div class="stat-value">${esc(best20?.indexCode ?? "—")}</div><div class="stat-note">${pct(best20?.return20d ?? null)}</div></div>
    <div class="stat"><div class="stat-label">60D Leader</div><div class="stat-value">${esc(best60?.indexCode ?? "—")}</div><div class="stat-note">${pct(best60?.return60d ?? null)} · ${warningCount} warnings</div></div>
  </section>

  <section class="section">
    <div class="section-head"><div><div class="section-title">7-Index Intelligence Strip</div><div class="section-sub">Fast visual read of momentum and relative strength</div></div><div class="section-sub">Trade date: ${esc(model.rows[0]?.tradeDate ?? "—")}</div></div>
    <div class="cards">${indexCards}</div>
  </section>

  <section class="section">
    <div class="section-head"><div><div class="section-title">Multi-Horizon Leadership Matrix</div><div class="section-sub">Returns and relative strength across short to long horizons</div></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Index</th><th>1D</th><th>5D</th><th>20D</th><th>60D</th><th>120D</th><th>252D</th><th>RS20D</th><th>RS60D</th><th>Quality</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>

  <section class="section insight">
    <div class="insight-card">
      <div class="section-title">Intelligence Interpretation</div>
      <div class="insight-main" style="margin-top:9px">${esc(interpretation)}</div>
      <div class="evidence">${esc(regime.evidence?.join(" ") ?? "")}</div>
    </div>
    <div class="insight-card">
      <div class="section-title">Data Watch</div>
      <div class="warnings">${warnings}</div>
    </div>
  </section>

  <div class="safety"><b>RESEARCH MODE · PRODUCTION IMPACT: NONE.</b> This layer is context only. It does not alter Verdict, scoring, Telegram alerts, candidate selection or execution.</div>
</div>
</body>
</html>`;
}
