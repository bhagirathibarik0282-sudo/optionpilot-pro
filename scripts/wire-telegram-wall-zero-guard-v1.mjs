import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const fusedPrerequisiteFile = path.resolve(process.cwd(), "scripts/wire-telegram-3m-fused-runtime.mjs");
const packageFile = path.resolve(process.cwd(), "package.json");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_WALL_ZERO_GUARD_V1";

const wallAnchor = `        const finiteOrNull = (v: any) => Number.isFinite(Number(v)) ? Number(v) : null;\n        const callWallStrike = finiteOrNull(wallCurrent?.callWallStrike);\n        const callWallStrength = finiteOrNull(wallCurrent?.callWallStrength);\n        const putWallStrike = finiteOrNull(wallCurrent?.putWallStrike);\n        const putWallStrength = finiteOrNull(wallCurrent?.putWallStrength);\n        console.log(\`[TELEGRAM_3M_WALL_SOURCE] \${JSON.stringify({ symbol, state: wallCurrent ? "VERIFIED" : "UNAVAILABLE", callWallStrike, callWallStrength, putWallStrike, putWallStrength })}\`);`;

const wallReplacement = `        // ${MARKER}: zero/non-positive wall outputs are absence, never verified evidence.\n        const positiveFiniteOrNull = (v: any) => {\n          if (v == null || v === "") return null;\n          const n = Number(v);\n          return Number.isFinite(n) && n > 0 ? n : null;\n        };\n        const callWallStrike = positiveFiniteOrNull(wallCurrent?.callWallStrike);\n        const callWallStrength = positiveFiniteOrNull(wallCurrent?.callWallStrength);\n        const putWallStrike = positiveFiniteOrNull(wallCurrent?.putWallStrike);\n        const putWallStrength = positiveFiniteOrNull(wallCurrent?.putWallStrength);\n        const callWallValid = callWallStrike != null && callWallStrength != null;\n        const putWallValid = putWallStrike != null && putWallStrength != null;\n        const wallSourceState = callWallValid || putWallValid ? "VERIFIED" : "UNAVAILABLE";\n        console.log(\`[TELEGRAM_3M_WALL_SOURCE] \${JSON.stringify({ symbol, state: wallSourceState, callWallStrike, callWallStrength, putWallStrike, putWallStrength })}\`);`;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

if (checkOnly && !src.includes(MARKER) && !src.includes(wallAnchor)) {
  const fused = fs.readFileSync(fusedPrerequisiteFile, "utf8");
  const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  const startup = String(pkg?.scripts?.start ?? "");
  const tests = String(pkg?.scripts?.test ?? "");
  const missing = [];
  if (!fused.includes('const finiteOrNull = (v: any) => Number.isFinite(Number(v)) ? Number(v) : null;')) missing.push("wall-anchor");
  const fusedPos = startup.indexOf("node scripts/wire-telegram-3m-fused-runtime.mjs");
  const guardPos = startup.indexOf("node scripts/wire-telegram-wall-zero-guard-v1.mjs");
  if (fusedPos < 0 || guardPos < 0 || !(fusedPos < guardPos)) missing.push("startup-order");
  if (!tests.includes("wire-telegram-wall-zero-guard-v1.mjs --check")) missing.push("test-check-hook");
  if (missing.length) throw new Error(`wall zero guard prerequisites missing: ${missing.join(",")}`);
  console.log("telegram wall zero guard prerequisite wiring check passed");
  process.exit(0);
}

if (!src.includes(MARKER)) {
  replaceOnce(wallAnchor, wallReplacement, "wall zero guard");
  src = src.replaceAll('wallSource: wallCurrent ? "VERIFIED" : "UNAVAILABLE"', 'wallSource: wallSourceState');
}

if (checkOnly) {
  console.log(src === original ? "telegram wall zero guard already applied" : "telegram wall zero guard wiring check passed");
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram wall zero guard wiring applied");
} else {
  console.log("telegram wall zero guard already applied");
}
