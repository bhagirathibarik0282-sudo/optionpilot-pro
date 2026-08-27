export type Phase74CanonicalStatus = {
  version: "OP_LIVE_V2";
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  observedAt: string;
  validatorState: string;
  blockers: string[];
  verdict: string;
  score: number | null;
  maxScore: number | null;
  freshness: string;
  deterministicExplanation: string;
  aiSignature: string;
  displaySignature: string;
};

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function collectStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item: any) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (item && typeof item === "object") {
      const text = firstString(item, ["reason", "code", "message", "name", "signal"]);
      return text ? [text] : [];
    }
    return [];
  }))].slice(0, 4);
}

function normalizeValidation(validation: any): { state: string; blockers: string[] } {
  const explicit = firstString(validation, ["overallStatus", "overall", "status", "state", "result"]);
  const blockers = [
    ...collectStrings(validation?.blockers),
    ...collectStrings(validation?.blockingReasons),
    ...collectStrings(validation?.reasons),
    ...collectStrings(validation?.errors),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  if (explicit) return { state: explicit.toUpperCase(), blockers };
  if (validation?.valid === true || validation?.isValid === true || validation?.ok === true) return { state: "PASS", blockers };
  if (validation?.valid === false || validation?.isValid === false || validation?.ok === false) return { state: "BLOCKED", blockers };
  if (blockers.length) return { state: "BLOCKED", blockers };
  return { state: "UNKNOWN", blockers };
}

function normalizeFreshness(metrics: any): string {
  const value = firstString(metrics, ["freshnessStatus", "freshness_state", "freshness", "dataStatus", "quoteFreshness"]);
  return value ? value.toUpperCase() : "UNKNOWN";
}

function deterministicExplanationFor(state: string, verdict: string, blockers: string[]): string {
  if (state.includes("BLOCK") || state.includes("FAIL") || state.includes("INVALID")) {
    return blockers.length
      ? `Validator blocked: ${blockers.join(", ")}. Trading decision is not promoted.`
      : "Validator blocked the current snapshot. Trading decision is not promoted.";
  }
  if (verdict.toUpperCase().includes("DATA UNAVAILABLE")) {
    return "Canonical rule engine has insufficient usable data; no trade conclusion is inferred.";
  }
  return `Canonical engine processed the snapshot and returned ${verdict}. This status card does not alter that decision.`;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stablePart(value: unknown): string {
  return String(value ?? "UNKNOWN").replace(/\s+/g, " ").trim();
}

export function buildPhase74CanonicalStatus(input: {
  symbol: string;
  observedAt?: string;
  metrics: any;
  validation: any;
  rule: any;
}): Phase74CanonicalStatus {
  const symbol = String(input.symbol || "").toUpperCase();
  if (!["NIFTY", "BANKNIFTY", "SENSEX"].includes(symbol)) throw new Error(`Unsupported Phase74 symbol: ${symbol}`);

  const { state, blockers } = normalizeValidation(input.validation);
  const verdict = firstString(input.rule, ["verdict", "state", "result"]) || "DATA UNAVAILABLE";
  const score = finiteOrNull(input.rule?.score);
  const maxScore = finiteOrNull(input.rule?.maxScore);
  const freshness = normalizeFreshness(input.metrics);
  const deterministicExplanation = deterministicExplanationFor(state, verdict, blockers);

  // AI signature deliberately excludes continuously changing numeric score so Haiku is called only
  // when the decision/health state meaningfully changes. Display signature still carries score.
  const aiSignature = [symbol, state, freshness, verdict, blockers.join("|")].map(stablePart).join("::");
  const displaySignature = [aiSignature, score ?? "NA", maxScore ?? "NA"].map(stablePart).join("::");

  return {
    version: "OP_LIVE_V2",
    symbol: symbol as Phase74CanonicalStatus["symbol"],
    observedAt: input.observedAt || new Date().toISOString(),
    validatorState: state,
    blockers,
    verdict,
    score,
    maxScore,
    freshness,
    deterministicExplanation,
    aiSignature,
    displaySignature,
  };
}

export function buildPhase74HaikuPrompt(status: Phase74CanonicalStatus): string {
  const evidence = {
    version: status.version,
    symbol: status.symbol,
    observedAt: status.observedAt,
    validatorState: status.validatorState,
    freshness: status.freshness,
    blockers: status.blockers,
    verdict: status.verdict,
    score: status.score,
    maxScore: status.maxScore,
  };

  return [
    "OPTIONPILOT_HAIKU_EXPLAIN_V2",
    "ROLE: Explanation-only auditor. You are NOT trading-decision authority.",
    "RULES:",
    "1. Use ONLY the canonical JSON below.",
    "2. Never change or reinterpret verdict, score, candidate, entry, stop-loss, target, or execution state.",
    "3. Never invent missing values, market direction, future movement, probability, buyer/seller identity, or institutional activity.",
    "4. If validator is blocked/failed/invalid, explain the blocker and do not suggest a trade.",
    "5. If data is unavailable, explicitly say evidence is insufficient.",
    "6. Return ONLY valid JSON: {\"explanation\":\"one short, simple Odia+English mixed explanation, maximum 2 sentences\"}.",
    `CANONICAL_JSON=${JSON.stringify(evidence)}`,
  ].join("\n");
}

async function callAnthropicModel(apiKey: string, model: string, prompt: string): Promise<string | null> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 180,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const data: any = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim()
    : "";
  return text || null;
}

export async function explainPhase74WithHaiku(status: Phase74CanonicalStatus, apiKey?: string | null): Promise<{ explanation: string; source: "HAIKU" | "DETERMINISTIC_FALLBACK" }> {
  if (!apiKey) return { explanation: status.deterministicExplanation, source: "DETERMINISTIC_FALLBACK" };
  const prompt = buildPhase74HaikuPrompt(status);

  for (const model of ["claude-haiku-4-5", "claude-3-haiku-20240307"]) {
    try {
      const raw = await callAnthropicModel(apiKey, model, prompt);
      if (!raw) continue;
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.explanation === "string" && parsed.explanation.trim()) {
        return { explanation: parsed.explanation.trim().slice(0, 420), source: "HAIKU" };
      }
    } catch {
      // Fail closed to deterministic explanation; AI availability must never block canonical processing.
    }
  }
  return { explanation: status.deterministicExplanation, source: "DETERMINISTIC_FALLBACK" };
}

export function renderPhase74TelegramStatus(status: Phase74CanonicalStatus, explanation: string, explanationSource: "HAIKU" | "DETERMINISTIC_FALLBACK"): string {
  const scoreText = status.score == null ? "N/A" : status.maxScore == null ? String(status.score) : `${status.score}/${status.maxScore}`;
  const blockerText = status.blockers.length ? status.blockers.join(", ") : "NONE REPORTED";
  const explainLabel = explanationSource === "HAIKU" ? "Haiku explain" : "Rule explain";

  return [
    `🧪 <b>OPTIONPILOT • OP LIVE V2 • ${esc(status.symbol)}</b>`,
    `<b>SYSTEM:</b> BACKGROUND OBSERVING | Dashboard unchanged`,
    `<b>DATA:</b> ${esc(status.freshness)} | <b>VALIDATOR:</b> ${esc(status.validatorState)}`,
    `<b>ENGINE:</b> ${esc(status.verdict)} | <b>SCORE:</b> ${esc(scoreText)}`,
    `<b>BLOCKER:</b> ${esc(blockerText)}`,
    `<b>${explainLabel}:</b> ${esc(explanation)}`,
    `<b>QUALIFICATION:</b> LIVE EVIDENCE OBSERVING • no auto-promotion`,
  ].join("\n");
}
