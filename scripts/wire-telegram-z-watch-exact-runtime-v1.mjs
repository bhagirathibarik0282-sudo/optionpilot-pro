import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_BUSINESS_WATCH_EXACT_Z_V1";
const LEGACY_MARKER = "OPTIONPILOT_TELEGRAM_BUSINESS_WATCH_ZSCORE_V1";

if (src.includes(LEGACY_MARKER) && !src.includes(MARKER)) {
  throw new Error("legacy Z business watch wiring present; refusing to add a second WATCH block");
}

const importAnchor = 'import { buildThreeMinuteFusedTelegramView, ThreeMinuteFusedDedup } from "./telegram-3m-fused-monitor.js";';
const imports = [
  'import { updateWatchZScore } from "./telegram-watch-zscore-v1.js";',
  'import { buildLiveExactZWatchRuntime } from "./telegram-z-watch-live-exact-runtime-v1.js";',
];
if (!src.includes(importAnchor)) throw new Error("exact Z watch import anchor not found");
for (const importLine of imports) {
  if (!src.includes(importLine)) src = src.replace(importAnchor, `${importAnchor}\n${importLine}`);
}

if (!src.includes(MARKER)) {
  const anchor = '        if (TELEGRAM_3M_FUSED_DEDUP.shouldEmit(view)) {';
  if (!src.includes(anchor)) {
    console.warn("exact Z watch runtime anchor not found; skipping observation-only Z-WATCH wiring and allowing core service startup");
    process.exit(0);
  }

  const block = [
    `        // ${MARKER}: exact FULL-packet option evidence only; observation-only and fail-closed.`,
    '        {',
    '          const exactWatch = buildLiveExactZWatchRuntime(symbol, new Date().toISOString());',
    '          const exactFeed = exactWatch.feed;',
    '          const t3: any = timeline.find((p: any) => p.label === "T3") ?? null;',
    '          const p3: any = ppd.find((p: any) => p.windowMinutes === 3 && p.usable) ?? null;',
    '          const exactSpreads = [exactFeed.ce.spreadPct, exactFeed.pe.spreadPct].filter((x: any) => Number.isFinite(Number(x))).map(Number);',
    '          const riskSpread = exactSpreads.length ? Math.max(...exactSpreads) : null;',
    '          const z = updateWatchZScore({',
    '            symbol,',
    '            spot3m: t3?.spotChange ?? null,',
    '            future3m: exactFeed.future3m,',
    '            cePremium3m: exactFeed.ce.ready ? exactFeed.ce.premium3mPct : null,',
    '            pePremium3m: exactFeed.pe.ready ? exactFeed.pe.premium3mPct : null,',
    '            ceOi3m: exactFeed.ceOi3m, peOi3m: exactFeed.peOi3m,',
    '            pcr3m: t3?.pcrChange ?? null, vix3m: t3?.vixChange ?? null,',
    '            ppd3m: p3?.candidateOrientedPpdPp ?? null, ppdSide: p3?.controllingSide ?? null,',
    '            spreadPct: riskSpread,',
    '          });',
    '          const premiumZReady = z.metrics.cePremium3m.ready && z.metrics.pePremium3m.ready;',
    '          const exactPairReady = exactWatch.ready && exactFeed.ce.ready && exactFeed.pe.ready;',
    '          const watchSide = symbol === "BANKNIFTY" ? null : exactPairReady && premiumZReady ? z.watchSide : null;',
    '          const watchState = !exactPairReady ? "EXACT_3M_NOT_READY" : !premiumZReady ? "Z_WARMING" : watchSide ? `WATCH_${watchSide}` : "NO_CLEAR_WATCH";',
    '          view.fingerprint = `${view.fingerprint}|EXACT_Z:${watchState}`;',
    '          const fmt = (v: any, d=2, suffix="") => Number.isFinite(Number(v)) ? `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(d)}${suffix}` : "—";',
    '          const zfmt = (name: any) => z.metrics[name]?.z === null || z.metrics[name]?.z === undefined ? "Z—" : `Z${fmt(z.metrics[name].z,2)}`;',
    '          const id = watchSide === "CE" ? exactWatch.ceIdentity : watchSide === "PE" ? exactWatch.peIdentity : null;',
    '          const ltp = watchSide === "CE" ? exactWatch.ceLtp : watchSide === "PE" ? exactWatch.peLtp : null;',
    '          const contract = id ? `${id.symbol} ${id.expiryDate} ${id.strike} ${id.side}` : "—";',
    '          const meaning = symbol === "BANKNIFTY"',
    '            ? "BANKNIFTY context-only; no CE/PE business WATCH side."',
    '            : !exactPairReady',
    '              ? `Exact 3m CE/PE pair unavailable: ${exactWatch.blockers.join(", ") || "feed not ready"}.`',
    '              : !premiumZReady',
    '                ? "Exact CE/PE 3m feed is live; Z baseline is still warming."',
    '                : z.note;',
    '          view.text += `\\n\\n🎯 EXACT Z-SCORE BUSINESS WATCH\\n${watchSide ? `WATCH ${watchSide}` : watchState.replaceAll("_", " ")} • Observation only\\nExact CE Prem ${fmt(exactFeed.ce.premium3mPct,1,"%")} (${zfmt("cePremium3m")}) | PE Prem ${fmt(exactFeed.pe.premium3mPct,1,"%")} (${zfmt("pePremium3m")})\\nExact Spread CE ${fmt(exactFeed.ce.spreadPct,2,"%")} | PE ${fmt(exactFeed.pe.spreadPct,2,"%")} (${zfmt("spreadPct")})\\nSpot3M ${fmt(t3?.spotChange)} (${zfmt("spot3m")}) | PCR Δ ${fmt(t3?.pcrChange,3)} (${zfmt("pcr3m")}) | VIX Δ ${fmt(t3?.vixChange,2)} (${zfmt("vix3m")})\\nPPD3M ${p3 ? `${fmt(p3.candidateOrientedPpdPp,2,"pp")} ${p3.controllingSide ?? "—"}` : "—"} (${zfmt("ppd3m")})\\nDirectional Z: ${z.directionalScore === null ? "—" : fmt(z.directionalScore,2)}\\nObserved contract: ${contract} | LTP ${watchSide ? fmt(ltp,2) : "—"}\\nFutures/OI 3m: — (not independently verified in exact feed; no inference)\\nWalls: CE ${callWallStrike ?? "—"} | PE ${putWallStrike ?? "—"} • event/context only\\nMeaning: ${meaning}\\nAction: WATCH ONLY — no BUY/SELL order.`;',
    '          console.log(`[TELEGRAM_BUSINESS_WATCH_EXACT_Z] ${JSON.stringify({ symbol, watchState, exactPairReady, premiumZReady, zReady: z.ready, watchSide: watchSide ?? "NONE", blockers: exactWatch.blockers, createsOrders: false, affectsExecution: false })}`);',
    '        }',
    '',
  ].join("\n");
  src = src.replace(anchor, block + anchor);
}

if (checkOnly) {
  console.log(src === original ? "exact Z watch wiring already applied" : "exact Z watch wiring check passed");
  process.exit(0);
}
if (src !== original) fs.writeFileSync(file, src, "utf8");
console.log(src !== original ? "exact Z watch wiring applied" : "exact Z watch wiring already applied");
