import fs from "node:fs";

const benchPath = "haiku-audit-benchmark-v2.ts";
const livePath = "telegram-live-status-v2.ts";
const previewPath = "telegram-preview-route.ts";
let bench = fs.readFileSync(benchPath, "utf8");
let live = fs.readFileSync(livePath, "utf8");
let preview = fs.readFileSync(previewPath, "utf8");

const marker = "PHASE76_HAIKU_AUDIT_BENCHMARK_V2_WIRED";
if (live.includes(marker) && preview.includes("haiku-audit-benchmark-v2")) {
  console.log("Phase76 already wired");
  process.exit(0);
}

// Reserve a benchmark slot before API calls so a fast market loop cannot launch duplicate overlapping cases.
const oldPromptStart = `  const prompt = buildHaikuAuditBenchmarkPrompt(input);\n  const runs: RunResult[] = [];`;
const newPromptStart = `  const day = istParts(nowMs).date;\n  const key = \`${'${day}:${input.symbol}'}\`;\n  const reserved = state.get(key) ?? { count: 0, lastCaseAt: 0, lastSignature: null, results: [] };\n  reserved.count += 1; reserved.lastCaseAt = nowMs; reserved.lastSignature = signature(input); state.set(key, reserved);\n  const prompt = buildHaikuAuditBenchmarkPrompt(input);\n  const runs: RunResult[] = [];`;
if ((bench.split(oldPromptStart).length - 1) !== 1) throw new Error("Phase76 benchmark reservation anchor drift");
bench = bench.replace(oldPromptStart, newPromptStart);

const oldStore = `  const day = istParts(nowMs).date; const key = \`${'${day}:${input.symbol}'}\`; const s = state.get(key) ?? { count: 0, lastCaseAt: 0, lastSignature: null, results: [] };\n  s.count += 1; s.lastCaseAt = nowMs; s.lastSignature = signature(input); s.results.push(out); state.set(key, s);`;
const newStore = `  const s = state.get(key)!; s.results.push(out); state.set(key, s);`;
if ((bench.split(oldStore).length - 1) !== 1) throw new Error("Phase76 benchmark store anchor drift");
bench = bench.replace(oldStore, newStore);

// Reuse the existing Phase74 Anthropic transport; benchmark adds no second AI client.
const importLine = `import { runHaikuAuditBenchmarkV2 } from "./haiku-audit-benchmark-v2.js"; // ${marker}\n`;
if (!live.includes(marker)) live = importLine + live;

const statusAnchor = `  const status = buildPhase74CanonicalStatus({\n    symbol: input.symbol,\n    observedAt: new Date(input.nowMs ?? Date.now()).toISOString(),\n    metrics: input.metrics,\n    validation: input.validation,\n    rule: input.rule,\n  });\n  const transport = input.transport ?? resolvePhase74Transport();`;
const statusReplacement = `  const status = buildPhase74CanonicalStatus({\n    symbol: input.symbol,\n    observedAt: new Date(input.nowMs ?? Date.now()).toISOString(),\n    metrics: input.metrics,\n    validation: input.validation,\n    rule: input.rule,\n  });\n\n  // Phase76 research-only benchmark. Non-blocking, known-then, no verdict/Telegram/execution authority.\n  if (input.anthropicApiKey) {\n    const benchmarkNow = input.nowMs ?? Date.now();\n    void runHaikuAuditBenchmarkV2({\n      symbol: status.symbol, observedAt: status.observedAt, validatorState: status.validatorState, freshness: status.freshness,\n      verdict: status.verdict, score: status.score, maxScore: status.maxScore, blockers: status.blockers, evidence: status.evidence, sourceMode: "LIVE",\n    }, async (prompt) => {\n      for (const model of ["claude-haiku-4-5", "claude-3-haiku-20240307"]) {\n        const raw = await callAnthropicModel(input.anthropicApiKey!, model, prompt).catch(() => null);\n        if (raw) return raw;\n      }\n      return null;\n    }, benchmarkNow).catch((error) => console.error("[HaikuBenchmarkV2] non-blocking failure:", error instanceof Error ? error.message : error));\n  }\n\n  const transport = input.transport ?? resolvePhase74Transport();`;
if ((live.split(statusAnchor).length - 1) !== 1) throw new Error("Phase76 live publisher anchor drift");
live = live.replace(statusAnchor, statusReplacement);

// Read-only benchmark status endpoint on an already-mounted research/preview router.
const previewImport = `import { getHaikuAuditBenchmarkV2Snapshot, HAIKU_BENCHMARK_CRITERIA } from "./haiku-audit-benchmark-v2.js";\n`;
if (!preview.includes("getHaikuAuditBenchmarkV2Snapshot")) preview = previewImport + preview;
const mountAnchor = `export function mountTelegramPreviewRoutes(app: Hono): void {\n  app.get("/api/telegram/preview", async (c) => {`;
const mountReplacement = `export function mountTelegramPreviewRoutes(app: Hono): void {\n  app.get("/api/research/haiku-audit-benchmark-v2", (c) => {\n    c.header("Cache-Control", "no-store");\n    return c.json({ ok: true, mode: "RESEARCH_ONLY", automaticPromotionAllowed: false, affectsVerdict: false, affectsTelegram: false, affectsExecution: false, criteria: HAIKU_BENCHMARK_CRITERIA, benchmark: getHaikuAuditBenchmarkV2Snapshot() });\n  });\n\n  app.get("/api/telegram/preview", async (c) => {`;
if ((preview.split(mountAnchor).length - 1) !== 1) throw new Error("Phase76 preview route anchor drift");
preview = preview.replace(mountAnchor, mountReplacement);

for (const forbidden of ["placeOrder", "executeTrade", "automaticPromotionAllowed: true"]) {
  if (bench.includes(forbidden)) throw new Error(`Phase76 P0 forbidden benchmark behavior: ${forbidden}`);
}
if (!live.includes("sourceMode: \"LIVE\"")) throw new Error("Phase76 source mode not explicit");
if (!preview.includes("RESEARCH_ONLY")) throw new Error("Phase76 endpoint not research-only");

fs.writeFileSync(benchPath, bench);
fs.writeFileSync(livePath, live);
fs.writeFileSync(previewPath, preview);
console.log("Phase76 Haiku benchmark runtime wiring applied safely");
