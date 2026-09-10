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
  'import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";',
  'import { collectH1LiveSelectorDecisions, collectH1LiveGateEvidenceAudit } from "./h1-live-selector-registry.js";',
  "3m fused PPD audit import",
);

server = replaceOnce(
  server,
  'let telegramEodSummarySentDate: string | null = null;',
  'let telegramEodSummarySentDate: string | null = null;\nconst TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();',
  "3m fused dedup singleton",
);

const insertionPoint = '      const dataIsProduction = cand?.reviewStatus === "REVIEWABLE_DATA";';
const fusedBlock = `      const dataIsProduction = cand?.reviewStatus === "REVIEWABLE_DATA";\n\n      // OPTIONPILOT_3M_RICH_FUSED_TELEGRAM_RUNTIME_V1\n      // Three-index monitor only. Uses already-present runtime/history; opens no new polling loop.\n      if (m && structure) {\n        const directionalStance = structure.side === "CE" ? "BULLISH" as const : structure.side === "PE" ? "BEARISH" as const : "NEUTRAL" as const;\n        const truthVerified = structure.truthVerdict === "TRUE";\n        const supportive = (flag: boolean) => truthVerified && flag ? directionalStance : "NEUTRAL" as const;\n        const canonicalAction = symbol === "BANKNIFTY"\n          ? "WAIT" as const\n          : structure.signal === "STRONG BUY CE" || structure.signal === "BUY CE"\n            ? "BUY_CE" as const\n            : structure.signal === "STRONG BUY PE" || structure.signal === "BUY PE"\n              ? "BUY_PE" as const\n              : "WAIT" as const;\n\n        const expiryNow: any = v2CurrentExpiry(m);\n        const atmCe: any = expiryNow?.ceStrikes?.find((x: any) => x?.isAtm) ?? null;\n        const atmPe: any = expiryNow?.peStrikes?.find((x: any) => x?.isAtm) ?? null;\n        const fut: any = m.futuresContracts?.[0] ?? null;\n        const oiEvidence: any = buildV2OiPositioningEvidence(symbol, 20);\n        const callWallStrike = Number(oiEvidence?.callWallStrike ?? oiEvidence?.callWall?.strike ?? NaN);\n        const callWallOi = Number(oiEvidence?.callWallOi ?? oiEvidence?.callWall?.oi ?? NaN);\n        const putWallStrike = Number(oiEvidence?.putWallStrike ?? oiEvidence?.putWall?.strike ?? NaN);\n        const putWallOi = Number(oiEvidence?.putWallOi ?? oiEvidence?.putWall?.oi ?? NaN);\n\n        const audits: any[] = collectH1LiveGateEvidenceAudit(new Date().toISOString()) as any[];\n        const ppdAudit: any = audits\n          .filter((x: any) => x?.identity?.symbol === symbol && x?.ppdSupport?.windows?.length)\n          .sort((a: any, b: any) => String(b?.identity?.observedAt ?? "").localeCompare(String(a?.identity?.observedAt ?? "")))[0] ?? null;\n        const ppd = (ppdAudit?.ppdSupport?.windows ?? []).map((w: any) => ({\n          windowMinutes: w.windowMinutes, usable: w.usable === true, rawPpdPp: w.rawPpdPp ?? null,\n          candidateOrientedPpdPp: w.candidateOrientedPpdPp ?? null, controllingSide: w.controllingSide ?? null,\n          candidateControlledExpansion: w.candidateControlledExpansion === true,\n        }));\n\n        const history: any[] = (session.snapshotHistory ?? []).map((h: any) => ({ at: Date.parse(h.timestamp), value: h?.[symbol] }))\n          .filter((h: any) => Number.isFinite(h.at) && h.value);\n        const currentAt = Date.now();\n        const nearest = (mins: number) => {\n          const target = currentAt - mins * 60_000;\n          let best: any = null; let distance = Number.POSITIVE_INFINITY;\n          for (const h of history) { const d = Math.abs(h.at - target); if (d < distance && d <= 90_000) { best = h.value; distance = d; } }\n          return best;\n        };\n        const pctMove = (from: any, to: any) => Number.isFinite(from) && Number.isFinite(to) && from !== 0 ? ((to - from) / Math.abs(from)) * 100 : null;\n        const timeline: any[] = [{ label: "T0", spotChange: 0, pcrChange: 0, vixChange: 0, state: structure.signal }];\n        for (const mins of [3, 6, 15, 30] as const) {\n          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          timeline.push({\n            label: \`T\${mins}\`,\n            spotChange: prev && Number.isFinite(prev.spot) ? m.spot - prev.spot : null,\n            futureChange: null,\n            pcrChange: prev && Number.isFinite(prev.pcr) && Number.isFinite(m.pcr) ? Number(m.pcr) - Number(prev.pcr) : null,\n            vixChange: prev && Number.isFinite(prev.vix) && Number.isFinite(m.vix) ? Number(m.vix) - Number(prev.vix) : null,\n            cePremiumChangePct: mins === 3 || mins === 6 || mins === 15 ? (ppdWindow?.usable ? ppdWindow.rawPpdPp : null) : null,\n            pePremiumChangePct: null,\n            state: ppdWindow?.usable ? \`PPD \${ppdWindow.controllingSide ?? "—"}\` : null,\n          });\n        }\n\n        const slow: any = TELEGRAM_SLOW_CACHE.get(symbol) as any;\n        const stocks: any[] = Array.isArray(slow?.stocks) ? slow.stocks : [];\n        const changeOf = (s: any) => Number(s?.changePercent ?? s?.changePct ?? s?.percentChange ?? s?.change_percentage ?? NaN);\n        const named = stocks.map((s: any) => ({ name: String(s?.symbol ?? s?.tradingsymbol ?? s?.name ?? "").trim(), change: changeOf(s), sector: String(s?.sector ?? s?.industry ?? "").trim() }))\n          .filter((s: any) => s.name && Number.isFinite(s.change));\n        const top = [...named].sort((a: any, b: any) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);\n        const ups = named.filter((s: any) => s.change > 0).length; const downs = named.filter((s: any) => s.change < 0).length;\n        const heavyweights = named.length ? { summary: \`Up \${ups} / Down \${downs}\`, leaders: top.map((s: any) => \`\${s.name} \${s.change > 0 ? "+" : ""}\${s.change.toFixed(2)}%\`) } : undefined;\n        const sectorRows = new Map<string, number[]>();\n        for (const s of named) if (s.sector) sectorRows.set(s.sector, [...(sectorRows.get(s.sector) ?? []), s.change]);\n        const sectorLeaders = [...sectorRows.entries()].map(([name, moves]) => ({ name, avg: moves.reduce((a, b) => a + b, 0) / moves.length }))\n          .sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg)).slice(0, 4);\n        const sectors = sectorLeaders.length ? { summary: \`Tracked \${sectorRows.size}\`, leaders: sectorLeaders.map((s) => \`\${s.name} \${s.avg > 0 ? "+" : ""}\${s.avg.toFixed(2)}%\`) } : undefined;\n        const regime: any = (buildV2MarketBehaviourRegime(symbol, session, m) as any)?.regime?.currentRegime ?? null;\n\n        const view = buildThreeMinuteFusedTelegramView({\n          symbol, atLabel: istTime(), state: regime ?? structure.signal,\n          numeric: {\n            spot: m.spot, future: fut?.ltp ?? null, basis: fut?.basis ?? null, pcr: m.pcr, vix: m.vix,\n            cePremium: atmCe?.lastPrice ?? null, pePremium: atmPe?.lastPrice ?? null,\n            callWallStrike: Number.isFinite(callWallStrike) ? callWallStrike : null, callWallOi: Number.isFinite(callWallOi) ? callWallOi : null,\n            putWallStrike: Number.isFinite(putWallStrike) ? putWallStrike : null, putWallOi: Number.isFinite(putWallOi) ? putWallOi : null,\n          },\n          families: [\n            { label: "Structure", stance: supportive(structure.evidenceGroups.priceStructure), verified: truthVerified, detail: structure.signal },\n            { label: "Premium", stance: supportive(structure.evidenceGroups.premiumBehaviour), verified: truthVerified, detail: structure.premiums?.current?.alignment ?? null },\n            { label: "OI/PCR", stance: supportive(structure.evidenceGroups.pcrOi), verified: truthVerified, detail: "support only" },\n            { label: "IV/VIX", stance: supportive(structure.evidenceGroups.volatilityContext), verified: truthVerified },\n            { label: "Futures", stance: m.futuresVwapBias === "UP" ? "BULLISH" : m.futuresVwapBias === "DOWN" ? "BEARISH" : "PENDING", verified: m.futuresVwapBias !== "UNKNOWN", detail: m.futuresVwapBias },\n          ],\n          timeline, ppd, heavyweights, sectors, canonicalAction, canonicalCandidateKey: null,\n        });\n        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {\n          await sendAlertSpaced(view.text, symbol);\n          console.log(\`[TELEGRAM_3M_FUSED] \${JSON.stringify({ symbol, state: "SENT", bias: view.bias, stars: view.stars, canonicalAction: view.canonicalAction, ppdWindows: ppd.length, fingerprint: view.fingerprint })}\`);\n        } else {\n          console.log(\`[TELEGRAM_3M_FUSED] \${JSON.stringify({ symbol, state: "SUPPRESSED_UNCHANGED", fingerprint: view.fingerprint })}\`);\n        }\n      }`;
server = replaceOnce(server, insertionPoint, fusedBlock, "3m rich fused alert-cycle wiring");

bridge = replaceOnce(
  bridge,
  'export function isMeaningfulBridgeOwnedTelegramText(text: string): boolean {\n  if (/WHAT MARKET FOLLOWED|OPTIONPILOT MEANINGFUL V1/i.test(text)) return false;',
  'export function isMeaningfulBridgeOwnedTelegramText(text: string): boolean {\n  if (/WHAT MARKET FOLLOWED|OPTIONPILOT MEANINGFUL V1|OPTIONPILOT 3M FUSED VIEW/i.test(text)) return false;',
  "3m fused bridge exemption",
);

if (checkOnly) {
  console.log(server === originalServer && bridge === originalBridge
    ? "telegram 3m rich fused runtime wiring already applied"
    : "telegram 3m rich fused runtime wiring check passed");
  process.exit(0);
}

if (server !== originalServer) fs.writeFileSync(serverFile, server, "utf8");
if (bridge !== originalBridge) fs.writeFileSync(bridgeFile, bridge, "utf8");
console.log(server !== originalServer || bridge !== originalBridge
  ? "telegram 3m rich fused runtime wiring applied"
  : "telegram 3m rich fused runtime wiring already applied");
