import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_PCR_VIX_GLOBAL_HISTORY_V2";

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

if (!src.includes(MARKER)) {
  const dedupAnchor = "const TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();";
  const dedupReplacement = `${dedupAnchor}\n// ${MARKER}: process-level bounded history owned by the same fused runtime that emits Telegram.\nconst TELEGRAM_PCR_VIX_HISTORY = new Map<string, Array<{ at: number; value: { pcr: number | null; vix: number | null } }>>();`;
  replaceOnce(dedupAnchor, dedupReplacement, "PCR/VIX global history declaration");

  const metricHistoryAnchor = `        const currentAt = Date.now();\n        const metricHistory: any[] = Array.isArray(session.telegramMetricHistory)\n          ? session.telegramMetricHistory.map((h: any) => ({ at: Date.parse(String(h?.timestamp ?? "")), value: h?.[symbol] }))\n              .filter((h: any) => Number.isFinite(h.at) && h.value)\n          : [];`;
  const metricHistoryReplacement = `        const currentAt = Date.now();\n        const metricRows = TELEGRAM_PCR_VIX_HISTORY.get(symbol) ?? [];\n        metricRows.push({\n          at: currentAt,\n          value: {\n            pcr: Number.isFinite(Number(m?.pcr)) ? Number(m.pcr) : null,\n            vix: Number.isFinite(Number(m?.vix)) ? Number(m.vix) : null,\n          },\n        });\n        while (metricRows.length > 40) metricRows.shift();\n        TELEGRAM_PCR_VIX_HISTORY.set(symbol, metricRows);\n        const metricHistory: any[] = metricRows;`;
  replaceOnce(metricHistoryAnchor, metricHistoryReplacement, "PCR/VIX fused-runtime history ownership");
}

if (checkOnly) {
  console.log(src === original ? "telegram PCR/VIX global history wiring already applied" : "telegram PCR/VIX global history wiring check passed");
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram PCR/VIX global history wiring applied");
} else {
  console.log("telegram PCR/VIX global history wiring already applied");
}
