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
import { buildImmediateExpansionTelegramRuntime } from "./immediate-expansion-telegram-runtime.js";
import { ImmediateEventTruthRecorder } from "./immediate-event-truth-recorder.js";
import type { ImmediateVerifiedEvent } from "./immediate-expansion-chain.js";
import { ImmediateMetricIngestBridge } from "./immediate-metric-ingest-bridge.js";
import type { ImmediateMetricSample } from "./immediate-abnormal-change-detector.js";
import { fetchSourcePayloads } from "./option-recorder-source-adapter.js";

const app = new Hono();
const PORT = Number(process.env.PORT || 8080);
const INGEST_TOKEN = process.env.OPTION_RECORDER_INGEST_TOKEN || "";

const SOURCE_URL = process.env.OPTION_RECORDER_SOURCE_URL || "";
const SOURCE_TOKEN = process.env.OPTION_RECORDER_SOURCE_TOKEN || "";
const SOURCE_POLL_MS = Math.max(30_000, Number(process.env.OPTION_RECORDER_POLL_MS || 60_000));

const HAIKU_ENABLED = process.env.OPTION_RECORDER_HAIKU_ENABLED === "true";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "";
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const HAIKU_MAX_TOKENS = Math.max(512, Number(process.env.OPTION_RECORDER_HAIKU_MAX_TOKENS || 4096));

const TELEGRAM_ENABLED = process.env.OPTION_RECORDER_TELEGRAM_ENABLED === "true";
const IMMEDIATE_TELEGRAM_ENABLED = process.env.OPTION_RECORDER_IMMEDIATE_TELEGRAM_ENABLED === "true";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const immediateTruthRecorder = new ImmediateEventTruthRecorder();
const immediateMetricBridge = new ImmediateMetricIngestBridge(immediateTruthRecorder);

let lastState: (RecorderProcessedState & {
  haiku: { enabled: boolean; configured: boolean; result: string | null; error: string | null };
  telegram: { enabled: boolean; sent: boolean; reason: string };
  immediateTelegram: {
    enabled: boolean;
    eligible: boolean;
    sent: boolean;
    reason: string;
    verdict: "CE_FAVOURED" | "PE_FAVOURED" | "WAIT" | null;
  };
}) | null = null;

let lastSourceError: string | null = null;
let lastSourcePollAt: string | null = null;
const lastFingerprintByDestination = new Map<string, string>();
const lastImmediateFingerprintByDestination = new Map<string, string>();
const lastSnapshotBySymbol = new Map<RecorderSymbol, string>();

function authorized(authHeader: string | undefined): boolean {
  if (!INGEST_TOKEN) return true;
  return authHeader === `Bearer ${INGEST_TOKEN}`;
}

function recorderSymbol(value: string): RecorderSymbol | null {
  const symbol = value.trim().toUpperCase();
  return symbol === "NIFTY" || symbol === "BANKNIFTY" || symbol === "SENSEX" ? symbol : null;
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

async function processOne(payload: RecorderIngestPayload) {
  const state = processRecorderPayload(payload);
  const immediate = buildImmediateExpansionTelegramRuntime(payload);

  let haikuResult: string | null = null;
  let haikuError: string | null = null;

  if (HAIKU_ENABLED) {
    try {
      haikuResult = await runHaikuMultiPass(buildHaikuEvidence(payload, state));
    } catch (err) {
      haikuError = err instanceof Error ? err.message : String(err);
    }
  }

  let immediateSent = false;
  let immediateReason = IMMEDIATE_TELEGRAM_ENABLED ? immediate.reason : "DISABLED";
  if (TELEGRAM_ENABLED && IMMEDIATE_TELEGRAM_ENABLED && immediate.eligible && immediate.text && immediate.fingerprint) {
    if (lastImmediateFingerprintByDestination.get(state.telegramDestination) === immediate.fingerprint) {
      immediateReason = "UNCHANGED_DEDUP";
    } else {
      immediateSent = await sendTelegram(payload.market.symbol, immediate.text);
      immediateReason = immediateSent ? "SENT" : "SEND_FAILED_OR_NOT_CONFIGURED";
      if (immediateSent) lastImmediateFingerprintByDestination.set(state.telegramDestination, immediate.fingerprint);
    }
  }

  let sent = false;
  let telegramReason = "DISABLED";

  if (TELEGRAM_ENABLED) {
    const immediateOwnsSnapshot = IMMEDIATE_TELEGRAM_ENABLED && immediate.eligible;
    const hasSelectedPremium = Object.keys(state.selectedPremiums).length > 0;

    if (immediateOwnsSnapshot) telegramReason = "SUPPRESSED_BY_IMMEDIATE_MESSAGE";
    else if (!hasSelectedPremium) telegramReason = "NO_VALID_PREMIUM";
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
    immediateTelegram: {
      enabled: TELEGRAM_ENABLED && IMMEDIATE_TELEGRAM_ENABLED,
      eligible: immediate.eligible,
      sent: immediateSent,
      reason: immediateReason,
      verdict: immediate.chain?.verdict ?? null,
    },
  };

  return lastState;
}

async function pollSource(): Promise<void> {
  if (!SOURCE_URL) return;
  lastSourcePollAt = new Date().toISOString();
  try {
    const payloads = await fetchSourcePayloads(SOURCE_URL, SOURCE_TOKEN);
    for (const payload of payloads) {
      const currentSnapshot = payload.market.snapshotId;
      if (!currentSnapshot || lastSnapshotBySymbol.get(payload.market.symbol) === currentSnapshot) continue;
      await processOne(payload);
      lastSnapshotBySymbol.set(payload.market.symbol, currentSnapshot);
    }
    lastSourceError = null;
  } catch (err) {
    lastSourceError = err instanceof Error ? err.message : String(err);
    console.warn(`[OPTION_RECORDER][SOURCE] ${lastSourceError}`);
  }
}

app.get("/health", (c) => c.json({
  ok: true,
  service: "OPTION_RECORDER_V1",
  mode: OPTION_RECORDER_SHADOW_MODE.mode,
  productionImpact: OPTION_RECORDER_SHADOW_MODE.productionImpact,
  sourceConfigured: Boolean(SOURCE_URL),
  sourcePollMs: SOURCE_POLL_MS,
  immediateSourceGranularity: "SNAPSHOT_OR_INGEST_PLUS_EXPLICIT_METRIC_OR_EVENT_INPUT",
  immediateMetricBridge: immediateMetricBridge.stats(),
  immediateTruthRecorder: immediateTruthRecorder.stats(),
  lastSourcePollAt,
  lastSourceError,
  haikuEnabled: HAIKU_ENABLED,
  haikuConfigured: Boolean(ANTHROPIC_API_KEY && ANTHROPIC_MODEL),
  telegramEnabled: TELEGRAM_ENABLED,
  immediateTelegramEnabled: TELEGRAM_ENABLED && IMMEDIATE_TELEGRAM_ENABLED,
  telegramBotConfigured: Boolean(TELEGRAM_BOT_TOKEN),
  manualRailwayVariablesRequired: true,
}));

app.get("/status", (c) => c.json({
  ok: true,
  lastState,
  lastSourcePollAt,
  lastSourceError,
  immediateMetricBridge: immediateMetricBridge.stats(),
  immediateTruthRecorder: immediateTruthRecorder.stats(),
}));

app.get("/immediate-events/:symbol", (c) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const symbol = recorderSymbol(c.req.param("symbol"));
  if (!symbol) return c.json({ ok: false, error: "INVALID_SYMBOL" }, 400);
  const limit = Number(c.req.query("limit") || 100);
  return c.json({ ok: true, symbol, events: immediateTruthRecorder.list(symbol, limit) });
});

app.post("/immediate-metrics", async (c) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
  try {
    const body = await c.req.json<{
      symbol: string;
      lockedTrendSide: "CE" | "PE" | "NONE";
      fresh?: boolean;
      sample: ImmediateMetricSample;
    }>();
    const symbol = recorderSymbol(body.symbol || "");
    if (!symbol) return c.json({ ok: false, error: "INVALID_SYMBOL" }, 400);
    if (body.lockedTrendSide !== "CE" && body.lockedTrendSide !== "PE" && body.lockedTrendSide !== "NONE") {
      return c.json({ ok: false, error: "INVALID_LOCKED_TREND_SIDE" }, 400);
    }
    const result = immediateMetricBridge.ingest({
      symbol,
      lockedTrendSide: body.lockedTrendSide,
      fresh: body.fresh,
      sample: body.sample,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/immediate-events", async (c) => {
  if (!authorized(c.req.header("authorization"))) return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
  try {
    const body = await c.req.json<{
      symbol: string;
      source: string;
      snapshotId?: string | null;
      receivedAt?: string;
      event: ImmediateVerifiedEvent;
    }>();
    const symbol = recorderSymbol(body.symbol || "");
    if (!symbol) return c.json({ ok: false, error: "INVALID_SYMBOL" }, 400);
    const result = immediateTruthRecorder.append({
      symbol,
      source: body.source,
      snapshotId: body.snapshotId,
      receivedAt: body.receivedAt,
      event: body.event,
    });
    return c.json(result, result.ok ? 200 : 400);
  } catch (err) {
    return c.json({ ok: false, accepted: false, duplicate: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.post("/ingest", async (c) => {
  if (!authorized(c.req.header("authorization"))) {
    return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  try {
    const payload = await c.req.json<RecorderIngestPayload>();
    const state = await processOne(payload);
    return c.json({ ok: true, state });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[OPTION_RECORDER] listening port=${PORT} mode=${OPTION_RECORDER_SHADOW_MODE.mode} telegram=${TELEGRAM_ENABLED} immediateTelegram=${IMMEDIATE_TELEGRAM_ENABLED} source=${Boolean(SOURCE_URL)}`);

if (SOURCE_URL) {
  void pollSource();
  setInterval(() => void pollSource(), SOURCE_POLL_MS);
}
