import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const serverFile=path.resolve(root,"server.ts");
const checkOnly=process.argv.includes("--check");
let server=fs.readFileSync(serverFile,"utf8");
const original=server;
function replaceOnce(src,from,to,label){if(src.includes(to))return src;const count=src.split(from).length-1;if(count===0)throw new Error(`${label}: source occurrence not found`);return src.replace(from,to);}

// Import wiring must remain order-independent: other safe runtime patches may add
// their own imports before this script runs. Insert after the final top-level import.
const windowImport='import { buildWindowSummary, buildEodBehaviourSummary } from "./telegram-window-summary-v1.js";';
const contractHistoryImport='import { buildContractBoundHistoryPoint, buildContractPairIdentity } from "./telegram-contract-history-bridge-v1.js";';
for(const requiredImport of [windowImport,contractHistoryImport]){
if(!server.includes(requiredImport)){
  const importMatches=[...server.matchAll(/^import[^\n]*;$/gm)];
  const lastImport=importMatches.at(-1);
  if(!lastImport || lastImport.index==null)throw new Error("window summary import: no top-level import anchor found");
  const insertAt=lastImport.index+lastImport[0].length;
  server=server.slice(0,insertAt)+`\n${requiredImport}`+server.slice(insertAt);
}
}

server=replaceOnce(server,
'const TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();',
'const TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();\nconst TELEGRAM_EOD_BEHAVIOUR_SENT = new Set<string>();',
"eod summary dedup singleton");

server=replaceOnce(server,
'            cePremiumChangePct: mins === 3 || mins === 6 || mins === 15 ? (ppdWindow?.usable ? ppdWindow.rawPpdPp : null) : null,\n            pePremiumChangePct: null,',
'            cePremiumChangePct: contractHistory.cePremiumChangePct,\n            pePremiumChangePct: contractHistory.pePremiumChangePct,\n            ceOiChangePct: contractHistory.ceOiChangePct,\n            peOiChangePct: contractHistory.peOiChangePct,\n            ceIvChange: contractHistory.ceIvChange,\n            peIvChange: contractHistory.peIvChange,',
"remove PPD-as-CE mislabel");

server=replaceOnce(server,
'          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          timeline.push({',
'          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          const contractHistory = buildContractBoundHistoryPoint({ symbol, previousSnapshot: prev, currentCe: atmCe, currentPe: atmPe, currentFuture: fut });\n          timeline.push({',
"derive exact contract-bound history");

server=replaceOnce(server,
'            futureChange: null,',
'            futureChange: contractHistory.futureChange,',
"exact futures history");

server=replaceOnce(server,
'            cePremium: atmCe?.lastPrice ?? null, pePremium: atmPe?.lastPrice ?? null,\n            callWallStrike, callWallStrength, putWallStrike, putWallStrength,',
'            cePremium: trackedPair.ready ? atmCe?.lastPrice ?? null : null, pePremium: trackedPair.ready ? atmPe?.lastPrice ?? null : null,\n            premiumPairIdentity: trackedPair.label,\n            ceOi: trackedPair.ready ? atmCe?.oi ?? null : null, peOi: trackedPair.ready ? atmPe?.oi ?? null : null,\n            ceIv: trackedPair.ready ? atmCe?.iv ?? null : null, peIv: trackedPair.ready ? atmPe?.iv ?? null : null,\n            atmIv: trackedPair.ready && Number(atmCe?.iv) > 0 && Number(atmPe?.iv) > 0 ? (Number(atmCe.iv) + Number(atmPe.iv)) / 2 : null,\n            ceBid: trackedPair.ready ? atmCe?.bid ?? null : null, ceAsk: trackedPair.ready ? atmCe?.ask ?? null : null,\n            peBid: trackedPair.ready ? atmPe?.bid ?? null : null, peAsk: trackedPair.ready ? atmPe?.ask ?? null : null,\n            ceVolume: trackedPair.ready ? atmCe?.volume ?? null : null, peVolume: trackedPair.ready ? atmPe?.volume ?? null : null,\n            ceDelta: trackedPair.ready ? atmCe?.delta ?? null : null, peDelta: trackedPair.ready ? atmPe?.delta ?? null : null,\n            ceGamma: trackedPair.ready ? atmCe?.gamma ?? null : null, peGamma: trackedPair.ready ? atmPe?.gamma ?? null : null,\n            ceTheta: trackedPair.ready ? atmCe?.theta ?? null : null, peTheta: trackedPair.ready ? atmPe?.theta ?? null : null,\n            ceVega: trackedPair.ready ? atmCe?.vega ?? null : null, peVega: trackedPair.ready ? atmPe?.vega ?? null : null,\n            callWallStrike, callWallStrength, putWallStrike, putWallStrength,',
"exact current premium pair fields");

server=replaceOnce(server,
'        const view = buildThreeMinuteFusedTelegramView({',
'        const summaryWindows = ([3, 6, 15, 30, 60] as const).map((mins) => {\n          const point: any = timeline.find((p: any) => p.label === `T${mins}`) ?? null;\n          const summaryPrevious: any = point ? null : nearest(mins);\n          const summaryFallback = point ? null : buildContractBoundHistoryPoint({ symbol, previousSnapshot: summaryPrevious, currentCe: atmCe, currentPe: atmPe, currentFuture: fut });\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          return buildWindowSummary({\n            windowMinutes: mins,\n            spotChange: point?.spotChange ?? (summaryPrevious && Number.isFinite(summaryPrevious.spot) ? Number(m.spot) - Number(summaryPrevious.spot) : null),\n            futureChange: point?.futureChange ?? summaryFallback?.futureChange ?? null,\n            pcrChange: point?.pcrChange ?? (summaryPrevious && Number.isFinite(summaryPrevious.pcr) && Number.isFinite(m.pcr) ? Number(m.pcr) - Number(summaryPrevious.pcr) : null),\n            vixChange: point?.vixChange ?? (summaryPrevious && Number.isFinite(summaryPrevious.vix) && Number.isFinite(m.vix) ? Number(m.vix) - Number(summaryPrevious.vix) : null),\n            cePremiumChangePct: point?.cePremiumChangePct ?? summaryFallback?.cePremiumChangePct ?? null,\n            pePremiumChangePct: point?.pePremiumChangePct ?? summaryFallback?.pePremiumChangePct ?? null,\n            ppdSide: ppdWindow?.usable ? ppdWindow.controllingSide ?? null : null,\n            ppdValuePp: ppdWindow?.usable ? ppdWindow.candidateOrientedPpdPp ?? null : null,\n            heavyweightUp: named.length ? ups : null, heavyweightDown: named.length ? downs : null,\n          });\n        });\n\n        const trackedPair = buildContractPairIdentity(symbol, atmCe, atmPe);\n        const view = buildThreeMinuteFusedTelegramView({',
"build window summaries");

server=replaceOnce(server,
'        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
'        view.text += `\\n\\n🧠 WINDOW SUMMARIES\\n${summaryWindows.map((x: any) => x.text).join("\\n")}`;\n        console.log(`[TELEGRAM_WINDOW_SUMMARY] ${JSON.stringify({ symbol, summaries: summaryWindows.map((x: any) => ({ windowMinutes: x.windowMinutes, direction: x.direction, evidenceCount: x.evidenceCount })) })}`);\n        const pulseMinute = Number(istPart("minute"));\n        const pulseDue = Number.isFinite(pulseMinute) && pulseMinute % 15 === 0;\n        if (pulseDue && TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
"append summaries to fused message with 15m cadence");

server=replaceOnce(server,
'        } else {\n          console.log(`[TELEGRAM_3M_FUSED] ${JSON.stringify({ symbol, state: "SUPPRESSED_UNCHANGED", wallSource: wallCurrent ? "VERIFIED" : "UNAVAILABLE", fingerprint: view.fingerprint })}`);\n        }\n      }',
'        } else {\n          console.log(`[TELEGRAM_3M_FUSED] ${JSON.stringify({ symbol, state: pulseDue ? "SUPPRESSED_UNCHANGED" : "SUPPRESSED_15M_CADENCE", wallSource: wallCurrent ? "VERIFIED" : "UNAVAILABLE", fingerprint: view.fingerprint })}`);\n        }\n\n        // One post-close behavioural summary per symbol/day, using verified data already accumulated by the live session.\n        const istMinuteOfDay = Number(istPart("hour")) * 60 + Number(istPart("minute"));\n        const eodKey = `${wallDate}:${symbol}`;\n        if (istMinuteOfDay >= 931 && !TELEGRAM_EOD_BEHAVIOUR_SENT.has(eodKey)) {\n          const phaseMove = (label: string, minsAgo: number) => {\n            const p: any = nearest(minsAgo);\n            if (!p || !Number.isFinite(p.spot) || !Number.isFinite(m.spot)) return `${label} history unavailable`;\n            const move = Number(m.spot) - Number(p.spot);\n            return `${label}→close spot ${move > 0 ? "+" : ""}${move.toFixed(2)} pts`;\n          };\n          const finalPpd = ppd.filter((x: any) => x?.usable).map((x: any) => `${x.windowMinutes}m ${x.controllingSide ?? "—"} ${Number.isFinite(x.candidateOrientedPpdPp) ? Number(x.candidateOrientedPpdPp).toFixed(2)+"pp" : "—"}`).join(" | ") || "—";\n          const closeDetail = `Spot ${Number(m.spot).toFixed(2)} | Fut ${Number.isFinite(fut?.ltp) ? Number(fut.ltp).toFixed(2) : "—"} | PCR ${Number.isFinite(m.pcr) ? Number(m.pcr).toFixed(3) : "—"} | VIX ${Number.isFinite(m.vix) ? Number(m.vix).toFixed(2) : "—"} | CE wall ${callWallStrike ?? "—"}/${callWallStrength ?? "—"} | PE wall ${putWallStrike ?? "—"}/${putWallStrength ?? "—"} | PPD ${finalPpd} | HW Up ${ups}/Down ${downs}`;\n          const eodText = buildEodBehaviourSummary({\n            symbol, summaries: summaryWindows,\n            opening: phaseMove("Opening", 375), morning: phaseMove("Morning", 300), midday: phaseMove("Midday", 180), afternoon: phaseMove("Afternoon", 60), close: closeDetail,\n          });\n          await sendAlertSpaced(eodText, symbol);\n          TELEGRAM_EOD_BEHAVIOUR_SENT.add(eodKey);\n          console.log(`[TELEGRAM_EOD_BEHAVIOUR] ${JSON.stringify({ symbol, state: "SENT", date: wallDate, summaries: summaryWindows.map((x: any) => x.direction) })}`);\n        }\n      }',
"post-close eod behaviour summary");

if(checkOnly){console.log(server===original?"telegram window summary runtime wiring already applied":"telegram window summary runtime wiring check passed");process.exit(0);}
if(server!==original)fs.writeFileSync(serverFile,server,"utf8");
console.log(server!==original?"telegram window summary runtime wiring applied":"telegram window summary runtime wiring already applied");
