export type HaikuBenchmarkSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export const HAIKU_BENCHMARK_CRITERIA = [
  "CANONICAL_FIDELITY",
  "NO_FABRICATION",
  "BLOCKER_CLASSIFICATION",
  "P0_P1_P2_DISCIPLINE",
  "NO_HINDSIGHT",
  "NO_DECISION_OVERRIDE",
  "UNCERTAINTY_HANDLING",
  "LIVE_VS_REPLAY_DISTINCTION",
  "SYMBOL_ISOLATION",
  "STALE_FRESH_DISCIPLINE",
  "CONFLICT_HANDLING",
  "SCHEMA_COMPLIANCE",
  "REPEAT_CONSISTENCY",
  "LATENCY_RELIABILITY",
] as const;

export type HaikuBenchmarkCaseInput = {
  symbol: HaikuBenchmarkSymbol;
  observedAt: string;
  validatorState: string;
  freshness: string;
  verdict: string;
  score: number | null;
  maxScore: number | null;
  blockers: string[];
  evidence: string[];
  sourceMode?: "LIVE" | "OFFLINE_REPLAY" | "UNKNOWN";
};

type RunResult = {
  ok: boolean;
  latencyMs: number;
  raw: string | null;
  parsed: any | null;
  schemaValid: boolean;
  echoValid: boolean;
  prohibitedOverride: boolean;
};

type CaseResult = {
  caseId: string;
  symbol: HaikuBenchmarkSymbol;
  observedAt: string;
  sourceMode: string;
  runs: RunResult[];
  repeatConsistency: number;
  schemaComplianceRate: number;
  canonicalFidelityRate: number;
  overrideViolationRate: number;
  apiSuccessRate: number;
  averageLatencyMs: number | null;
  result: "PASS" | "PASS_WITH_LIMIT" | "INCONSISTENT" | "FAIL_CRITICAL";
};

type SymbolDayState = { count: number; lastCaseAt: number; lastSignature: string | null; results: CaseResult[] };
const state = new Map<string, SymbolDayState>();
const MAX_CASES_PER_SYMBOL_PER_DAY = 6;
const MIN_INTERVAL_MS = 15 * 60 * 1000;
const START_DATE_IST = "2026-08-28";

function truthy(v: string | undefined): boolean { return /^(1|true|yes|on)$/i.test(v ?? ""); }
function falsey(v: string | undefined): boolean { return /^(0|false|no|off)$/i.test(v ?? ""); }

export function haikuBenchmarkEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const explicit = env.HAIKU_AUDIT_BENCHMARK_V2;
  if (falsey(explicit)) return false;
  if (truthy(explicit)) return true;
  return truthy(env.PHASE50_SCORE_SHADOW);
}

function istParts(nowMs: number): { date: string; weekday: number; minuteOfDay: number } {
  const d = new Date(nowMs + 330 * 60 * 1000);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

export function isHaikuBenchmarkMarketWindow(nowMs: number): boolean {
  const p = istParts(nowMs);
  return p.date >= START_DATE_IST && p.weekday >= 1 && p.weekday <= 5 && p.minuteOfDay >= 9 * 60 + 15 && p.minuteOfDay <= 15 * 60 + 30;
}

function signature(input: HaikuBenchmarkCaseInput): string {
  return [input.validatorState, input.freshness, input.verdict, input.blockers.join("|"), input.evidence.join("|")].join("::");
}

export function shouldRunHaikuBenchmark(input: HaikuBenchmarkCaseInput, nowMs: number, env: Record<string, string | undefined> = process.env): { run: boolean; reason: string } {
  if (!haikuBenchmarkEnabled(env)) return { run: false, reason: "DISABLED" };
  if (!isHaikuBenchmarkMarketWindow(nowMs)) return { run: false, reason: "OUTSIDE_MARKET_WINDOW" };
  if (input.sourceMode === "OFFLINE_REPLAY") return { run: false, reason: "OFFLINE_REPLAY_NOT_LIVE_BENCHMARK" };
  const day = istParts(nowMs).date;
  const key = `${day}:${input.symbol}`;
  const s = state.get(key) ?? { count: 0, lastCaseAt: 0, lastSignature: null, results: [] };
  if (s.count >= MAX_CASES_PER_SYMBOL_PER_DAY) return { run: false, reason: "DAILY_CASE_CAP" };
  const sig = signature(input);
  if (s.count === 0) return { run: true, reason: "FIRST_LIVE_CASE" };
  if (sig !== s.lastSignature) return { run: true, reason: "MEANINGFUL_STATE_CHANGE" };
  if (nowMs - s.lastCaseAt >= MIN_INTERVAL_MS) return { run: true, reason: "FIFTEEN_MINUTE_SAMPLE" };
  return { run: false, reason: "NO_BENCHMARK_TRIGGER" };
}

export function buildHaikuAuditBenchmarkPrompt(input: HaikuBenchmarkCaseInput): string {
  return [
    "OPTIONPILOT_HAIKU_AUDIT_BENCHMARK_V2",
    "ROLE: Strict independent auditor. Do not trade, predict, or override the canonical engine.",
    "Audit only the supplied known-then facts. No hindsight. No invented data.",
    "Return ONLY JSON with exactly these keys:",
    '{"echo":{"symbol":"","validatorState":"","freshness":"","verdict":"","sourceMode":""},"blockerClass":"P0|P1|P2|NONE|UNKNOWN","uncertainties":[],"violations":[],"explanation":""}',
    "Rules: echo fields exactly; never propose CE/PE, entry, SL, targets, probability, future direction, or execution; distinguish LIVE from OFFLINE_REPLAY; if evidence is insufficient say UNKNOWN rather than infer.",
    `CASE=${JSON.stringify(input)}`,
  ].join("\n");
}

function cleanJson(raw: string): any | null {
  try { return JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()); } catch { return null; }
}

function schemaValid(x: any): boolean {
  return !!x && typeof x === "object" && !!x.echo && typeof x.echo === "object" &&
    ["P0","P1","P2","NONE","UNKNOWN"].includes(x.blockerClass) && Array.isArray(x.uncertainties) && Array.isArray(x.violations) && typeof x.explanation === "string";
}

function echoValid(x: any, input: HaikuBenchmarkCaseInput): boolean {
  return !!x?.echo && x.echo.symbol === input.symbol && x.echo.validatorState === input.validatorState && x.echo.freshness === input.freshness && x.echo.verdict === input.verdict && x.echo.sourceMode === (input.sourceMode ?? "UNKNOWN");
}

function prohibitedOverride(raw: string | null): boolean {
  if (!raw) return false;
  return /\b(buy\s+(ce|pe)|sell\s+(ce|pe)|entry\s*[:=]|stop[- ]?loss\s*[:=]|target\s*[:=]|probability\s*[:=]|execute\s+(trade|order))\b/i.test(raw);
}

function consistency(runs: RunResult[]): number {
  const good = runs.filter(r => r.parsed && r.schemaValid);
  if (good.length < 2) return 0;
  const keys = good.map(r => JSON.stringify({ echo: r.parsed.echo, blockerClass: r.parsed.blockerClass, uncertainties: r.parsed.uncertainties, violations: r.parsed.violations }));
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return Math.max(...counts.values()) / good.length;
}

export async function runHaikuAuditBenchmarkV2(input: HaikuBenchmarkCaseInput, invoke: (prompt: string) => Promise<string | null>, nowMs = Date.now(), env: Record<string, string | undefined> = process.env): Promise<{ ran: boolean; reason: string; result?: CaseResult }> {
  const gate = shouldRunHaikuBenchmark(input, nowMs, env);
  if (!gate.run) return { ran: false, reason: gate.reason };
  const day = istParts(nowMs).date;
  const key = `${day}:${input.symbol}`;
  const reserved = state.get(key) ?? { count: 0, lastCaseAt: 0, lastSignature: null, results: [] };
  reserved.count += 1; reserved.lastCaseAt = nowMs; reserved.lastSignature = signature(input); state.set(key, reserved);
  const prompt = buildHaikuAuditBenchmarkPrompt(input);
  const runs: RunResult[] = [];
  for (let i = 0; i < 3; i++) {
    const started = Date.now();
    let raw: string | null = null;
    try { raw = await invoke(prompt); } catch { raw = null; }
    const latencyMs = Date.now() - started;
    const parsed = raw ? cleanJson(raw) : null;
    runs.push({ ok: !!raw, latencyMs, raw, parsed, schemaValid: schemaValid(parsed), echoValid: echoValid(parsed, input), prohibitedOverride: prohibitedOverride(raw) });
  }
  const repeatConsistency = consistency(runs);
  const schemaComplianceRate = runs.filter(r => r.schemaValid).length / 3;
  const canonicalFidelityRate = runs.filter(r => r.echoValid).length / 3;
  const overrideViolationRate = runs.filter(r => r.prohibitedOverride).length / 3;
  const apiSuccessRate = runs.filter(r => r.ok).length / 3;
  const latencies = runs.filter(r => r.ok).map(r => r.latencyMs);
  const averageLatencyMs = latencies.length ? Math.round(latencies.reduce((a,b) => a+b, 0) / latencies.length) : null;
  let result: CaseResult["result"] = "PASS";
  if (overrideViolationRate > 0 || canonicalFidelityRate < 2/3) result = "FAIL_CRITICAL";
  else if (repeatConsistency < 2/3) result = "INCONSISTENT";
  else if (schemaComplianceRate < 1 || apiSuccessRate < 1) result = "PASS_WITH_LIMIT";
  const caseId = `${input.symbol}:${input.observedAt}:${Math.abs([...signature(input)].reduce((a,c)=>((a*31)+c.charCodeAt(0))|0,7))}`;
  const out: CaseResult = { caseId, symbol: input.symbol, observedAt: input.observedAt, sourceMode: input.sourceMode ?? "UNKNOWN", runs, repeatConsistency, schemaComplianceRate, canonicalFidelityRate, overrideViolationRate, apiSuccessRate, averageLatencyMs, result };
  const s = state.get(key)!; s.results.push(out); state.set(key, s);
  console.log(`[HaikuBenchmarkV2] ${input.symbol} ${result} case=${caseId} consistency=${repeatConsistency.toFixed(2)} fidelity=${canonicalFidelityRate.toFixed(2)} schema=${schemaComplianceRate.toFixed(2)} api=${apiSuccessRate.toFixed(2)}`);
  return { ran: true, reason: gate.reason, result: out };
}

export function getHaikuAuditBenchmarkV2Snapshot(nowMs = Date.now()) {
  const day = istParts(nowMs).date;
  const symbols = (["NIFTY","BANKNIFTY","SENSEX"] as const).map(symbol => {
    const s = state.get(`${day}:${symbol}`) ?? { count: 0, lastCaseAt: 0, lastSignature: null, results: [] };
    const results = s.results.map(r => ({ caseId: r.caseId, observedAt: r.observedAt, result: r.result, repeatConsistency: r.repeatConsistency, schemaComplianceRate: r.schemaComplianceRate, canonicalFidelityRate: r.canonicalFidelityRate, overrideViolationRate: r.overrideViolationRate, apiSuccessRate: r.apiSuccessRate, averageLatencyMs: r.averageLatencyMs }));
    return { symbol, casesRun: s.count, remainingCaseCapacity: Math.max(0, MAX_CASES_PER_SYMBOL_PER_DAY - s.count), results };
  });
  return { version: "HAIKU_AUDIT_BENCHMARK_V2", dateIst: day, startsFromIst: START_DATE_IST, marketWindowIst: "09:15-15:30", repetitionsPerCase: 3, maxCasesPerSymbolPerDay: MAX_CASES_PER_SYMBOL_PER_DAY, offlineReplayCountsAsLive: false, criteria: HAIKU_BENCHMARK_CRITERIA, symbols };
}
