import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_NO_TRADE_REASON_DEDUPE_V1";

if (src.includes(MARKER)) {
  console.log("no-trade reason dedupe wiring already applied");
  process.exit(0);
}

const from = `        const blockedGateNames = structure.gates.filter((gate) => gate.blocking).map((gate) => gate.name).slice(0, 4);\n        const structureFingerprint = \`NO_TRADE|\${blockedGateNames.join("|")}\`;\n        if (TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint) {\n          const reason = structure.hardBlockReasons[0] || "No validated option-buying setup is available.";`;

const to = `        const blockedGateNames = structure.gates.filter((gate) => gate.blocking).map((gate) => gate.name).slice(0, 4);\n        const reason = structure.hardBlockReasons[0] || "No validated option-buying setup is available.";\n        // ${MARKER}: suppress repeated NO TRADE alerts when the user-visible reason is unchanged.\n        const structureFingerprint = \`NO_TRADE_REASON|\${reason}\`;\n        if (TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint) {`;

const count = src.split(from).length - 1;
if (count === 0) {
  console.warn("no-trade reason dedupe anchor not found; leaving core startup unchanged");
  process.exit(0);
}
if (count > 1) {
  console.warn(`no-trade reason dedupe anchor count=${count}; refusing ambiguous mutation`);
  process.exit(0);
}

src = src.replace(from, to);
if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("no-trade reason dedupe wiring applied");
} else {
  console.log("no-trade reason dedupe wiring unchanged");
}
