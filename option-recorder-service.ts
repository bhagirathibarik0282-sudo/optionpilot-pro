import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { OPTION_RECORDER_SHADOW_MODE, type RecorderSymbol } from "./option-recorder-shadow.js";
import {
  type RecorderIngestPayload,
  type RecorderProcessedState,
  processRecorderPayload,
  buildHaikuEvidence,
  buildTelegramText,
} from "./option-recorder-runtime.js";

const app = new Hono();
const PORT = Number(process.env.PORT || 8080);
const INGEST_TOKEN = process.env.OPTION_RECORDER_INGEST_TOKEN || "";

const HAIKU_ENABLED = process.env.OPTION_RECORDER_HAIKU_ENABLED === "true";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "";
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const HAIKU_MAX_TOKENS = Math.max(512, Number(process.env.OPTION_RECORDER_HAIKU_MAX_TOKENS || 4096));

const TELEGRAM_ENABLED = process.env.OPTION_RECORDER_TELEGRAM_ENABLED === "true";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

let lastState: (RecorderProcessedState & {
  haiku: { enabled: boolean; configured: boolean; result: string | null; error: string | null };
  telegram: { enabled: boolean; sent: boolean; reason: string };
}) | null = null;

const lastFingerprintByDestination = new Map<string, string>();

function authorized(authHeader: string | undefined): boolean {
  if (!INGEST_TOKEN) return true;
  return authHeader === `Bearer ${INGEST_TOKEN}`;
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

  const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return (data.content || [])
    .map((x) => typeof x.text === "string" ? x.text : "")
    .filter(Boolean)
    .join("\n");
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
  if (!authorized(c.req.header("authorization"))) {
    return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  try {
    const payload = await c.req.json<RecorderIngestPayload>();
    const state = processRecorderPayload(payload);

    let haikuResult: string | null = null;
    let haikuError: string | null = null;

    if (HAIKU_ENABLED) {
      try {
        haikuResult = await runHaikuMultiPass(buildHaikuEvidence(payload, state));
      } catch (err) {
        haikuError = err instanceof Error ? err.message : String(err);
      }
    }

    let sent = false;
    let telegramReason = "DISABLED";

    if (TELEGRAM_ENABLED) {
      const hasSelectedPremium = Object.keys(state.selectedPremiums).length > 0;

      if (!hasSelectedPremium) telegramReason = "NO_VALID_PREMIUM";
      else if (lastFingerprintByDestination.get(state.telegramDestination) === state.fingerprint) telegramReason = "UNCHANGED_DEDUP";
      else {
        sent = await sendTelegram(payload.market.symbol, buildTelegramText(payload, state, haikuResult));
        telegramReason = sent ? "SENT" : "SEND_FAILED_OR_NOT_CONFIGURED";
        if (sent) lastFingerprintByDestination.set(state.telegramDestination, state.fingerprint);
      }
    }

    lastState = {
      ...state,
      haiku: {
        enabled: HAIKU_ENABLED,
        configured: Boolean(ANTHROPIC_API_KEY && ANTHROPIC_MODEL),
        result: haikuResult,
        error: haikuError,
      },
      telegram: { enabled: TELEGRAM_ENABLED, sent, reason: telegramReason },
    };

    return c.json({ ok: true, state: lastState });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[OPTION_RECORDER] listening port=${PORT} mode=${OPTION_RECORDER_SHADOW_MODE.mode} telegram=${TELEGRAM_ENABLED}`);
