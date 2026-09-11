import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
let src = fs.readFileSync(file, "utf8");
const original = src;

const DEDUPE_MARKER = "OPTIONPILOT_NO_TRADE_REASON_DEDUPE_V1";
if (!src.includes(DEDUPE_MARKER)) {
  const from = `        const blockedGateNames = structure.gates.filter((gate) => gate.blocking).map((gate) => gate.name).slice(0, 4);\n        const structureFingerprint = \`NO_TRADE|\${blockedGateNames.join("|")}\`;\n        if (TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint) {\n          const reason = structure.hardBlockReasons[0] || "No validated option-buying setup is available.";`;
  const to = `        const blockedGateNames = structure.gates.filter((gate) => gate.blocking).map((gate) => gate.name).slice(0, 4);\n        const reason = structure.hardBlockReasons[0] || "No validated option-buying setup is available.";\n        // ${DEDUPE_MARKER}: suppress repeated NO TRADE alerts when the user-visible reason is unchanged.\n        const structureFingerprint = \`NO_TRADE_REASON|\${reason}\`;\n        if (TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint) {`;
  const count = src.split(from).length - 1;
  if (count === 1) {
    src = src.replace(from, to);
    console.log("no-trade reason dedupe wiring applied");
  } else {
    console.warn(`no-trade reason dedupe anchor count=${count}; leaving that patch unchanged`);
  }
} else {
  console.log("no-trade reason dedupe wiring already applied");
}

const TRUTH_MARKER = "OPTIONPILOT_TRUTH_SYNC_COLLECTION_CYCLE_V1";
if (!src.includes(TRUTH_MARKER)) {
  const from = `    const timestamps = [m.exchangeTimestamp, contract?.quoteTimestamp, atmCe?.quoteTimestamp, atmPe?.quoteTimestamp]\n      .filter((t): t is string => !!t)\n      .map((t) => new Date(t).getTime());\n    if (timestamps.length >= 2) {\n      const spread = Math.max(...timestamps) - Math.min(...timestamps);\n      syncOk = spread <= TRUTH_SYNC_TOLERANCE_MS;\n    }`;
  const to = `    // ${TRUTH_MARKER}: snapshotId is the authoritative synchronized backend collection cycle.\n    // Per-field spot/futures/options freshness is already validated above.\n    // Provider last-trade-time differences must not create a false cross-component STALE verdict.\n    syncOk = !!m.snapshotId;`;
  const count = src.split(from).length - 1;
  if (count === 1) {
    src = src.replace(from, to);
    console.log("truth sync collection-cycle wiring applied");
  } else {
    console.warn(`truth sync anchor count=${count}; leaving that patch unchanged`);
  }
} else {
  console.log("truth sync collection-cycle wiring already applied");
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
} else {
  console.log("runtime wiring unchanged");
}

// Narrow observation-only chain: reuse existing proven fused market view and 15m window summary.
await import("./wire-telegram-3m-fused-runtime.mjs");
await import("./wire-telegram-window-summary-runtime.mjs");
await import("./wire-telegram-market-pulse-concise-v1.mjs");
