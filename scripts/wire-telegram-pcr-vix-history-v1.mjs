import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_PCR_VIX_HISTORY_V1";

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

if (!src.includes(MARKER)) {
  const snapshotAnchor = `    session.marketSnapshot = snapshot;\n    session.snapshotTime = Date.now();`;
  const snapshotReplacement = `${snapshotAnchor}\n\n    // ${MARKER}: retain exact already-fetched PCR/VIX only for Telegram rolling windows.\n    // No extra request, timer, socket, scoring, selector, Telegram trigger, or execution side effect.\n    const telegramMetricAt = Date.now();\n    const telegramMetricRow: any = { timestamp: new Date(telegramMetricAt).toISOString() };\n    for (const telegramMetricSym of [\"NIFTY\", \"BANKNIFTY\", \"SENSEX\"] as const) {\n      const telegramMetricMarket: any = snapshot[telegramMetricSym];\n      if (!telegramMetricMarket || telegramMetricMarket.error) continue;\n      const pcr = Number.isFinite(Number(telegramMetricMarket.pcr)) ? Number(telegramMetricMarket.pcr) : null;\n      const vix = Number.isFinite(Number(telegramMetricMarket.vix)) ? Number(telegramMetricMarket.vix) : null;\n      telegramMetricRow[telegramMetricSym] = { pcr, vix };\n    }\n    (session.telegramMetricHistory ??= []).push(telegramMetricRow);\n    if (session.telegramMetricHistory.length > 40) session.telegramMetricHistory.splice(0, session.telegramMetricHistory.length - 40);`;
  replaceOnce(snapshotAnchor, snapshotReplacement, "PCR/VIX rolling capture");

  const nearestAnchor = `        const currentAt = Date.now();\n        const nearest = (mins: number) => {`;
  const nearestReplacement = `        const currentAt = Date.now();\n        const metricHistory: any[] = Array.isArray(session.telegramMetricHistory)\n          ? session.telegramMetricHistory.map((h: any) => ({ at: Date.parse(String(h?.timestamp ?? \"\")), value: h?.[symbol] }))\n              .filter((h: any) => Number.isFinite(h.at) && h.value)\n          : [];\n        const nearestMetric = (mins: number) => {\n          const target = currentAt - mins * 60_000;\n          let best: any = null; let distance = Number.POSITIVE_INFINITY;\n          for (const h of metricHistory) { const d = Math.abs(h.at - target); if (d < distance && d <= 90_000) { best = h.value; distance = d; } }\n          return best;\n        };\n        const nearest = (mins: number) => {`;
  replaceOnce(nearestAnchor, nearestReplacement, "PCR/VIX nearest helper");

  const prevAnchor = `          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);`;
  const prevReplacement = `          const prev: any = nearest(mins);\n          const prevMetric: any = nearestMetric(mins);\n          if (prev && prevMetric) {\n            if (!Number.isFinite(Number(prev.pcr)) && Number.isFinite(Number(prevMetric.pcr))) prev.pcr = Number(prevMetric.pcr);\n            if (!Number.isFinite(Number(prev.vix)) && Number.isFinite(Number(prevMetric.vix))) prev.vix = Number(prevMetric.vix);\n          }\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);`;
  replaceOnce(prevAnchor, prevReplacement, "PCR/VIX previous metric join");
}

if (checkOnly) {
  console.log(src === original ? "telegram PCR/VIX history wiring already applied" : "telegram PCR/VIX history wiring check passed");
  process.exit(0);
}
if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram PCR/VIX history wiring applied");
} else {
  console.log("telegram PCR/VIX history wiring already applied");
}
