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

// Import the tested fail-closed runtime bridge + registry.
const importAnchor = 'import { serve } from "@hono/node-server";';
const importBlock = `${importAnchor}\nimport { resolveRuntimeOptionBuyingRisk } from "./option-buying-runtime-risk-bridge.js";\nimport { OptionBuyingRuntimeRiskRegistry } from "./option-buying-runtime-risk-registry.js";`;
replaceOnce(importAnchor, importBlock, "dynamic risk imports");

// One process-local registry. Until fresh authoritative state is populated, the bridge blocks.
const registryAnchor = "const TELEGRAM_LAST_STRUCTURE_FINGERPRINT: Map<string, string> = new Map();";
const registryBlock = `${registryAnchor}\nconst OPTION_BUYING_RUNTIME_RISK_REGISTRY = new OptionBuyingRuntimeRiskRegistry(60_000);`;
replaceOnce(registryAnchor, registryBlock, "dynamic risk registry");

const oldRiskBlock = `            if (!tmPlan || tmPlan.status !== "OK" || estimatedLotLoss == null || (structure && estimatedLotLoss > structure.risk.maxLoss)) {\n              const reason = estimatedLotLoss == null\n                ? "A complete ATR/Delta stop and verified lot size are required before any buying alert."\n                : \`One-lot planned loss ₹\${estimatedLotLoss} exceeds the configured maximum ₹\${structure?.risk.maxLoss}.\`;`;

const newRiskBlock = `            const runtimeRisk = await resolveRuntimeOptionBuyingRisk(symbol, OPTION_BUYING_RUNTIME_RISK_REGISTRY);\n            const runtimeMaxLoss = runtimeRisk.allowRiskEvaluation ? runtimeRisk.maxLossForNewTrade : 0;\n            if (!tmPlan || tmPlan.status !== "OK" || estimatedLotLoss == null || !runtimeRisk.allowRiskEvaluation || estimatedLotLoss > runtimeMaxLoss) {\n              const reason = estimatedLotLoss == null\n                ? "A complete ATR/Delta stop and verified lot size are required before any buying alert."\n                : !runtimeRisk.allowRiskEvaluation\n                  ? \`Live dynamic risk state unavailable: \${runtimeRisk.reasonCodes.join(", ")}\`\n                  : \`One-lot planned loss ₹\${estimatedLotLoss} exceeds live remaining risk ₹\${Number(runtimeMaxLoss.toFixed(2))}.\`;`;
replaceOnce(oldRiskBlock, newRiskBlock, "replace static option buying risk gate");

if (checkOnly) {
  console.log(src === original ? "dynamic risk runtime wiring already applied" : "dynamic risk runtime wiring check passed");
  process.exit(0);
}

if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("dynamic risk runtime wiring applied");
} else {
  console.log("dynamic risk runtime wiring already applied");
}
