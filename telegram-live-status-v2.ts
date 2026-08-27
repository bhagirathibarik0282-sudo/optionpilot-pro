export type Phase74Symbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

export type Phase74CanonicalStatus = {
  version: "OP_LIVE_V2";
  symbol: Phase74Symbol;
  observedAt: string;
  validatorState: string;
  blockers: string[];
  verdict: string;
  score: number | null;
  maxScore: number | null;
  freshness: string;
  evidence: string[];
  deterministicExplanation: string;
  aiSignature: string;
  displaySignature: string;
};

export type Phase74TelegramTransport = {
  botToken: string | null;
  chatIds: Record<Phase74Symbol, string | null>;
};

type DeliveryState = {
  dayKey: string;
  messageId: number;
  aiSignature: string;
  displaySignature: string;
  explanation: string;
  explanationSource: "HAIKU" | "DETERMINISTIC_FALLBACK";
  lastEditAt: number;
};

const deliveryState = new Map<Phase74Symbol, DeliveryState>();

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
      const text = firstString(item, ["reason", "code", "message", "name", "signal", "label"]);
      return text ? [text] : [];
    }
    return [];
  }))].slice(0, 6);
}

function collectRuleEvidence(rule: any): string[] {
  const evidence = [
    ...collectStrings(rule?.reasons),
    ...collectStrings(rule?.scoreReasons),
    ...collectStrings(rule?.warnings),
  ];
  if (Array.isArray(rule?.contributions)) evidence.push(...collectStrings(rule.contributions));
  return [...new Set(evidence)].slice(0, 5);
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
  const value = firstString(metrics, ["freshnessStatus", "freshness_status", "freshnessState", "freshness_state", "freshness", "dataStatus", "quoteFreshness"]);
  return value ? value.toUpperCase() : "UNKNOWN";
}

function deterministicExplanationFor(state: string, verdict: string, blockers: string[], evidence: string[]): string {
  if (state.includes("BLOCK") || state.includes("FAIL") || state.includes("INVALID")) {
    return blockers.length
      ? `Validator blocked: ${blockers.join(", ")}. Trading decision is not promoted.`
      : "Validator blocked the current snapshot. Trading decision is not promoted.";
  }
  if (verdict.toUpperCase().includes("DATA UNAVAILABLE")) {
    return "Canonical rule engine has insufficient usable data; no trade conclusion is inferred.";
  }
  if (evidence.length) return `Canonical engine returned ${verdict}. Key evidence: ${evidence.slice(0, 2).join("; ")}.`;
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

function validatorEmoji(state: string): string {
  const v = state.toUpperCase();
  if (v.includes("PASS") || v.includes("VALID") || v === "OK") return "✅";
  if (v.includes("BLOCK") || v.includes("FAIL") || v.includes("INVALID")) return "🔴";
  return "⚪";
}

function freshnessEmoji(state: string): string {
  const v = state.toUpperCase();
  if (v.includes("FRESH") || v.includes("LIVE")) return "🟢";
  if (v.includes("STALE") || v.includes("EXPIRED")) return "🔴";
  return "⚪";
}

// PHASE75_TELEGRAM_EMOJI_INSIGHT_V1
function verdictEmoji(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.includes("SIDEWAYS") || v.includes("RANGE") || v.includes("FLAT")) return "🐢";
  if (v.includes("READY TO WATCH") || v.includes("READY_TO_WATCH") || v.includes("SETUP FORMING") || v.includes("WATCH")) return "👁️";
  if (v.includes("TRANSITION") || v.includes("REVERSING") || v.includes("REVERSAL")) return "🔄";
  if (v.includes("CONFLICT")) return "⚔️";
  if (v.includes("CONFIRMED") || v.includes("CONFIRM")) return "✅";
  if (v.includes("BULL") || v.includes("BEST_CE") || v.includes("BUY CE")) return "📈🟢";
  if (v.includes("BEAR") || v.includes("BEST_PE") || v.includes("BUY PE")) return "📉🔴";
  if (v.includes("BLOCK") || v.includes("UNAVAILABLE")) return "⛔";
  if (v.includes("NO TRADE") || v.includes("NEUTRAL") || v.includes("WAIT")) return "⏸️";
  return "🧭";
}

const PHASE75_TRADING_INSIGHTS = [
  "No clean setup is also a valid trading decision.",
  "Protect capital first; opportunity can be reassessed on the next clean setup.",
  "Sideways conditions reward patience more than prediction.",
  "A setup becomes useful only when evidence and risk are both acceptable.",
  "Follow the confirmed process, not a single noisy candle.",
  "When evidence conflicts, reducing conviction is information—not weakness.",
] as const;

function phase75TradingInsight(status: Phase74CanonicalStatus): string {
  const day = status.observedAt.slice(0, 10);
  const seed = [...(status.symbol + day)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return PHASE75_TRADING_INSIGHTS[seed % PHASE75_TRADING_INSIGHTS.length];
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
  const evidence = collectRuleEvidence(input.rule);
  const deterministicExplanation = deterministicExplanationFor(state, verdict, blockers, evidence);
  const aiSignature = [symbol, state, freshness, verdict, blockers.join("|"), evidence.join("|")].map(stablePart).join("::");
  const displaySignature = [aiSignature, score ?? "NA", maxScore ?? "NA"].map(stablePart).join("::");

  return {
    version: "OP_LIVE_V2",
    symbol: symbol as Phase74Symbol,
    observedAt: input.observedAt || new Date().toISOString(),
    validatorState: state,
    blockers,
    verdict,
    score,
    maxScore,
    freshness,
    evidence,
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
    canonicalEvidence: status.evidence,
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
    "6. Explain WHY the canonical engine is in this state using only blocker/evidence fields; maximum 2 short sentences.",
    "7. Return ONLY valid JSON: {\"explanation\":\"simple Odia+English mixed explanation\"}.",
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
      // AI is explanation-only; failure must never block canonical processing.
    }
  }
  return { explanation: status.deterministicExplanation, source: "DETERMINISTIC_FALLBACK" };
}

export function renderPhase74TelegramStatus(status: Phase74CanonicalStatus, explanation: string, explanationSource: "HAIKU" | "DETERMINISTIC_FALLBACK"): string {
  const scoreText = status.score == null ? "N/A" : status.maxScore == null ? String(status.score) : `${status.score}/${status.maxScore}`;
  const blockerText = status.blockers.length ? status.blockers.join(", ") : "NONE REPORTED";
  const evidenceText = status.evidence.length ? status.evidence.slice(0, 3).join(" • ") : "No extra canonical reason reported";
  const explainLabel = explanationSource === "HAIKU" ? "🤖 Haiku explain" : "🧠 Rule explain";

  return [
    `🧪⚡ <b>OPTIONPILOT • OP LIVE V2 • ${esc(status.symbol)}</b>`,
    `<b>SYSTEM:</b> 🔵 BACKGROUND PROCESSING | Dashboard unchanged`,
    `<b>DATA:</b> ${freshnessEmoji(status.freshness)} ${esc(status.freshness)} | <b>VALIDATOR:</b> ${validatorEmoji(status.validatorState)} ${esc(status.validatorState)}`,
    `<b>ENGINE:</b> ${verdictEmoji(status.verdict)} ${esc(status.verdict)} | <b>SCORE:</b> ${esc(scoreText)}`,
    `<b>BLOCKER:</b> ${status.blockers.length ? "🟠" : "✅"} ${esc(blockerText)}`,
    `<b>EVIDENCE:</b> ${esc(evidenceText)}`,
    `<b>${explainLabel}:</b> ${esc(explanation)}`,
    `<b>QUALIFICATION:</b> 🧪 LIVE EVIDENCE OBSERVING • no auto-promotion`,
    `<b>📚 Trading Insight:</b> ${esc(phase75TradingInsight(status))}`,
  ].join("\n");
}

export function resolvePhase74Transport(env: Record<string, string | undefined> = process.env): Phase74TelegramTransport {
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value) return value;
    }
    return null;
  };
  return {
    botToken: first("PHASE74_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"),
    chatIds: {
      NIFTY: first("PHASE74_NIFTY_CHAT_ID", "TELEGRAM_NIFTY_CHAT_ID", "NIFTY_TELEGRAM_CHAT_ID"),
      BANKNIFTY: first("PHASE74_BANKNIFTY_CHAT_ID", "TELEGRAM_BANKNIFTY_CHAT_ID", "BANKNIFTY_TELEGRAM_CHAT_ID"),
      SENSEX: first("PHASE74_SENSEX_CHAT_ID", "TELEGRAM_SENSEX_CHAT_ID", "SENSEX_TELEGRAM_CHAT_ID"),
    },
  };
}

export function validatePhase74Transport(transport: Phase74TelegramTransport): { ok: true } | { ok: false; reason: string } {
  if (!transport.botToken) return { ok: false, reason: "BOT_TOKEN_MISSING" };
  const ids = (["NIFTY", "BANKNIFTY", "SENSEX"] as const).map((symbol) => transport.chatIds[symbol]);
  if (ids.some((id) => !id)) return { ok: false, reason: "THREE_GROUP_CHAT_IDS_REQUIRED" };
  if (new Set(ids).size !== 3) return { ok: false, reason: "GROUP_CHAT_IDS_MUST_BE_DISTINCT" };
  return { ok: true };
}

async function telegramApi(botToken: string, method: string, payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED`);
  return data.result;
}

export async function publishPhase74TelegramLiveV2(input: {
  symbol: string;
  metrics: any;
  validation: any;
  rule: any;
  anthropicApiKey?: string | null;
  transport?: Phase74TelegramTransport;
  nowMs?: number;
}): Promise<{ sent: boolean; edited: boolean; reason: string }> {
  const status = buildPhase74CanonicalStatus({
    symbol: input.symbol,
    observedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    metrics: input.metrics,
    validation: input.validation,
    rule: input.rule,
  });
  const transport = input.transport ?? resolvePhase74Transport();
  const transportCheck = validatePhase74Transport(transport);
  if (!transportCheck.ok) return { sent: false, edited: false, reason: transportCheck.reason };

  const chatId = transport.chatIds[status.symbol]!;
  const now = input.nowMs ?? Date.now();
  const ist = new Date(now + 330 * 60 * 1000);
  const dayKey = ist.toISOString().slice(0, 10);
  const existing = deliveryState.get(status.symbol);
  const newDay = !existing || existing.dayKey !== dayKey;
  const aiChanged = newDay || !existing || existing.aiSignature !== status.aiSignature;

  let explanation = existing?.explanation ?? status.deterministicExplanation;
  let explanationSource: "HAIKU" | "DETERMINISTIC_FALLBACK" = existing?.explanationSource ?? "DETERMINISTIC_FALLBACK";
  if (aiChanged) {
    const explained = await explainPhase74WithHaiku(status, input.anthropicApiKey ?? null);
    explanation = explained.explanation;
    explanationSource = explained.source;
  }

  const text = renderPhase74TelegramStatus(status, explanation, explanationSource);
  const displayChanged = !existing || existing.displaySignature !== status.displaySignature;
  const throttleElapsed = !existing || now - existing.lastEditAt >= 180_000;

  if (newDay || !existing?.messageId) {
    const result = await telegramApi(transport.botToken!, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    const messageId = Number(result?.message_id);
    if (!Number.isFinite(messageId)) throw new Error("TELEGRAM_MESSAGE_ID_MISSING");
    deliveryState.set(status.symbol, {
      dayKey, messageId, aiSignature: status.aiSignature, displaySignature: status.displaySignature,
      explanation, explanationSource, lastEditAt: now,
    });
    return { sent: true, edited: false, reason: "NEW_INDEX_DAY_CARD" };
  }

  if (aiChanged || (displayChanged && throttleElapsed)) {
    await telegramApi(transport.botToken!, "editMessageText", {
      chat_id: chatId,
      message_id: existing.messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    deliveryState.set(status.symbol, {
      ...existing,
      dayKey,
      aiSignature: status.aiSignature,
      displaySignature: status.displaySignature,
      explanation,
      explanationSource,
      lastEditAt: now,
    });
    return { sent: false, edited: true, reason: aiChanged ? "MEANINGFUL_STATE_CHANGE" : "THROTTLED_DISPLAY_UPDATE" };
  }

  return { sent: false, edited: false, reason: "NO_MEANINGFUL_CHANGE" };
}
