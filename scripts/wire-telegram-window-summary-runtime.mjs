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
'import { buildThreeMinuteFusedTelegramView, ThreeMinuteFusedDedup } from "./telegram-3m-fused-monitor.js";\nimport { buildWindowSummary } from "./telegram-window-summary-v1.js";',
"window summary import");

server=replaceOnce(server,
'            cePremiumChangePct: mins === 3 || mins === 6 || mins === 15 ? (ppdWindow?.usable ? ppdWindow.rawPpdPp : null) : null,\n            pePremiumChangePct: null,',
'            cePremiumChangePct: null,\n            pePremiumChangePct: null,',
"remove PPD-as-CE mislabel");

server=replaceOnce(server,
'        const view = buildThreeMinuteFusedTelegramView({',
'        const summaryWindows = ([3, 6, 15, 30, 60] as const).map((mins) => {\n          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);\n          return buildWindowSummary({\n            windowMinutes: mins,\n            spotChange: prev && Number.isFinite(prev.spot) ? Number(m.spot) - Number(prev.spot) : null,\n            futureChange: null,\n            pcrChange: prev && Number.isFinite(prev.pcr) && Number.isFinite(m.pcr) ? Number(m.pcr) - Number(prev.pcr) : null,\n            vixChange: prev && Number.isFinite(prev.vix) && Number.isFinite(m.vix) ? Number(m.vix) - Number(prev.vix) : null,\n            cePremiumChangePct: null,\n            pePremiumChangePct: null,\n            ppdSide: ppdWindow?.usable ? ppdWindow.controllingSide ?? null : null,\n            ppdValuePp: ppdWindow?.usable ? ppdWindow.candidateOrientedPpdPp ?? null : null,\n            heavyweightUp: named.length ? ups : null,\n            heavyweightDown: named.length ? downs : null,\n          });\n        });\n\n        const view = buildThreeMinuteFusedTelegramView({',
"build window summaries");

server=replaceOnce(server,
'        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
'        view.text += `\\n\\n🧠 WINDOW SUMMARIES\\n${summaryWindows.map((x: any) => x.text).join("\\n")}`;\n        console.log(`[TELEGRAM_WINDOW_SUMMARY] ${JSON.stringify({ symbol, summaries: summaryWindows.map((x: any) => ({ windowMinutes: x.windowMinutes, direction: x.direction, evidenceCount: x.evidenceCount })) })}`);\n        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {',
"append summaries to fused message");

if(checkOnly){console.log(server===original?"telegram window summary runtime wiring already applied":"telegram window summary runtime wiring check passed");process.exit(0);}
if(server!==original)fs.writeFileSync(serverFile,server,"utf8");
console.log(server!==original?"telegram window summary runtime wiring applied":"telegram window summary runtime wiring already applied");
