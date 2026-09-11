import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const fusedWirerFile = path.resolve(process.cwd(), "scripts/wire-telegram-3m-fused-runtime.mjs");

// Repair the legacy fused mutator before it can touch server.ts.
// Its old replaceOnce guard checked src.includes(to) only when the source anchor count was zero.
// Because several replacement strings intentionally contain their original anchor, repeated process starts
// could append TELEGRAM_3M_FUSED_DEDUP again. Make the exact replacement idempotent first.
if (fs.existsSync(fusedWirerFile)) {
  const oldGuard = '  const count = src.split(from).length - 1;\n  if (count === 0 && src.includes(to)) return src;';
  const newGuard = '  if (src.includes(to)) return src;\n  const count = src.split(from).length - 1;';
  const wirerSrc = fs.readFileSync(fusedWirerFile, "utf8");
  if (wirerSrc.includes(oldGuard)) {
    fs.writeFileSync(fusedWirerFile, wirerSrc.replace(oldGuard, newGuard), "utf8");
    console.log("fused Telegram wirer idempotence guard repaired");
  } else if (wirerSrc.includes(newGuard)) {
    console.log("fused Telegram wirer idempotence guard already repaired");
  } else {
    throw new Error("FUSED_WIRER_IDEMPOTENCE_GUARD_ANCHOR_NOT_FOUND");
  }
}

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
// Guard the fused mutator with its own marker so process restarts cannot append duplicate imports/singletons/blocks.
const FUSED_MARKER = "OPTIONPILOT_3M_RICH_FUSED_TELEGRAM_RUNTIME_V2";
if (!fs.readFileSync(file, "utf8").includes(FUSED_MARKER)) {
  await import("./wire-telegram-3m-fused-runtime.mjs");
} else {
  console.log("telegram 3m rich fused runtime wiring already applied");
}
await import("./wire-telegram-window-summary-runtime.mjs");
