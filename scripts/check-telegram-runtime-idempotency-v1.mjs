import fs from "node:fs";

const source = fs.readFileSync("scripts/wire-no-trade-reason-dedupe-v1.mjs", "utf8");
const required = [
  'const FUSED_MARKER = "OPTIONPILOT_3M_RICH_FUSED_TELEGRAM_RUNTIME_V2";',
  'if (!fs.readFileSync(file, "utf8").includes(FUSED_MARKER)) {',
  'console.log("telegram 3m rich fused runtime wiring already applied");',
];
for (const needle of required) {
  if (!source.includes(needle)) throw new Error(`Missing idempotency guard: ${needle}`);
}
console.log("telegram runtime idempotency guard PASS");
