import fs from "node:fs";

const src = fs.readFileSync("server.ts", "utf8");
const start = src.indexOf('app.get("/api/offline-research/nifty-deterministic-replay"');
const end = src.indexOf('app.get("/api/research/shadow-diagnostic-trace"', start);
if (start < 0 || end < 0) throw new Error("replay route missing");
const block = src.slice(start, end);

const required = [
  "PHASE63_REPLAY_CLOCK_INJECTION_V1",
  "PHASE68_FIRST15_IST_WINDOW_V1",
  "PHASE69_REPLAY_RESULT_AUDIT_V1",
  "PHASE70_BLOCKER_ISOLATION_GATE_V1",
  "PHASE71_MULTI_INDEX_REPLAY_V1",
  'supportedSymbols = ["NIFTY", "BANKNIFTY", "SENSEX"]',
  '[symbol]: { spot: current, pcr, vix }',
  "validateDataServer(symbol, m, replaySession, null, marketBucketMs)",
  "runRuleEngineServerCore(symbol, m, validation, null)",
  "istMinuteOfDay >= 555 && istMinuteOfDay <= 569",
  "ds.minutes.size === 15",
  "P1_ISOLATE",
  "FAIL_CLOSED_AND_KEEP_OUT_OF_PARITY_SET",
];
for (const q of required) if (!src.includes(q) && !block.includes(q)) throw new Error(`P0 invariant missing: ${q}`);

const forbiddenInReplay = [
  "placeOrder(",
  "sendTelegram",
  "persistKnownThenScoreObservation(",
  "dbInsert(",
  "Date.now() - new Date(effTs)",
  "NIFTY: { spot: current, pcr, vix }",
];
for (const q of forbiddenInReplay) if (block.includes(q)) throw new Error(`P0 forbidden replay behavior: ${q}`);

if (!block.includes("researchOnly: true")) throw new Error("researchOnly marker missing");
if (!block.includes('productionImpact: "NONE"')) throw new Error("productionImpact NONE marker missing");
if (!block.includes("mutationAllowed: false")) throw new Error("mutationAllowed false marker missing");
if (!block.includes("scorePersistence: false")) throw new Error("scorePersistence false marker missing");
if (!block.includes("brokerCalls: false") || !block.includes("telegramCalls: false") || !block.includes("executionCalls: false")) throw new Error("side-effect contract markers missing");

console.log(JSON.stringify({
  version: "PHASE72_FINAL_DEVILCHECK_V1",
  result: "PASS",
  p0Detected: false,
  audited: [
    "replay-clock-not-wall-clock",
    "exact-first15-ist-window",
    "dynamic-symbol-history",
    "same-validator-and-rule-core",
    "no-broker-telegram-execution",
    "no-score-persistence",
    "p1-fail-closed-isolation",
  ]
}, null, 2));
