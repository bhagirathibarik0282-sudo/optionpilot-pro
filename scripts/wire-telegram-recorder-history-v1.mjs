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

const historyAnchor = `        const history: any[] = (session.snapshotHistory ?? []).map((h: any) => ({ at: Date.parse(h.timestamp), value: h?.[symbol] }))\n          .filter((h: any) => Number.isFinite(h.at) && h.value);`;
const expiryAnchor = `          const exp: any = v2CurrentExpiry(snapshot);\n          const rows: any[] = side === "CE" ? (exp?.ceStrikes ?? []) : (exp?.peStrikes ?? []);`;
const optionTailAnchor = `            ?? rows.find((r: any) => r?.isAtm)\n            ?? null;`;

function replaceOnce(from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return;
  if (count !== 1) throw new Error(`${label}: expected exactly 1 source occurrence, found ${count}`);
  src = src.replace(from, to);
}

// In CI --check mode server.ts is intentionally not mutated by prerequisite dry-runs.
// Verify the fused-runtime source that creates history, the business-flow source that
// creates option helpers, and their exact startup order before this recorder fallback.
// Real startup still performs strict exact-anchor replacement and fails closed on drift.
if (checkOnly && !src.includes(MARKER) && !src.includes(historyAnchor)) {
  const fusedPrerequisite = fs.readFileSync(fusedPrerequisiteFile, "utf8");
  const businessPrerequisite = fs.readFileSync(businessPrerequisiteFile, "utf8");
  const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  const startup = String(pkg?.scripts?.start ?? "");
  const missing: string[] = [];
  if (!fusedPrerequisite.includes("const history: any[] = (session.snapshotHistory ?? []).map")) missing.push("history");
  if (!businessPrerequisite.includes("const exp: any = v2CurrentExpiry(snapshot);")) missing.push("expiry");
  if (!businessPrerequisite.includes("rows.find((r: any) => r?.isAtm)")) missing.push("option-tail");
  if (missing.length) throw new Error(`recorder-history prerequisite markers missing: ${missing.join(",")}`);

  const fusedPos = startup.indexOf("node scripts/wire-telegram-3m-fused-runtime.mjs");
  const businessPos = startup.indexOf("node scripts/wire-telegram-business-flow-v1.mjs");
  const recorderPos = startup.indexOf("node scripts/wire-telegram-recorder-history-v1.mjs");
  if (fusedPos < 0 || businessPos < 0 || recorderPos < 0 || !(fusedPos < businessPos && businessPos < recorderPos)) {
    throw new Error("recorder-history startup dependency order invalid");
  }
  console.log("telegram recorder-history prerequisite wiring check passed");
  process.exit(0);
}

if (!src.includes(MARKER)) {
  const historyReplacement = `        // ${MARKER}: RAM history first, already-restored Recorder history as read-only fallback.\n        // No DB query, timer, polling loop, socket, scoring, selector or execution side effect.\n        const historyTime = (raw: any) => {\n          if (typeof raw === "number" && Number.isFinite(raw)) return raw;\n          const parsed = Date.parse(String(raw ?? ""));\n          return Number.isFinite(parsed) ? parsed : NaN;\n        };\n        const liveHistory: any[] = (session.snapshotHistory ?? []).map((h: any) => ({\n          at: historyTime(h?.timestamp ?? h?.backendTimestamp ?? h?.snapshotTime), value: h?.[symbol], source: "RAM",\n        })).filter((h: any) => Number.isFinite(h.at) && h.value);\n        const recorderHistory: any[] = (Array.isArray(recorderSession?.snapshots) ? recorderSession.snapshots : []).map((h: any) => ({\n          at: historyTime(h?.backendTimestamp ?? h?.timestamp ?? h?.snapshotTime ?? h?.createdAt),\n          value: h?.[symbol] ?? h?.marketSnapshot?.[symbol] ?? h?.snapshot?.[symbol] ?? h?.data?.[symbol] ?? null,\n          source: "RECORDER",\n        })).filter((h: any) => Number.isFinite(h.at) && h.value && h?.value?.error !== true);\n        const mergedHistory = new Map<number, any>();\n        for (const h of recorderHistory) mergedHistory.set(h.at, h);\n        for (const h of liveHistory) mergedHistory.set(h.at, h); // RAM wins on exact timestamp.\n        const history: any[] = [...mergedHistory.values()].sort((a: any, b: any) => a.at - b.at);`;
  replaceOnce(historyAnchor, historyReplacement, "recorder history merge");

  const expiryReplacement = `          const exp: any = v2CurrentExpiry(snapshot);\n          const rows: any[] = side === "CE" ? (exp?.ceStrikes ?? []) : (exp?.peStrikes ?? []);\n          const compactRows: any[] = side === "CE" ? (snapshot?.ceStrikesNear ?? []) : (snapshot?.peStrikesNear ?? []);`;
  replaceOnce(expiryAnchor, expiryReplacement, "recorder compact option rows");

  const optionTailReplacement = `            ?? rows.find((r: any) => r?.isAtm)\n            ?? compactRows.find((r: any) => Number.isFinite(strike) && Number(r?.strike) === strike)\n            ?? compactRows.find((r: any) => r?.isAtm)\n            ?? compactRows[0]\n            ?? (() => {\n              const lastPrice = side === "CE" ? snapshot?.ceLtp : snapshot?.peLtp;\n              const oi = side === "CE" ? snapshot?.ceOi : snapshot?.peOi;\n              if (!Number.isFinite(Number(lastPrice)) && !Number.isFinite(Number(oi))) return null;\n              return { lastPrice: Number.isFinite(Number(lastPrice)) ? Number(lastPrice) : null, oi: Number.isFinite(Number(oi)) ? Number(oi) : null, iv: null };\n            })();`;
  replaceOnce(optionTailAnchor, optionTailReplacement, "recorder compact option fallback");
}

if (checkOnly) {
  console.log(src === original ? "telegram recorder-history wiring already applied" : "telegram recorder-history wiring check passed");
  process.exit(0);
}
if (src !== original) {
  fs.writeFileSync(file, src, "utf8");
  console.log("telegram recorder-history wiring applied");
} else {
  console.log("telegram recorder-history wiring already applied");
}
