import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_BUSINESS_WATCH_V1";

if (!src.includes(MARKER)) {
  const anchor = '        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {';
  const count = src.split(anchor).length - 1;
  if (count === 0) throw new Error("business watch anchor: source occurrence not found");

  const block = [
    `        // ${MARKER}: observation-only business decision support. Never creates or modifies orders.`,
    '        {',
    '          const t3: any = timeline.find((p: any) => p.label === "T3") ?? null;',
    '          const t6: any = timeline.find((p: any) => p.label === "T6") ?? null;',
    '          const p3: any = ppd.find((p: any) => p.windowMinutes === 3 && p.usable) ?? null;',
    '          const watchSide = symbol === "BANKNIFTY" ? null : (view.bias === "BULLISH" ? "CE" : view.bias === "BEARISH" ? "PE" : null);',
    '          const opt: any = watchSide === "CE" ? atmCe : watchSide === "PE" ? atmPe : null;',
    '          const bid = Number(opt?.bid); const ask = Number(opt?.ask);',
    '          const spreadPct = Number.isFinite(bid) && Number.isFinite(ask) && ask > 0 && ask >= bid ? ((ask - bid) / ask) * 100 : null;',
    '          const fmt = (v: any, d=2, suffix="") => Number.isFinite(Number(v)) ? `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(d)}${suffix}` : "—";',
    '          const contract = String(opt?.tradingSymbol ?? opt?.tradingsymbol ?? "ATM contract");',
    '          const sideAligned = !!watchSide && p3?.controllingSide === watchSide;',
    '          const meaning = !watchSide ? "No clear CE/PE control yet — continue observation." : sideAligned ? `${watchSide} watch: directional pressure and 3m premium control are aligned.` : `${watchSide} watch: directional pressure is present, but 3m premium control is not fully aligned yet.`;',
    '          view.text += `\\n\\n🎯 BUSINESS WATCH\\n${watchSide ? `WATCH ${watchSide}` : "NO CLEAR WATCH"} • Observation only\\n3M Fut ${fmt(t3?.futureChange)} | CE ${fmt(t3?.cePremiumChangePct,1,"%")} | PE ${fmt(t3?.pePremiumChangePct,1,"%")}\\n3M OI: CE ${fmt(t3?.ceOiChangePct,1,"%")} | PE ${fmt(t3?.peOiChangePct,1,"%")} | PCR Δ ${fmt(t3?.pcrChange,3)}\\n6M Fut ${fmt(t6?.futureChange)} | CE ${fmt(t6?.cePremiumChangePct,1,"%")} | PE ${fmt(t6?.pePremiumChangePct,1,"%")}\\nPPD 3M: ${p3 ? `${fmt(p3.candidateOrientedPpdPp,2,"pp")} ${p3.controllingSide ?? "—"}` : "—"}\\nObserved contract: ${watchSide ? contract : "—"} | LTP ${watchSide ? fmt(opt?.lastPrice,2) : "—"} | Delta ${watchSide ? fmt(opt?.delta,3) : "—"} | Spread ${watchSide && spreadPct !== null ? spreadPct.toFixed(2)+"%" : "—"}\\nWalls: CE ${callWallStrike ?? "—"} | PE ${putWallStrike ?? "—"}\\nMeaning: ${meaning}\\nAction: WATCH ONLY — no BUY/SELL order.`;',
    '          console.log(`[TELEGRAM_BUSINESS_WATCH] ${JSON.stringify({symbol, watchSide: watchSide ?? "NONE", contract: watchSide ? contract : null, sideAligned, createsOrders:false})}`);',
    '        }',
    '',
    ''
  ].join("\n");

  src = src.replace(anchor, block + anchor);
}

if (checkOnly) {
  console.log(src === original ? "telegram business watch wiring already applied" : "telegram business watch wiring check passed");
  process.exit(0);
}
if (src !== original) fs.writeFileSync(file, src, "utf8");
console.log(src !== original ? "telegram business watch wiring applied" : "telegram business watch wiring already applied");
