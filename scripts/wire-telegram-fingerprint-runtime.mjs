import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

replaceOnce(
  "const TELEGRAM_LAST_STRUCTURE_FINGERPRINT: Map<string, string> = new Map();",
  "const TELEGRAM_LAST_STRUCTURE_FINGERPRINT: Map<string, string> = new Map();\nconst TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT: Map<string, string> = new Map();\nconst TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT: Map<string, string> = new Map();\nconst TELEGRAM_LAST_CANDIDATE_FINGERPRINT: Map<string, string> = new Map();",
  "fingerprint map declarations",
);

replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== structureFingerprint",
  "TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT.get(symbol) !== structureFingerprint",
  "structure blocker get",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, structureFingerprint);",
  "TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT.set(symbol, structureFingerprint);",
  "structure blocker set",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.get(symbol) !== riskFingerprint",
  "TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT.get(symbol) !== riskFingerprint",
  "risk blocker get",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, riskFingerprint);",
  "TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT.set(symbol, riskFingerprint);",
  "risk blocker set",
);
replaceOnce(
  "TELEGRAM_LAST_STRUCTURE_FINGERPRINT.set(symbol, `${label}|${structure?.side || \"NONE\"}`);",
  "TELEGRAM_LAST_CANDIDATE_FINGERPRINT.set(symbol, `${label}|${structure?.side || \"NONE\"}`);",
  "candidate fingerprint set",
);
replaceOnce(
  "  TELEGRAM_LAST_STRUCTURE_FINGERPRINT.clear();",
  "  TELEGRAM_LAST_STRUCTURE_FINGERPRINT.clear();\n  TELEGRAM_LAST_STRUCTURE_BLOCK_FINGERPRINT.clear();\n  TELEGRAM_LAST_RISK_BLOCK_FINGERPRINT.clear();\n  TELEGRAM_LAST_CANDIDATE_FINGERPRINT.clear();",
  "daily fingerprint clear",
);

if (checkOnly) {
  if (src === original) {
    console.log("telegram fingerprint runtime wiring already applied");
  } else {
    console.log("telegram fingerprint runtime wiring check passed");
  }
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram fingerprint runtime wiring applied");
} else {
  console.log("telegram fingerprint runtime wiring already applied");
}
