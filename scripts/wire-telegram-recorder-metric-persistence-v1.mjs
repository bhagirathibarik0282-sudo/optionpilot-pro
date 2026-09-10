import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const recorderPrerequisiteFile = path.resolve(process.cwd(), "scripts/wire-telegram-recorder-history-v1.mjs");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;

const MARKER = "OPTIONPILOT_TELEGRAM_RECORDER_METRIC_PERSISTENCE_V1";
const interfaceAnchor = `  snapshotStatus: "LIVE" | "PARTIAL" | "STALE" | "INVALID";\n  NIFTY: RecorderIndexSnapshot | null;`;
const entryAnchor = `      snapshotStatus: computeSnapshotStatusFromTruth([niftyTruth, bankTruth, sensexTruth]),\n      NIFTY: niftySnap,`;
const restoredAnchor = `          const rawValue = h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null;\n          return {\n            at: historyTime(h?.backendTimestamp ?? h?.timestamp ?? h?.snapshotTime ?? h?.createdAt),\n            value: normalizeRecorderValue(rawValue),\n            source: "RECORDER",\n          };`;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

const interfaceReplacement = `  snapshotStatus: "LIVE" | "PARTIAL" | "STALE" | "INVALID";\n  // ${MARKER}: display-support metadata persisted with the same Recorder entry.\n  // These fields do not participate in Truth Engine scoring, selector authority or execution.\n  telegramMetrics?: Partial<Record<"NIFTY" | "BANKNIFTY" | "SENSEX", { pcr: number | null; vix: number | null }>>;\n  NIFTY: RecorderIndexSnapshot | null;`;

const entryReplacement = `      snapshotStatus: computeSnapshotStatusFromTruth([niftyTruth, bankTruth, sensexTruth]),\n      // ${MARKER}: persist the exact already-fetched PCR/VIX used by the live Telegram snapshot.\n      // Missing/non-finite values remain null; no backfill, inference or extra market request.\n      telegramMetrics: Object.fromEntries((["NIFTY", "BANKNIFTY", "SENSEX"] as const).map((metricSymbol) => {\n        const metricMarket: any = snapshot[metricSymbol];\n        return [metricSymbol, {\n          pcr: metricMarket && !metricMarket.error && metricMarket.pcr != null && Number.isFinite(Number(metricMarket.pcr)) ? Number(metricMarket.pcr) : null,\n          vix: metricMarket && !metricMarket.error && metricMarket.vix != null && Number.isFinite(Number(metricMarket.vix)) ? Number(metricMarket.vix) : null,\n        }];\n      })),\n      NIFTY: niftySnap,`;

const restoredReplacement = `          const rawValue = h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null;\n          let normalizedValue: any = normalizeRecorderValue(rawValue);\n          const persistedMetric: any = h?.telegramMetrics?.[symbol] ?? null;\n          if (normalizedValue && persistedMetric) {\n            normalizedValue = {\n              ...normalizedValue,\n              pcr: finiteMetric(normalizedValue?.pcr, persistedMetric?.pcr),\n              vix: finiteMetric(normalizedValue?.vix, persistedMetric?.vix),\n            };\n          }\n          return {\n            at: historyTime(h?.backendTimestamp ?? h?.timestamp ?? h?.snapshotTime ?? h?.createdAt),\n            value: normalizedValue,\n            source: "RECORDER",\n          };`;

if (checkOnly && !src.includes(MARKER)) {
  const recorderPrerequisite = fs.readFileSync(recorderPrerequisiteFile, "utf8");
  const missing = [];
  if (!src.includes(interfaceAnchor)) missing.push("recorder-interface-anchor");
  if (!src.includes(entryAnchor)) missing.push("recorder-entry-anchor");
  if (!recorderPrerequisite.includes("const rawValue = h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null;")) missing.push("restored-history-anchor");
  if (missing.length) throw new Error(`recorder metric persistence prerequisites missing: ${missing.join(",")}`);
  console.log("telegram recorder metric persistence prerequisite wiring check passed");
  process.exit(0);
}

if (!src.includes(MARKER)) {
  replaceOnce(interfaceAnchor, interfaceReplacement, "RecorderSnapshot telegram metric type");
  replaceOnce(entryAnchor, entryReplacement, "RecorderSnapshot telegram metric persistence");
  replaceOnce(restoredAnchor, restoredReplacement, "restored Recorder telegram metric join");
}

if (checkOnly) {
  console.log(src === original ? "telegram recorder metric persistence wiring already applied" : "telegram recorder metric persistence wiring check passed");
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram recorder metric persistence wiring applied");
} else {
  console.log("telegram recorder metric persistence wiring already applied");
}
