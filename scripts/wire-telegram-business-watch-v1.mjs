import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_BUSINESS_WATCH_ZSCORE_V1";

const importLine = 'import { updateWatchZScore } from "./telegram-watch-zscore-v1.js";';
if (!src.includes(importLine)) {
  const importAnchor = 'import { buildThreeMinuteFusedTelegramView, ThreeMinuteFusedDedup } from "./telegram-3m-fused-monitor.js";';
  if (!src.includes(importAnchor)) throw new Error("business watch Z import anchor not found");
  src = src.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

if (!src.includes(MARKER)) {
  const anchor = '        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {';
  if (!src.includes(anchor)) throw new Error("business watch anchor: source occurrence not found");

  const block = [
    `        // ${MARKER}: observation-only Z-managed business decision support. Never creates or modifies orders.`,
    '        {',
    '          const t3: any = timeline.find((p: any) => p.label === "T3") ?? null;',
    '          const p3: any = ppd.find((p: any) => p.windowMinutes === 3 && p.usable) ?? null;',
    '          const spreadOf = (o: any) => { const bid = Number(o?.bid); const ask = Number(o?.ask); return Number.isFinite(bid) && Number.isFinite(ask) && ask > 0 && ask >= bid ? ((ask - bid) / ask) * 100 : null; };',
    '          const ceSpread = spreadOf(atmCe); const peSpread = spreadOf(atmPe);',
    '          const riskSpread = [ceSpread, peSpread].filter((x: any) => Number.isFinite(x)).sort((a: number,b: number) => b-a)[0] ?? null;',
    '          const z = updateWatchZScore({',
    '            symbol,',
    '            spot3m: t3?.spotChange ?? null, future3m: t3?.futureChange ?? null,',
    '            cePremium3m: t3?.cePremiumChangePct ?? null, pePremium3m: t3?.pePremiumChangePct ?? null,',
    '            ceOi3m: t3?.ceOiChangePct ?? null, peOi3m: t3?.peOiChangePct ?? null,',
    '            pcr3m: t3?.pcrChange ?? null, vix3m: t3?.vixChange ?? null,',
    '            ppd3m: p3?.candidateOrientedPpdPp ?? null, ppdSide: p3?.controllingSide ?? null,',
    '            spreadPct: riskSpread,',
    '          });',
    '          const watchSide = symbol === "BANKNIFTY" ? null : z.watchSide;',
    '          const opt: any = watchSide === "CE" ? atmCe : watchSide === "PE" ? atmPe : null;',
    '          const spreadPct = spreadOf(opt);',
    '          const fmt = (v: any, d=2, suffix="") => Number.isFinite(Number(v)) ? `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(d)}${suffix}` : "—";',
    '          const zfmt = (name: any) => z.metrics[name]?.z === null || z.metrics[name]?.z === undefined ? "Z—" : `Z${fmt(z.metrics[name].z,2)}`;',
    '          const contract = String(opt?.tradingSymbol ?? opt?.tradingsymbol ?? "ATM contract");',
    '          const meaning = symbol === "BANKNIFTY" ? "BANKNIFTY is context-only; no CE/PE business watch side." : z.note;',
    '          view.text += `\\n\\n🎯 Z-SCORE BUSINESS WATCH\\n${watchSide ? `WATCH ${watchSide}` : z.ready ? "NO CLEAR WATCH" : "Z NOT READY"} • Observation only\\nSpot3M ${fmt(t3?.spotChange)} (${zfmt("spot3m")}) | Fut3M ${fmt(t3?.futureChange)} (${zfmt("future3m")})\\nCE Prem ${fmt(t3?.cePremiumChangePct,1,"%")} (${zfmt("cePremium3m")}) | PE Prem ${fmt(t3?.pePremiumChangePct,1,"%")} (${zfmt("pePremium3m")})\\nCE OI ${fmt(t3?.ceOiChangePct,1,"%")} (${zfmt("ceOi3m")}) | PE OI ${fmt(t3?.peOiChangePct,1,"%")} (${zfmt("peOi3m")})\\nPCR Δ ${fmt(t3?.pcrChange,3)} (${zfmt("pcr3m")}) | VIX Δ ${fmt(t3?.vixChange,2)} (${zfmt("vix3m")})\\nPPD3M ${p3 ? `${fmt(p3.candidateOrientedPpdPp,2,"pp")} ${p3.controllingSide ?? "—"}` : "—"} (${zfmt("ppd3m")})\\nDirectional Z: ${z.directionalScore === null ? "—" : fmt(z.directionalScore,2)}\\nObserved contract: ${watchSide ? contract : "—"} | LTP ${watchSide ? fmt(opt?.lastPrice,2) : "—"} | Delta ${watchSide ? fmt(opt?.delta,3) : "—"} | Spread ${watchSide && spreadPct !== null ? spreadPct.toFixed(2)+"%" : "—"} (${zfmt("spreadPct")})\\nWalls: CE ${callWallStrike ?? "—"} | PE ${putWallStrike ?? "—"} • migration/event context, not forced into Z\\nMeaning: ${meaning}\\nAction: WATCH ONLY — no BUY/SELL order.`;',
    '          console.log(`[TELEGRAM_BUSINESS_WATCH_Z] ${JSON.stringify({symbol, zReady:z.ready, watchSide: watchSide ?? "NONE", directionalScore:z.directionalScore, contract: watchSide ? contract : null, createsOrders:false})}`);',
    '        }',
    '',
    ''
  ].join("\n");

  src = src.replace(anchor, block + anchor);
}

if (checkOnly) {
  console.log(src === original ? "telegram Z business watch wiring already applied" : "telegram Z business watch wiring check passed");
  process.exit(0);
}
if (src !== original) fs.writeFileSync(file, src, "utf8");
console.log(src !== original ? "telegram Z business watch wiring applied" : "telegram Z business watch wiring already applied");
