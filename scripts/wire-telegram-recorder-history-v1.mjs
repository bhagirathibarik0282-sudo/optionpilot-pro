import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), "server.ts");
const fusedPrerequisiteFile = path.resolve(process.cwd(), "scripts/wire-telegram-3m-fused-runtime.mjs");
const businessPrerequisiteFile = path.resolve(process.cwd(), "scripts/wire-telegram-business-flow-v1.mjs");
const packageFile = path.resolve(process.cwd(), "package.json");
const checkOnly = process.argv.includes("--check");
let src = fs.readFileSync(file, "utf8");
const original = src;
const MARKER = "OPTIONPILOT_TELEGRAM_RECORDER_HISTORY_V1";
const PCR_VIX_MARKER = "OPTIONPILOT_TELEGRAM_PCR_VIX_HISTORY_V1";

const historyAnchor = `        const history: any[] = (session.snapshotHistory ?? []).map((h: any) => ({ at: Date.parse(h.timestamp), value: h?.[symbol] }))\n          .filter((h: any) => Number.isFinite(h.at) && h.value);`;
const expiryAnchor = `          const exp: any = v2CurrentExpiry(snapshot);\n          const rows: any[] = side === "CE" ? (exp?.ceStrikes ?? []) : (exp?.peStrikes ?? []);`;
const optionTailAnchor = `            ?? rows.find((r: any) => r?.isAtm)\n            ?? null;`;
const snapshotAnchor = `    session.marketSnapshot = snapshot;\n    session.snapshotTime = Date.now();`;
const nearestAnchor = `        const currentAt = Date.now();\n        const nearest = (mins: number) => {`;
const prevAnchor = `          const prev: any = nearest(mins);\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);`;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count === 0) throw new Error(`${label}: source occurrence not found`);
  src = src.split(from).join(to);
}

if (checkOnly && !src.includes(MARKER) && !src.includes(historyAnchor)) {
  // Optional Telegram enrichments are not production-startup prerequisites anymore.
  // Verify their source dependencies and CI hook without requiring them in `start`.
  const fusedPrerequisite = fs.readFileSync(fusedPrerequisiteFile, "utf8");
  const businessPrerequisite = fs.readFileSync(businessPrerequisiteFile, "utf8");
  const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  const tests = String(pkg?.scripts?.test ?? "");
  const missing = [];
  if (!fusedPrerequisite.includes("const history: any[] = (session.snapshotHistory ?? []).map")) missing.push("history");
  if (!businessPrerequisite.includes("const exp: any = v2CurrentExpiry(snapshot);")) missing.push("expiry");
  if (!businessPrerequisite.includes("rows.find((r: any) => r?.isAtm)")) missing.push("option-tail");
  if (!fusedPrerequisite.includes("const currentAt = Date.now();")) missing.push("nearest");
  if (!businessPrerequisite.includes("const prev: any = nearest(mins);")) missing.push("prev");
  if (!tests.includes("wire-telegram-recorder-history-v1.mjs --check")) missing.push("test-check-hook");
  if (missing.length) throw new Error(`recorder-history prerequisite markers missing: ${missing.join(",")}`);
  console.log("telegram recorder-history optional-wiring prerequisite check passed");
  process.exit(0);
}

if (!src.includes(MARKER)) {
  const historyReplacement = `        // ${MARKER}: RAM history first, already-restored Recorder history as read-only fallback.\n        // No DB query, timer, polling loop, socket, scoring, selector or execution side effect.\n        const historyTime = (raw: any) => {\n          if (typeof raw === "number" && Number.isFinite(raw)) return raw;\n          const parsed = Date.parse(String(raw ?? ""));\n          return Number.isFinite(parsed) ? parsed : NaN;\n        };\n        const finiteMetric = (...values: any[]) => {\n          for (const value of values) { if (value == null || value === "") continue; const n = Number(value); if (Number.isFinite(n)) return n; }\n          return null;\n        };\n        const normalizeCompactRows = (rows: any) => Array.isArray(rows) ? rows.map((r: any) => { if (!r || typeof r !== "object") return r; const lastPrice = finiteMetric(r?.lastPrice, r?.ltp); return lastPrice === null ? r : { ...r, lastPrice }; }) : [];\n        const normalizeRecorderValue = (raw: any) => {\n          if (!raw || typeof raw !== "object") return raw;\n          const ceStrikesNear = normalizeCompactRows(raw?.ceStrikesNear); const peStrikesNear = normalizeCompactRows(raw?.peStrikesNear);\n          const existingFutures = Array.isArray(raw?.futuresContracts) ? raw.futuresContracts : [];\n          const futureLtp = finiteMetric(raw?.futureLtp, raw?.futuresLtp, raw?.futLtp);\n          const futuresContracts = existingFutures.length ? existingFutures.map((f: any) => ({ ...f, ltp: finiteMetric(f?.ltp, f?.lastPrice) ?? f?.ltp })) : futureLtp === null ? [] : [{ ltp: futureLtp }];\n          const pcr = finiteMetric(raw?.pcr, raw?.fullChainPcr, raw?.oiPcr); const vix = finiteMetric(raw?.vix, raw?.indiaVix);\n          return { ...raw, ceStrikesNear, peStrikesNear, futuresContracts, pcr: pcr ?? raw?.pcr ?? null, vix: vix ?? raw?.vix ?? null };\n        };\n        const liveHistory: any[] = (session.snapshotHistory ?? []).map((h: any) => ({ at: historyTime(h?.timestamp ?? h?.backendTimestamp ?? h?.snapshotTime), value: h?.[symbol], source: "RAM" })).filter((h: any) => Number.isFinite(h.at) && h.value);\n        const recorderHistory: any[] = (Array.isArray(recorderSession?.snapshots) ? recorderSession.snapshots : []).map((h: any) => {\n          const rawValue = h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null;\n          return { at: historyTime(h?.backendTimestamp ?? h?.timestamp ?? h?.snapshotTime ?? h?.createdAt), value: normalizeRecorderValue(rawValue), source: "RECORDER" };\n        }).filter((h: any) => Number.isFinite(h.at) && h.value && h?.value?.error !== true);\n        const mergedHistory = new Map<number, any>();\n        for (const h of recorderHistory) mergedHistory.set(h.at, h);\n        for (const h of liveHistory) mergedHistory.set(h.at, h);\n        const history: any[] = [...mergedHistory.values()].sort((a: any, b: any) => a.at - b.at);`;
  replaceOnce(historyAnchor, historyReplacement, "recorder history merge");

  const expiryReplacement = `          const exp: any = v2CurrentExpiry(snapshot);\n          const rows: any[] = side === "CE" ? (exp?.ceStrikes ?? []) : (exp?.peStrikes ?? []);\n          const compactRows: any[] = side === "CE" ? (snapshot?.ceStrikesNear ?? []) : (snapshot?.peStrikesNear ?? []);`;
  replaceOnce(expiryAnchor, expiryReplacement, "recorder compact option rows");

  const optionTailReplacement = `            ?? rows.find((r: any) => r?.isAtm)\n            ?? compactRows.find((r: any) => Number.isFinite(strike) && Number(r?.strike) === strike)\n            ?? compactRows.find((r: any) => r?.isAtm)\n            ?? compactRows[0]\n            ?? (() => { const lastPrice = side === "CE" ? snapshot?.ceLtp : snapshot?.peLtp; const oi = side === "CE" ? snapshot?.ceOi : snapshot?.peOi; if (!Number.isFinite(Number(lastPrice)) && !Number.isFinite(Number(oi))) return null; return { lastPrice: Number.isFinite(Number(lastPrice)) ? Number(lastPrice) : null, oi: Number.isFinite(Number(oi)) ? Number(oi) : null, iv: null }; })();`;
  replaceOnce(optionTailAnchor, optionTailReplacement, "recorder compact option fallback");

  const snapshotReplacement = `${snapshotAnchor}\n\n    // ${PCR_VIX_MARKER}: retain exact already-fetched PCR/VIX only for Telegram rolling windows.\n    const telegramMetricAt = Date.now();\n    const telegramMetricRow: any = { timestamp: new Date(telegramMetricAt).toISOString() };\n    for (const telegramMetricSym of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) { const telegramMetricMarket: any = snapshot[telegramMetricSym]; if (!telegramMetricMarket || telegramMetricMarket.error) continue; const pcr = Number.isFinite(Number(telegramMetricMarket.pcr)) ? Number(telegramMetricMarket.pcr) : null; const vix = Number.isFinite(Number(telegramMetricMarket.vix)) ? Number(telegramMetricMarket.vix) : null; telegramMetricRow[telegramMetricSym] = { pcr, vix }; }\n    (session.telegramMetricHistory ??= []).push(telegramMetricRow);\n    if (session.telegramMetricHistory.length > 40) session.telegramMetricHistory.splice(0, session.telegramMetricHistory.length - 40);`;
  replaceOnce(snapshotAnchor, snapshotReplacement, "PCR/VIX rolling capture");

  const nearestReplacement = `        const currentAt = Date.now();\n        const metricHistory: any[] = Array.isArray(session.telegramMetricHistory) ? session.telegramMetricHistory.map((h: any) => ({ at: Date.parse(String(h?.timestamp ?? "")), value: h?.[symbol] })).filter((h: any) => Number.isFinite(h.at) && h.value) : [];\n        const nearestMetric = (mins: number) => { const target = currentAt - mins * 60_000; let best: any = null; let distance = Number.POSITIVE_INFINITY; for (const h of metricHistory) { const d = Math.abs(h.at - target); if (d < distance && d <= 90_000) { best = h.value; distance = d; } } return best; };\n        const nearest = (mins: number) => {`;
  replaceOnce(nearestAnchor, nearestReplacement, "PCR/VIX nearest helper");

  const prevReplacement = `          const prev: any = nearest(mins);\n          const prevMetric: any = nearestMetric(mins);\n          if (prev && prevMetric) { if (!Number.isFinite(Number(prev.pcr)) && Number.isFinite(Number(prevMetric.pcr))) prev.pcr = Number(prevMetric.pcr); if (!Number.isFinite(Number(prev.vix)) && Number.isFinite(Number(prevMetric.vix))) prev.vix = Number(prevMetric.vix); }\n          const ppdWindow: any = ppd.find((w: any) => w.windowMinutes === mins);`;
  replaceOnce(prevAnchor, prevReplacement, "PCR/VIX previous metric join");
}

if (checkOnly) { console.log(src === original ? "telegram recorder-history wiring already applied" : "telegram recorder-history wiring check passed"); process.exit(0); }
if (src !== original) { fs.writeFileSync(file, src,"utf8"); console.log("telegram recorder-history wiring applied"); } else { console.log("telegram recorder-history wiring already applied"); }
