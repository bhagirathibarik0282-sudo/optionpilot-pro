import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const serverFile=path.resolve(root,"server.ts");
const checkOnly=process.argv.includes("--check");
let server=fs.readFileSync(serverFile,"utf8");
const original=server;
function replaceOnce(src,from,to,label){const count=src.split(from).length-1;if(count===0&&src.includes(to))return src;if(count!==1)throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);return src.replace(from,to);}

server=replaceOnce(server,
'import { buildThreeMinuteFusedTelegramView, ThreeMinuteFusedDedup } from "./telegram-3m-fused-monitor.js";',
'import { buildThreeMinuteFusedTelegramView, ThreeMinuteFusedDedup } from "./telegram-3m-fused-monitor.js";\nimport { buildWindowSummary, buildEodBehaviourSummary } from "./telegram-window-summary-v1.js";',
"window summary import");

server=replaceOnce(server,
'const TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();',
'const TELEGRAM_3M_FUSED_DEDUP = new ThreeMinuteFusedDedup();\nconst TELEGRAM_EOD_BEHAVIOUR_SENT = new Set<string>();',
"eod summary dedup singleton");

server=replaceOnce(server,
'            cePremiumChangePct: mins === 3 || mins === 6 || mins === 15 ? (ppdWindow?.usable ? ppdWindow.rawPpdPp : null) : null,\n            pePremiumChangePct: null,',
'            cePremiumChangePct: null,\n            pePremiumChangePct: null,',
"remove PPD-as-CE mislabel");

server=replaceOnce(server,
'        const view = buildThreeMinuteFusedTelegramView({',
'        const summaryWindows = ([3, 6, 15, 30, 60] as const).map((mins) => {\n          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          return buildWindowSummary({\n            windowMinutes: mins,\n            spotChange: prev && Number.isFinite(prev.spot) ? Number(m.spot) - Number(prev.spot) : null,\n            futureChange: null,\n            pcrChange: prev && Number.isFinite(prev.pcr) && Number.isFinite(m.pcr) ? Number(m.pcr) - Number(prev.pcr) : null,\n            vixChange: prev && Number.isFinite(prev.vix) && Number.isFinite(m.vix) ? Number(m.vix) - Number(prev.vix) : null,\n            cePremiumChangePct: null, pePremiumChangePct: null,\n            ppdSide: ppdWindow?.usable ? ppdWindow.controllingSide ?? null : null,\n            ppdValuePp: ppdWindow?.usable ? ppdWindow.candidateOrientedPpdPp ?? null : null,\n            heavyweightUp: named.length ? ups : null, heavyweightDown: named.length ? downs : null,\n          });\n        });\n\n        const view = buildThreeMinuteFusedTelegramView({',
"build window summaries");

server=replaceOnce(server,
'        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
'        view.text += `\\n\\n🧠 WINDOW SUMMARIES\\n${summaryWindows.map((x: any) => x.text).join("\\n")}`;\n        console.log(`[TELEGRAM_WINDOW_SUMMARY] ${JSON.stringify({ symbol, summaries: summaryWindows.map((x: any) => ({ windowMinutes: x.windowMinutes, direction: x.direction, evidenceCount: x.evidenceCount })) })}`);\n        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
"append summaries to fused message");

server=replaceOnce(server,
'        } else {\n          console.log(`[TELEGRAM_3M_FUSED] ${JSON.stringify({ symbol, state: "SUPPRESSED_UNCHANGED", wallSource: wallCurrent ? "VERIFIED" : "UNAVAILABLE", fingerprint: view.fingerprint })}`);\n        }\n      }',
'        } else {\n          console.log(`[TELEGRAM_3M_FUSED] ${JSON.stringify({ symbol, state: "SUPPRESSED_UNCHANGED", wallSource: wallCurrent ? "VERIFIED" : "UNAVAILABLE", fingerprint: view.fingerprint })}`);\n        }\n\n        // One post-close behavioural summary per symbol/day, using verified data already accumulated by the live session.\n        const istMinuteOfDay = Number(istPart("hour")) * 60 + Number(istPart("minute"));\n        const eodKey = `${wallDate}:${symbol}`;\n        if (istMinuteOfDay >= 931 && !TELEGRAM_EOD_BEHAVIOUR_SENT.has(eodKey)) {\n          const phaseMove = (label: string, minsAgo: number) => {\n            const p: any = nearest(minsAgo);\n            if (!p || !Number.isFinite(p.spot) || !Number.isFinite(m.spot)) return `${label} history unavailable`;\n            const move = Number(m.spot) - Number(p.spot);\n            return `${label}→close spot ${move > 0 ? "+" : ""}${move.toFixed(2)} pts`;\n          };\n          const finalPpd = ppd.filter((x: any) => x?.usable).map((x: any) => `${x.windowMinutes}m ${x.controllingSide ?? "—"} ${Number.isFinite(x.candidateOrientedPpdPp) ? Number(x.candidateOrientedPpdPp).toFixed(2)+"pp" : "—"}`).join(" | ") || "—";\n          const closeDetail = `Spot ${Number(m.spot).toFixed(2)} | Fut ${Number.isFinite(fut?.ltp) ? Number(fut.ltp).toFixed(2) : "—"} | PCR ${Number.isFinite(m.pcr) ? Number(m.pcr).toFixed(3) : "—"} | VIX ${Number.isFinite(m.vix) ? Number(m.vix).toFixed(2) : "—"} | CE wall ${callWallStrike ?? "—"}/${callWallStrength ?? "—"} | PE wall ${putWallStrike ?? "—"}/${putWallStrength ?? "—"} | PPD ${finalPpd} | HW Up ${ups}/Down ${downs}`;\n          const eodText = buildEodBehaviourSummary({\n            symbol, summaries: summaryWindows,\n            opening: phaseMove("Opening", 375), morning: phaseMove("Morning", 300), midday: phaseMove("Midday", 180), afternoon: phaseMove("Afternoon", 60), close: closeDetail,\n          });\n          await sendAlertSpaced(eodText, symbol);\n          TELEGRAM_EOD_BEHAVIOUR_SENT.add(eodKey);\n          console.log(`[TELEGRAM_EOD_BEHAVIOUR] ${JSON.stringify({ symbol, state: "SENT", date: wallDate, summaries: summaryWindows.map((x: any) => x.direction) })}`);\n        }\n      }',
"post-close eod behaviour summary");

if(checkOnly){console.log(server===original?"telegram window summary runtime wiring already applied":"telegram window summary runtime wiring check passed");process.exit(0);}
if(server!==original)fs.writeFileSync(serverFile,server,"utf8");
console.log(server!==original?"telegram window summary runtime wiring applied":"telegram window summary runtime wiring already applied");
await import("./wire-telegram-business-watch-v1.mjs");
