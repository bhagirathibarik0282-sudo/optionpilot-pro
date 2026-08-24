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

function tone(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "muted";
  return value > 0 ? "pos" : value < 0 ? "neg" : "muted";
}

export function renderResearchDashboardHtml(model: ResearchDashboardModel): string {
  const regime = model.regime;
  const interpretation =
    regime.state === "BROAD_RISK_ON" && regime.transition === "DECELERATING"
      ? "Broad participation positive, momentum decelerating."
      : regime.evidence?.[0] ?? "Research context available.";

  const rows = model.rows.map((r) => `
    <tr>
      <td class="name">${esc(r.indexName ?? r.indexCode)}</td>
      <td class="${tone(r.return1d)}">${pct(r.return1d)}</td>
      <td class="${tone(r.return5d)}">${pct(r.return5d)}</td>
      <td class="${tone(r.return20d)}">${pct(r.return20d)}</td>
      <td class="${tone(r.return60d)}">${pct(r.return60d)}</td>
      <td class="${tone(r.return120d)}">${pct(r.return120d)}</td>
      <td class="${tone(r.return252d)}">${pct(r.return252d)}</td>
      <td class="${tone(r.rsVsNifty50_20d)}">${pct(r.rsVsNifty50_20d)}</td>
      <td class="${tone(r.rsVsNifty50_60d)}">${pct(r.rsVsNifty50_60d)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.title)}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#070b14;color:#eaf2ff;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
  .wrap{max-width:1180px;margin:auto;padding:18px}
  .card{background:#0d1422;border:1px solid #22304a;border-radius:18px;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.28)}
  .head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}
  h1{font-size:18px;margin:0 0 8px;letter-spacing:.03em}
  .sub{color:#91a4c4;font-size:12px}
  .badges{display:flex;gap:8px;flex-wrap:wrap}
  .badge{padding:7px 10px;border-radius:999px;border:1px solid #2d4064;background:#111d31;font-size:12px;font-weight:700}
  .risk{border-color:#1e9b70;color:#78f7c7}
  .warn{border-color:#9f7b27;color:#ffd77a}
  .quality{border-color:#694f9d;color:#d2b7ff}
  .table-wrap{overflow:auto;margin-top:16px;border:1px solid #1b2942;border-radius:14px}
  table{width:100%;border-collapse:collapse;min-width:900px}
  th,td{padding:11px 12px;border-bottom:1px solid #17243a;text-align:right;font-size:13px}
  th{position:sticky;top:0;background:#101a2b;color:#91a4c4;font-size:11px;letter-spacing:.04em}
  th:first-child,td:first-child{text-align:left}
  .name{font-weight:700;color:#f4f8ff}
  .pos{color:#6ee7b7}.neg{color:#ff8c98}.muted{color:#9aa9bf}
  .foot{margin-top:16px;padding:14px;border-radius:12px;background:#0a111e;border:1px solid #1d2b43}
  .foot strong{display:block;margin-bottom:5px}
  .fine{margin-top:8px;color:#7f91ae;font-size:11px}
  @media(max-width:600px){.wrap{padding:10px}.card{padding:13px;border-radius:14px}h1{font-size:16px}}
</style>
</head>
<body>
<div class="wrap">
  <section class="card">
    <div class="head">
      <div>
        <h1>${esc(model.title)}</h1>
        <div class="sub">Trade date: ${esc(model.rows[0]?.tradeDate ?? "—")} · Research Mode · Production impact: NONE</div>
      </div>
      <div class="badges">
        <span class="badge risk">${esc(regime.state)}</span>
        <span class="badge warn">${esc(regime.transition)}</span>
        <span class="badge quality">QUALITY: ${esc(model.overallDataQuality)}</span>
        <span class="badge">STRENGTH: ${esc(regime.strength)}</span>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Index</th><th>1D</th><th>5D</th><th>20D</th><th>60D</th><th>120D</th><th>252D</th><th>RS20D</th><th>RS60D</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="foot">
      <strong>${esc(interpretation)}</strong>
      <div class="sub">${esc(regime.evidence?.join(" ") ?? "")}</div>
      <div class="fine">Research-only view. Does not alter Verdict, Telegram, scoring, or execution.</div>
    </div>
  </section>
</div>
</body>
</html>`;
}
