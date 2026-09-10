import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const serverFile = path.resolve(root, "server.ts");
const bridgeFile = path.resolve(root, "meaningful-live-telegram.ts");
const checkOnly = process.argv.includes("--check");

let server = fs.readFileSync(serverFile, "utf8");
let bridge = fs.readFileSync(bridgeFile, "utf8");
const originalServer = server;
const originalBridge = bridge;

function replaceOnce(src, from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return src;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  return src.replace(from, to);
}

server = replaceOnce(
  server,
  'import { buildTelegramTradeCard, TradeCardInput, TradeCardTmPlan, TradeCardAdvancedGreeks } from "./telegram-trade-card.js";',
  'import { buildTelegramTradeCard, TradeCardInput, TradeCardTmPlan, TradeCardAdvancedGreeks } from "./telegram-trade-card.js";\nimport { buildThreeMinuteFusedTelegramView, ThreeMinuteFusedDedup } from "./telegram-3m-fused-monitor.js";',
  "3m fused import",
);

server = replaceOnce(
  server,
  'let telegramEodSummarySentDate: string | null = null;',
  'let telegramEodSummarySentDate: string | null = null;\nconst TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();',
  "3m fused dedup singleton",
);

const insertionPoint = '      const dataIsProduction = cand?.reviewStatus === "REVIEWABLE_DATA";';
const fusedBlock = `      const dataIsProduction = cand?.reviewStatus === "REVIEWABLE_DATA";\n\n      // OPTIONPILOT_3M_FUSED_TELEGRAM_RUNTIME_V1\n      // Monitor-only summary. It never creates/changes a candidate and never grants execution authority.\n      if ((symbol === "NIFTY" || symbol === "SENSEX") && m && structure) {\n        const directionalStance = structure.side === "CE" ? "BULLISH" as const : structure.side === "PE" ? "BEARISH" as const : "NEUTRAL" as const;\n        const truthVerified = structure.truthVerdict === "TRUE";\n        const supportive = (flag: boolean) => truthVerified && flag ? directionalStance : "NEUTRAL" as const;\n        const canonicalAction = structure.signal === "STRONG BUY CE" || structure.signal === "BUY CE"\n          ? "BUY_CE" as const\n          : structure.signal === "STRONG BUY PE" || structure.signal === "BUY PE"\n            ? "BUY_PE" as const\n            : "WAIT" as const;\n        const view = buildThreeMinuteFusedTelegramView({\n          symbol,\n          atLabel: istTime(),\n          families: [\n            { label: "Structure", stance: supportive(structure.evidenceGroups.priceStructure), verified: truthVerified, detail: structure.signal },\n            { label: "Premium", stance: supportive(structure.evidenceGroups.premiumBehaviour), verified: truthVerified, detail: structure.premiums?.current?.alignment ?? null },\n            { label: "OI/PCR", stance: supportive(structure.evidenceGroups.pcrOi), verified: truthVerified, detail: "support-only; never standalone direction" },\n            { label: "IV/VIX", stance: supportive(structure.evidenceGroups.volatilityContext), verified: truthVerified },\n            { label: "Futures", stance: m.futuresVwapBias === "UP" ? "BULLISH" : m.futuresVwapBias === "DOWN" ? "BEARISH" : "PENDING", verified: m.futuresVwapBias !== "UNKNOWN", detail: m.futuresVwapBias },\n          ],\n          canonicalAction,\n          canonicalCandidateKey: null,\n        });\n        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {\n          await sendAlertSpaced(view.text, symbol);\n          console.log(\`[TELEGRAM_3M_FUSED] \${JSON.stringify({ symbol, state: "SENT", bias: view.bias, stars: view.stars, canonicalAction: view.canonicalAction, fingerprint: view.fingerprint })}\`);\n        } else {\n          console.log(\`[TELEGRAM_3M_FUSED] \${JSON.stringify({ symbol, state: "SUPPRESSED_UNCHANGED", fingerprint: view.fingerprint })}\`);\n        }\n      }`;
server = replaceOnce(server, insertionPoint, fusedBlock, "3m fused alert-cycle wiring");

bridge = replaceOnce(
  bridge,
  'export function isMeaningfulBridgeOwnedTelegramText(text: string): boolean {\n  if (/WHAT MARKET FOLLOWED|OPTIONPILOT MEANINGFUL V1/i.test(text)) return false;',
  'export function isMeaningfulBridgeOwnedTelegramText(text: string): boolean {\n  if (/WHAT MARKET FOLLOWED|OPTIONPILOT MEANINGFUL V1|OPTIONPILOT 3M FUSED VIEW/i.test(text)) return false;',
  "3m fused bridge exemption",
);

if (checkOnly) {
  console.log(server === originalServer && bridge === originalBridge
    ? "telegram 3m fused runtime wiring already applied"
    : "telegram 3m fused runtime wiring check passed");
  process.exit(0);
}

if (server !== originalServer) fs.writeFileSync(serverFile, server, "utf8");
if (bridge !== originalBridge) fs.writeFileSync(bridgeFile, bridge, "utf8");
console.log(server !== originalServer || bridge !== originalBridge
  ? "telegram 3m fused runtime wiring applied"
  : "telegram 3m fused runtime wiring already applied");
