import "./wire-telegram-recorder-metric-persistence-v1.mjs";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const fusedPrerequisiteFile = path.resolve(process.cwd(), "scripts/wire-telegram-3m-fused-runtime.mjs");
const recorderPrerequisiteFile = path.resolve(process.cwd(), "scripts/wire-telegram-recorder-history-v1.mjs");
const packageFile = path.resolve(process.cwd(), "package.json");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_PCR_VIX_GLOBAL_HISTORY_V2";
const dedupAnchor = "const TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();";
const metricHistoryAnchor = `        const currentAt = Date.now();\n        const metricHistory: any[] = Array.isArray(session.telegramMetricHistory)\n          ? session.telegramMetricHistory.map((h: any) => ({ at: Date.parse(String(h?.timestamp ?? "")), value: h?.[symbol] }))\n              .filter((h: any) => Number.isFinite(h.at) && h.value)\n          : [];`;
const nullJoinAnchor = `          if (prev && prevMetric) {\n            if (!Number.isFinite(Number(prev.pcr)) && Number.isFinite(Number(prevMetric.pcr))) prev.pcr = Number(prevMetric.pcr);\n            if (!Number.isFinite(Number(prev.vix)) && Number.isFinite(Number(prevMetric.vix))) prev.vix = Number(prevMetric.vix);\n          }`;
const nullJoinReplacement = `          if (prev && prevMetric) {\n            const prevPcrMissing = prev.pcr == null || prev.pcr === "" || !Number.isFinite(Number(prev.pcr));\n            const prevVixMissing = prev.vix == null || prev.vix === "" || !Number.isFinite(Number(prev.vix));\n            if (prevPcrMissing && prevMetric.pcr != null && Number.isFinite(Number(prevMetric.pcr))) prev.pcr = Number(prevMetric.pcr);\n            if (prevVixMissing && prevMetric.vix != null && Number.isFinite(Number(prevMetric.vix))) prev.vix = Number(prevMetric.vix);\n          }`;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

// CI --check reads pristine server.ts because prerequisite wiring scripts are also run in
// check-only mode. Verify the exact prerequisite sources and startup order instead of
// pretending those runtime mutations already exist in server.ts.
if (checkOnly && !src.includes(MARKER) && (!src.includes(dedupAnchor) || !src.includes(metricHistoryAnchor))) {
  const fusedPrerequisite = fs.readFileSync(fusedPrerequisiteFile, "utf8");
  const recorderPrerequisite = fs.readFileSync(recorderPrerequisiteFile, "utf8");
  const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  const startup = String(pkg?.scripts?.start ?? "");
  const testScript = String(pkg?.scripts?.test ?? "");
  const missing = [];
  if (!fusedPrerequisite.includes(dedupAnchor)) missing.push("fused-dedup-anchor");
  if (!recorderPrerequisite.includes("const metricHistory: any[] = Array.isArray(session.telegramMetricHistory)")) missing.push("recorder-metric-history-anchor");
  if (!recorderPrerequisite.includes("const history: any[] = [...mergedHistory.values()]")) missing.push("recorder-restored-history-anchor");
  const recorderHasLegacyNullJoin = recorderPrerequisite.includes("if (!Number.isFinite(Number(prev.pcr)) && Number.isFinite(Number(prevMetric.pcr)))")
    && recorderPrerequisite.includes("if (!Number.isFinite(Number(prev.vix)) && Number.isFinite(Number(prevMetric.vix)))");
  if (!recorderHasLegacyNullJoin) missing.push("recorder-null-join-anchor");
  if (!testScript.includes("wire-telegram-pcr-vix-global-history-v2.mjs --check")) missing.push("test-check-hook");
  const fusedPos = startup.indexOf("node scripts/wire-telegram-3m-fused-runtime.mjs");
  const recorderPos = startup.indexOf("node scripts/wire-telegram-recorder-history-v1.mjs");
  const globalPos = startup.indexOf("node scripts/wire-telegram-pcr-vix-global-history-v2.mjs");
  if (fusedPos < 0 || recorderPos < 0 || globalPos < 0 || !(fusedPos < recorderPos && recorderPos < globalPos)) missing.push("startup-order");
  if (missing.length) throw new Error(`PCR/VIX global history prerequisites missing: ${missing.join(",")}`);
  console.log("telegram PCR/VIX global history prerequisite wiring check passed");
  process.exit(0);
}

if (!src.includes(MARKER)) {
  const dedupReplacement = `${dedupAnchor}\n// ${MARKER}: process-level bounded history owned by the same fused runtime that emits Telegram.\nconst TELEGRAM_PCR_VIX_HISTORY = new Map<string, Array<{ at: number; value: { pcr: number | null; vix: number | null } }>>();`;
  replaceOnce(dedupAnchor, dedupReplacement, "PCR/VIX global history declaration");

  const metricHistoryReplacement = `        const currentAt = Date.now();\n        const metricRows = TELEGRAM_PCR_VIX_HISTORY.get(symbol) ?? [];\n        metricRows.push({\n          at: currentAt,\n          value: {\n            pcr: m?.pcr != null && Number.isFinite(Number(m.pcr)) ? Number(m.pcr) : null,\n            vix: m?.vix != null && Number.isFinite(Number(m.vix)) ? Number(m.vix) : null,\n          },\n        });\n        while (metricRows.length > 40) metricRows.shift();\n        TELEGRAM_PCR_VIX_HISTORY.set(symbol, metricRows);\n        // Restart-safe fallback: seed the same nearest-window lookup from the already-restored\n        // Recorder/RAM history built above. No new DB query, timer, poller, socket or data source.\n        const restoredMetricRows: any[] = (history ?? []).map((h: any) => ({\n          at: h?.at,\n          value: {\n            pcr: h?.value?.pcr != null && Number.isFinite(Number(h.value.pcr)) ? Number(h.value.pcr) : null,\n            vix: h?.value?.vix != null && Number.isFinite(Number(h.value.vix)) ? Number(h.value.vix) : null,\n          },\n        })).filter((h: any) => Number.isFinite(h.at) && (h.value.pcr != null || h.value.vix != null));\n        const mergedMetricRows = new Map<number, any>();\n        for (const h of restoredMetricRows) mergedMetricRows.set(h.at, h);\n        for (const h of metricRows) mergedMetricRows.set(h.at, h); // live process rows win exact timestamp.\n        const metricHistory: any[] = [...mergedMetricRows.values()].sort((a: any, b: any) => a.at - b.at);`;
  replaceOnce(metricHistoryAnchor, metricHistoryReplacement, "PCR/VIX fused-runtime restart-safe history ownership");
  replaceOnce(nullJoinAnchor, nullJoinReplacement, "PCR/VIX null history join");
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
