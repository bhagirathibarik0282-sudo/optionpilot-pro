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

function replaceAvailable(from, to) {
  const count = src.split(from).length - 1;
  if (count === 0) return false;
  src = src.split(from).join(to);
  return true;
}

const interfaceReplacement = `  snapshotStatus: "LIVE" | "PARTIAL" | "STALE" | "INVALID";\n  // ${MARKER}: display-support metadata persisted with the same Recorder entry.\n  telegramMetrics?: Partial<Record<"NIFTY" | "BANKNIFTY" | "SENSEX", { pcr: number | null; vix: number | null }>>;\n  NIFTY: RecorderIndexSnapshot | null;`;

const entryReplacement = `      snapshotStatus: computeSnapshotStatusFromTruth([niftyTruth, bankTruth, sensexTruth]),\n      // ${MARKER}: persist exact already-fetched PCR/VIX only.\n      telegramMetrics: Object.fromEntries((["NIFTY", "BANKNIFTY", "SENSEX"] as const).map((metricSymbol) => {\n        const metricMarket: any = snapshot[metricSymbol];\n        return [metricSymbol, {\n          pcr: metricMarket && !metricMarket.error && metricMarket.pcr != null && Number.isFinite(Number(metricMarket.pcr)) ? Number(metricMarket.pcr) : null,\n          vix: metricMarket && !metricMarket.error && metricMarket.vix != null && Number.isFinite(Number(metricMarket.vix)) ? Number(metricMarket.vix) : null,\n        }];\n      })),\n      NIFTY: niftySnap,`;

const restoredReplacement = `          const rawValue = h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null;\n          let normalizedValue: any = normalizeRecorderValue(rawValue);\n          const persistedMetric: any = h?.telegramMetrics?.[symbol] ?? null;\n          if (normalizedValue && persistedMetric) {\n            normalizedValue = { ...normalizedValue, pcr: finiteMetric(normalizedValue?.pcr, persistedMetric?.pcr), vix: finiteMetric(normalizedValue?.vix, persistedMetric?.vix) };\n          }\n          return {\n            at: historyTime(h?.backendTimestamp ?? h?.timestamp ?? h?.snapshotTime ?? h?.createdAt),\n            value: normalizedValue,\n            source: "RECORDER",\n          };`;

if (checkOnly && !src.includes(MARKER)) {
  const recorderPrerequisite = fs.readFileSync(recorderPrerequisiteFile, "utf8");
  const missing = [];
  if (!src.includes(interfaceAnchor) && !src.includes(interfaceReplacement)) missing.push("recorder-interface-anchor");
  if (!src.includes(entryAnchor) && !src.includes(entryReplacement)) missing.push("recorder-entry-anchor");
  if (!recorderPrerequisite.includes("const rawValue = h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null;")) missing.push("restored-history-source");
  if (missing.length) throw new Error(`recorder metric persistence prerequisites missing: ${missing.join(",")}`);
  console.log("telegram recorder metric persistence prerequisite wiring check passed");
  process.exit(0);
}

if (!src.includes(MARKER)) {
  replaceAvailable(interfaceAnchor, interfaceReplacement);
  replaceAvailable(entryAnchor, entryReplacement);
  // Runtime may already contain a recorder-history variant from the persistent volume.
  // Missing this optional join must never crash the entire production service.
  replaceAvailable(restoredAnchor, restoredReplacement);
}

if (checkOnly) {
  console.log(src === original ? "telegram recorder metric persistence wiring already applied/compatible" : "telegram recorder metric persistence wiring check passed");
  process.exit(0);
}
if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram recorder metric persistence wiring applied");
} else {
  console.log("telegram recorder metric persistence wiring already applied/compatible");
}
