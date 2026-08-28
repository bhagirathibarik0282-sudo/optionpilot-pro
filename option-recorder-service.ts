import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  OPTION_RECORDER_SHADOW_MODE,
  type RecorderMarketSnapshot,
  type RecorderOptionSnapshot,
  type RecorderStrategyVerdict,
  type RecorderSymbol,
  validateRecorderOption,
  resolveRecorderConflict,
  recorderTelegramDestination,
} from "./option-recorder-shadow.js";

type IngestPayload = {
  market: RecorderMarketSnapshot;
  options: RecorderOptionSnapshot[];
  verdicts: RecorderStrategyVerdict[];
};

type SelectedPremium = {
  contractKey: string;
  side: "CE" | "PE";
  expiry: string;
  strike: number;
  ltp: number;
  spreadPct: number | null;
  volume: number | null;
  oi: number | null;
};

type ProcessedState = {
  generatedAt: string;
  symbol: RecorderSymbol;
  conflict: ReturnType<typeof resolveRecorderConflict>;
  selectedPremiums: Partial<Record<"SCALP" | "TRADER" | "SWING", SelectedPremium>>;
  validOptionCount: number;
  rejectedOptionCount: number;
  haiku: { enabled: boolean; modelConfigured: boolean; result: string | null; error: string | null };
  telegram: { enabled: boolean; destination: string; sent: boolean; reason: string };
};

const app = new Hono();
const PORT = Number(process.env.PORT || 8080);
const INGEST_TOKEN = process.env.OPTION_RECORDER_INGEST_TOKEN || "";
const HAIKU_ENABLED = process.env.OPTION_RECORDER_HAIKU_ENABLED === "true";
const TELEGRAM_ENABLED = process.env.OPTION_RECORDER_TELEGRAM_ENABLED === "true";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "";
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const HAIKU_MAX_TOKENS = Math.max(512, Number(process.env.OPTION_RECORDER_HAIKU_MAX_TOKENS || 4096));
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

let lastState: ProcessedState | null = null;
const lastFingerprintByDestination = new Map<string, string>();

function requireAuth(c: any): boolean {
  if (!INGEST_TOKEN) return true;
  return c.req.header("authorization") === `Bearer ${INGEST_TOKEN}`;
}

function spreadPct(o: RecorderOptionSnapshot): number | null {
  if (o.ltp == null || o.ltp <= 0 || o.bid == null || o.ask == null) return null;
  return ((o.ask - o.bid) / o.ltp) * 100;
}

function selectPremium(
  payload: IngestPayload,
  verdict: RecorderStrategyVerdict,
): SelectedPremium | null {
  if (verdict.state !== "TRADEABLE" || verdict.direction === "NONE") return null;
  const candidates = payload.options
    .map((o) => ({ o, v: validateRecorderOption(payload.market, o), spread: spreadPct(o) }))
    .filter(({ o, v }) => !v.blocked && o.side === verdict.direction && o.ltp != null && o.ltp > 0)
    .sort((a, b) => {
      const aSpread = a.spread ?? Number.POSITIVE_INFINITY;
      const bSpread = b.spread ?? Number.POSITIVE_INFINITY;
      if (aSpread !== bSpread) return aSpread - bSpread;
      const aDistance = Math.abs(a.o.strike - (payload.market.spot ?? a.o.strike));
      const bDistance = Math.abs(b.o.strike - (payload.market.spot ?? b.o.strike));
      if (aDistance !== bDistance) return aDistance - bDistance;
      if ((a.o.volume ?? 0) !== (b.o.volume ?? 0)) return (b.o.volume ?? 0) - (a.o.volume ?? 0);
      return (b.o.oi ?? 0) - (a.o.oi ?? 0);
    });
  const best = candidates[0]?.o;
  if (!best || best.ltp == null) return null;
  return {
    contractKey: best.contractKey,
    side: best.side,
    expiry: best.expiry,
    strike: best.strike,
    ltp: best.ltp,
    spreadPct: spreadPct(best),
    volume: best.volume,
    oi: best.oi,
  };
}

function buildHaikuInput(payload: IngestPayload, selectedPremiums: ProcessedState["selectedPremiums"], conflict: ProcessedState["conflict"]) {
  return {
    instruction: "Analyze SCALP, TRADER and SWING independently. Use all supplied useful evidence. Perform primary analysis, devil check, contradiction review, and final synthesis. Never invent missing data, never override deterministic validation, and prefer NO_TRADE over weak conviction.",
    market: payload.market,
    verdicts: payload.verdicts,
    selectedPremiums,
    conflict,
    options: payload.options,
  };
}

async function callHaiku(body: unknown): Promise<string> {
  if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL) throw new Error("HAIKU_NOT_CONFIGURED");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: HAIKU_MAX_TOKENS,
      messages: [{ role: "user", content: JSON.stringify(body) }],
    }),
  });
  if (!response.ok) throw new Error(`HAIKU_HTTP_${response.status}`);
  const data = await response.json() as any;
  return Array.isArray(data?.content)
    ? data.content.map((x: any) => typeof x?.text === "string" ? x.text : "").filter(Boolean).join("\n")
    : "";
}

async function runHaikuMultiPass(input: unknown): Promise<string> {
  const primary = await callHaiku({ pass: "PRIMARY", input });
  const devil = await callHaiku({ pass: "DEVIL_CHECK", input, primary });
  const contradiction = await callHaiku({ pass: "CONTRADICTION", input, primary, devil });
  return callHaiku({ pass: "FINAL_SYNTHESIS", input, primary, devil, contradiction });
}

function chatIdFor(symbol: RecorderSymbol): string {
  if (symbol === "NIFTY") return process.env.TELEGRAM_NIFTY_CHAT_ID || "";
  if (symbol === "BANKNIFTY") return process.env.TELEGRAM_BANKNIFTY_CHAT_ID || "";
  return process.env.TELEGRAM_SENSEX_CHAT_ID || "";
}

async function sendTelegram(symbol: RecorderSymbol, text: string): Promise<boolean> {
  const chatId = chatIdFor(symbol);
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return response.ok;
}

function telegramText(payload: IngestPayload, selected: ProcessedState["selectedPremiums"], conflict: ProcessedState["conflict"], haiku: string | null): string {
  const lines = [`${payload.market.symbol} OPTION RECORDER`, `State: ${conflict}`];
  for (const verdict of payload.verdicts) {
    const p = selected[verdict.mode];
    lines.push(`${verdict.mode}: ${verdict.state} ${verdict.direction}${p ? ` | ${p.expiry} ${p.strike}${p.side} @ ${p.ltp}` : ""}`);
  }
  if (haiku) lines.push(`AI: ${haiku.slice(0, 1800)}`);
  return lines.join("\n");
}

async function processPayload(payload: IngestPayload): Promise<ProcessedState> {
  if (!payload?.market || !Array.isArray(payload.options) || !Array.isArray(payload.verdicts)) {
    throw new Error("INVALID_INGEST_PAYLOAD");
  }
  const validations = payload.options.map((o) => validateRecorderOption(payload.market, o));
  const validOptionCount = validations.filter((v) => !v.blocked).length;
  const conflict = resolveRecorderConflict(payload.verdicts);
  const selectedPremiums: ProcessedState["selectedPremiums"] = {};
  for (const verdict of payload.verdicts) {
    const selected = selectPremium(payload, verdict);
    if (selected) selectedPremiums[verdict.mode] = selected;
  }

  let haikuResult: string | null = null;
  let haikuError: string | null = null;
  if (HAIKU_ENABLED) {
    try {
      haikuResult = await runHaikuMultiPass(buildHaikuInput(payload, selectedPremiums, conflict));
    } catch (err) {
      haikuError = err instanceof Error ? err.message : String(err);
    }
  }

  const destination = recorderTelegramDestination(payload.market.symbol);
  const text = telegramText(payload, selectedPremiums, conflict, haikuResult);
  const fingerprint = `${payload.market.symbol}|${conflict}|${payload.verdicts.map((v) => `${v.mode}:${v.state}:${v.direction}`).join("|")}|${Object.values(selectedPremiums).map((p) => p?.contractKey || "").join("|")}`;
  let sent = false;
  let telegramReason = "DISABLED";
  if (TELEGRAM_ENABLED) {
    if (!Object.keys(selectedPremiums).length) telegramReason = "NO_VALID_PREMIUM";
    else if (lastFingerprintByDestination.get(destination) === fingerprint) telegramReason = "UNCHANGED_DEDUP";
    else {
      sent = await sendTelegram(payload.market.symbol, text);
      telegramReason = sent ? "SENT" : "SEND_FAILED_OR_NOT_CONFIGURED";
      if (sent) lastFingerprintByDestination.set(destination, fingerprint);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    symbol: payload.market.symbol,
    conflict,
    selectedPremiums,
    validOptionCount,
    rejectedOptionCount: payload.options.length - validOptionCount,
    haiku: { enabled: HAIKU_ENABLED, modelConfigured: Boolean(ANTHROPIC_API_KEY && ANTHROPIC_MODEL), result: haikuResult, error: haikuError },
    telegram: { enabled: TELEGRAM_ENABLED, destination, sent, reason: telegramReason },
  };
}

app.get("/health", (c) => c.json({
  ok: true,
  service: "OPTION_RECORDER_V1",
  mode: OPTION_RECORDER_SHADOW_MODE.mode,
  productionImpact: OPTION_RECORDER_SHADOW_MODE.productionImpact,
  haikuEnabled: HAIKU_ENABLED,
  haikuConfigured: Boolean(ANTHROPIC_API_KEY && ANTHROPIC_MODEL),
  telegramEnabled: TELEGRAM_ENABLED,
  telegramBotConfigured: Boolean(TELEGRAM_BOT_TOKEN),
  manualRailwayVariablesRequired: true,
}));

app.get("/status", (c) => c.json({ ok: true, lastState }));

app.post("/ingest", async (c) => {
  if (!requireAuth(c)) return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
  try {
    const payload = await c.req.json<IngestPayload>();
    lastState = await processPayload(payload);
    return c.json({ ok: true, state: lastState });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[OPTION_RECORDER] listening port=${PORT} mode=${OPTION_RECORDER_SHADOW_MODE.mode} telegram=${TELEGRAM_ENABLED}`);
