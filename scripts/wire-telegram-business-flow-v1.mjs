import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_BUSINESS_FLOW_V1";

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

if (!src.includes(MARKER)) {
  const timelineAnchor = '        const timeline: any[] = [{ label: "T0", spotChange: 0, pcrChange: 0, vixChange: 0, state: structure.signal }];';
  const helpers = `        // ${MARKER}: reuse existing 3-minute snapshot history; no timer/polling loop.\n        const pctChange = (current: any, previous: any) => {\n          const c = Number(current); const p = Number(previous);\n          return Number.isFinite(c) && Number.isFinite(p) && p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null;\n        };\n        const sameOptionFrom = (snapshot: any, currentOption: any, side: "CE" | "PE") => {\n          if (!snapshot || !currentOption) return null;\n          const exp: any = v2CurrentExpiry(snapshot);\n          const rows: any[] = side === "CE" ? (exp?.ceStrikes ?? []) : (exp?.peStrikes ?? []);\n          const token = Number(currentOption?.instrumentToken ?? currentOption?.exchangeToken ?? NaN);\n          const symbolKey = String(currentOption?.tradingSymbol ?? currentOption?.tradingsymbol ?? "");\n          const strike = Number(currentOption?.strike ?? NaN);\n          return rows.find((r: any) => Number.isFinite(token) && Number(r?.instrumentToken ?? r?.exchangeToken) === token)\n            ?? rows.find((r: any) => symbolKey && String(r?.tradingSymbol ?? r?.tradingsymbol ?? "") === symbolKey)\n            ?? rows.find((r: any) => Number.isFinite(strike) && Number(r?.strike) === strike)\n            ?? rows.find((r: any) => r?.isAtm)\n            ?? null;\n        };\n        const timeline: any[] = [{ label: "T0", spotChange: 0, futureChange: 0, pcrChange: 0, vixChange: 0, cePremiumChangePct: 0, pePremiumChangePct: 0, ceOiChangePct: 0, peOiChangePct: 0, ceIvChange: 0, peIvChange: 0, state: structure.signal }];`;
  replaceOnce(timelineAnchor, helpers, "business-flow timeline helper");

  const prevAnchor = '          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);';
  const prevReplacement = `          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          const prevCe: any = sameOptionFrom(prev, atmCe, "CE");\n          const prevPe: any = sameOptionFrom(prev, atmPe, "PE");\n          const prevFut: any = prev?.futuresContracts?.[0] ?? null;`;
  replaceOnce(prevAnchor, prevReplacement, "business-flow previous option lookup");

  replaceOnce('            futureChange: null,', '            futureChange: prevFut && Number(prevFut?.ltp) > 0 && Number(fut?.ltp) > 0 ? Number(fut.ltp) - Number(prevFut.ltp) : null,', "business-flow futures change");
  replaceOnce('            cePremiumChangePct: mins === 3 || mins === 6 || mins === 15 ? (ppdWindow?.usable ? ppdWindow.rawPpdPp : null) : null,\n            pePremiumChangePct: null,', '            cePremiumChangePct: pctChange(atmCe?.lastPrice, prevCe?.lastPrice),\n            pePremiumChangePct: pctChange(atmPe?.lastPrice, prevPe?.lastPrice),\n            ceOiChangePct: pctChange(atmCe?.oi, prevCe?.oi),\n            peOiChangePct: pctChange(atmPe?.oi, prevPe?.oi),\n            ceIvChange: Number.isFinite(Number(atmCe?.iv)) && Number.isFinite(Number(prevCe?.iv)) ? Number(atmCe.iv) - Number(prevCe.iv) : null,\n            peIvChange: Number.isFinite(Number(atmPe?.iv)) && Number.isFinite(Number(prevPe?.iv)) ? Number(atmPe.iv) - Number(prevPe.iv) : null,', "remove PPD-as-premium semantic bug");

  const numericAnchor = '            cePremium: atmCe?.lastPrice ?? null, pePremium: atmPe?.lastPrice ?? null,\n            callWallStrike, callWallStrength, putWallStrike, putWallStrength,';
  const numericReplacement = `            cePremium: atmCe?.lastPrice ?? null, pePremium: atmPe?.lastPrice ?? null,\n            pcrFullChain: m.pcr ?? null,\n            pcrPlusMinus7: null, pcrAtmNear: null, pcrChangeOi: null, pcrVolume: null, pcrCurrentExpiry: null, pcrNextExpiry: null,\n            ceOi: atmCe?.oi ?? null, peOi: atmPe?.oi ?? null,\n            ceIv: atmCe?.iv ?? null, peIv: atmPe?.iv ?? null,\n            atmIv: Number.isFinite(Number(atmCe?.iv)) && Number.isFinite(Number(atmPe?.iv)) ? (Number(atmCe.iv) + Number(atmPe.iv)) / 2 : null,\n            ceBid: atmCe?.bid ?? null, ceAsk: atmCe?.ask ?? null, peBid: atmPe?.bid ?? null, peAsk: atmPe?.ask ?? null,\n            ceVolume: atmCe?.volume ?? null, peVolume: atmPe?.volume ?? null,\n            ceDelta: atmCe?.delta ?? null, peDelta: atmPe?.delta ?? null,\n            ceGamma: atmCe?.gamma ?? null, peGamma: atmPe?.gamma ?? null,\n            ceTheta: atmCe?.theta ?? null, peTheta: atmPe?.theta ?? null,\n            ceVega: atmCe?.vega ?? null, peVega: atmPe?.vega ?? null,\n            callWallStrike, callWallStrength, putWallStrike, putWallStrength,`;
  replaceOnce(numericAnchor, numericReplacement, "business-flow current option metrics");
}

if (checkOnly) {
  console.log(src === original ? "telegram business-flow wiring already applied" : "telegram business-flow wiring check passed");
  process.exit(0);
}
if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram business-flow wiring applied");
} else {
  console.log("telegram business-flow wiring already applied");
}
