import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_MARKET_PULSE_CONCISE_V1";

if (!src.includes(MARKER)) {
  const from = '        view.text += `\\n\\n🧠 WINDOW SUMMARIES\\n${summaryWindows.map((x: any) => x.text).join("\\n")}`;';
  const to = `        // ${MARKER}: concise observation-only 15m pulse; selector/risk/execution remain untouched.\n        const pulseWindow = summaryWindows.find((x: any) => x.windowMinutes === 15);\n        const pulse3 = summaryWindows.find((x: any) => x.windowMinutes === 3);\n        const pulse6 = summaryWindows.find((x: any) => x.windowMinutes === 6);\n        const ppdNow = ppd.filter((x: any) => x?.usable).map((x: any) => \\`\\${x.windowMinutes}m \\${x.controllingSide ?? "—"} \\${Number.isFinite(x.candidateOrientedPpdPp) ? Number(x.candidateOrientedPpdPp).toFixed(2)+"pp" : "—"}\\`).join(" | ") || "—";\n        const breadthNow = named.length ? \\`HW Up \\${ups}/Down \\${downs}\\` : "HW —";\n        const directionNow = pulseWindow?.direction && pulseWindow.direction !== "NOT_READY" ? pulseWindow.direction : (pulse6?.direction !== "NOT_READY" ? pulse6?.direction : pulse3?.direction ?? "NOT_READY");\n        view.text = [\n          \\`📊 MARKET PULSE | \\${symbol} | \\${istTime()}\\`,\n          \\`Spot \\${Number(m.spot).toFixed(2)} | Fut \\${Number.isFinite(fut?.ltp) ? Number(fut.ltp).toFixed(2) : "—"} | PCR \\${Number.isFinite(m.pcr) ? Number(m.pcr).toFixed(3) : "—"} | VIX \\${Number.isFinite(m.vix) ? Number(m.vix).toFixed(2) : "—"}\\`,\n          \\`Direction: \\${directionNow ?? "NOT_READY"} | PPD: \\${ppdNow}\\`,\n          \\`Premium: CE ₹\\${Number.isFinite(atmCe?.lastPrice) ? Number(atmCe.lastPrice).toFixed(2) : "—"} | PE ₹\\${Number.isFinite(atmPe?.lastPrice) ? Number(atmPe.lastPrice).toFixed(2) : "—"}\\`,\n          \\`Breadth: \\${breadthNow}\\`,\n          \\`Verdict: \\${view.canonicalAction === "WAIT" ? "WATCH / NO TRADE" : view.canonicalAction.replace("_", " ")} | Quality \\${view.stars}/5\\`,\n          \\`15m evidence: \\${pulseWindow?.direction ?? "NOT_READY"} | selector authority unchanged\\`,\n        ].join("\\n");`;
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`concise market pulse anchor count=${count}`);
  src = src.replace(from, to);
}

if (checkOnly) {
  console.log(src === original ? "concise market pulse wiring already applied" : "concise market pulse wiring check passed");
  process.exit(0);
}
if (src !== original) fs.writeFileSync(file, src, "utf8");
console.log(src !== original ? "concise market pulse wiring applied" : "concise market pulse wiring already applied");
