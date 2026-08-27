import { readFileSync, writeFileSync } from "node:fs";

const path = "server.ts";
const marker = "PHASE63_REPLAY_CLOCK_INJECTION_V1";
const source = readFileSync(path, "utf8");

if (source.includes(marker)) {
  console.log(`[Phase63] ${marker} already present; no change.`);
  process.exit(0);
}

const oldSignature = "function validateDataServer(symbol: string, m: IndexMetrics | undefined, session: KiteSession, sectorBreadth: number | null): ServerValidationResult {";
const newSignature = `function validateDataServer(symbol: string, m: IndexMetrics | undefined, session: KiteSession, sectorBreadth: number | null, nowMs: number = Date.now()): ServerValidationResult {\n  // ${marker}\n  // Live callers omit nowMs and retain Date.now() behavior exactly. Historical replay\n  // callers may inject the bucket-time clock so old snapshots are not falsely marked STALE.`;

if (!source.includes(oldSignature)) {
  throw new Error("[Phase63] Source drift: validateDataServer signature anchor not found; refusing to patch.");
}

let next = source.replace(oldSignature, newSignature);

const functionStart = next.indexOf(newSignature);
const nextFunction = next.indexOf("function runRuleEngineServerCore", functionStart);
if (functionStart < 0 || nextFunction < 0) {
  throw new Error("[Phase63] Could not isolate validateDataServer body; refusing to patch.");
}

const before = next.slice(0, functionStart);
let body = next.slice(functionStart, nextFunction);
const after = next.slice(nextFunction);

const oldTimestamp = "const timestamp = new Date().toISOString();";
const oldAge = "const ageMs = effTs ? Date.now() - new Date(effTs).getTime() : null;";
if (!body.includes(oldTimestamp)) throw new Error("[Phase63] Validator timestamp anchor not found.");
if (!body.includes(oldAge)) throw new Error("[Phase63] Validator age anchor not found.");

body = body.replace(oldTimestamp, "const timestamp = new Date(nowMs).toISOString();");
body = body.replace(oldAge, "const ageMs = effTs ? nowMs - new Date(effTs).getTime() : null;");
next = before + body + after;

for (const required of [
  marker,
  "nowMs: number = Date.now()",
  "const timestamp = new Date(nowMs).toISOString();",
  "const ageMs = effTs ? nowMs - new Date(effTs).getTime() : null;",
]) {
  if (!next.includes(required)) throw new Error(`[Phase63] Verification failed: missing ${required}`);
}

// Guard against accidental live-call rewrites: this patch must not add any explicit
// fifth argument at existing call sites. Replay wiring is a later, separate phase.
const addedExplicitReplayCalls = (next.match(/validateDataServer\([^\n;]+,\s*[^\n;]+,\s*[^\n;]+,\s*[^\n;]+,\s*[^\n;]+\)/g) || []).filter((x) => !x.includes("nowMs: number"));
if (addedExplicitReplayCalls.length) {
  throw new Error("[Phase63] Safety check failed: unexpected 5-argument validator call detected.");
}

writeFileSync(path, next, "utf8");
console.log(`[Phase63] Applied ${marker}. Live default clock preserved; replay clock injection enabled.`);
