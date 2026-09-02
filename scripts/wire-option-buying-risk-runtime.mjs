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

const importBlock = 'import { resolveRuntimeOptionBuyingRisk } from "./option-buying-runtime-risk-bridge.js";\nimport { OPTION_BUYING_RUNTIME_RISK_REGISTRY } from "./option-buying-runtime-risk-state.js";\n';
if (!src.includes('resolveRuntimeOptionBuyingRisk')) src = importBlock + src;

replaceOnce(
  'if (!tmPlan || tmPlan.status !== "OK" || estimatedLotLoss == null || (structure && estimatedLotLoss > structure.risk.maxLoss)) {',
  'const runtimeRisk = await resolveRuntimeOptionBuyingRisk(symbol, OPTION_BUYING_RUNTIME_RISK_REGISTRY);\n            const runtimeMaxLoss = runtimeRisk.allowRiskEvaluation ? runtimeRisk.maxLossForNewTrade : 0;\n            if (!tmPlan || tmPlan.status !== "OK" || estimatedLotLoss == null || !runtimeRisk.allowRiskEvaluation || estimatedLotLoss > runtimeMaxLoss) {',
  "dynamic runtime risk gate",
);

replaceOnce(
  'const reason = estimatedLotLoss == null\n                ? "A complete ATR/Delta stop and verified lot size are required before any buying alert."\n                : `One-lot planned loss ₹${estimatedLotLoss} exceeds the configured maximum ₹${structure?.risk.maxLoss}.`;',
  'const reason = estimatedLotLoss == null\n                ? "A complete ATR/Delta stop and verified lot size are required before any buying alert."\n                : !runtimeRisk.allowRiskEvaluation\n                  ? `Dynamic live risk state unavailable (${runtimeRisk.reasonCodes.join(",")}).`\n                  : `One-lot planned loss ₹${estimatedLotLoss} exceeds current dynamic allowance ₹${runtimeMaxLoss}.`;',
  "dynamic runtime risk reason",
);

if (checkOnly) {
  console.log(src === original ? "option buying risk runtime wiring already applied" : "option buying risk runtime wiring check passed");
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("option buying risk runtime wiring applied");
} else {
  console.log("option buying risk runtime wiring already applied");
}
