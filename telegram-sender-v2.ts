import type { CanonicalTelegramCard, TelegramSymbol } from "./telegram-card-contract.js";
import { TELEGRAM_INDEX_GROUP_ROUTING } from "./telegram-card-contract.js";
import { renderTelegramCardV2 } from "./telegram-card-renderer-v2.js";

const CHAT_ID_ENV: Record<TelegramSymbol, string> = {
  NIFTY: "TELEGRAM_NIFTY_CHAT_ID",
  BANKNIFTY: "TELEGRAM_BANKNIFTY_CHAT_ID",
  SENSEX: "TELEGRAM_SENSEX_CHAT_ID",
};

/**
 * Same-state Telegram suppression.
 *
 * A repeated NO TRADE / blocker card often differs only because the renderer adds
 * a fresh clock timestamp. Using the raw message as a fingerprint therefore let
 * unchanged alerts re-fire every few minutes. Keep one stable fingerprint per
 * symbol for the current IST trading date and only speak again when the actual
 * message state changes.
 */
const lastSent = new Map<TelegramSymbol, { fingerprint: string; istDate: string }>();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`TELEGRAM_CONFIG_MISSING:${name}`);
  return value;
}

function assertStrictRouting(card: CanonicalTelegramCard): void {
  const expectedGroup = TELEGRAM_INDEX_GROUP_ROUTING[card.symbol];
  if (
    card.routing.groupName !== expectedGroup ||
    card.routing.strictIndexIsolation !== true ||
    card.routing.crossPostAllowed !== false
  ) {
    throw new Error(`TELEGRAM_ROUTING_MISMATCH:${card.symbol}:${card.routing.groupName}`);
  }
}

function istDateKey(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** Strip only volatile clock text. Market/risk numbers are intentionally kept. */
function normalizeMessageForDedup(message: string): string {
  return message
    // e.g. "⏰ 2:27:34 pm | Manual review only."
    .replace(/(?:⏰\s*)?\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\s*\|\s*Manual review only\.?/gi, "<MANUAL_REVIEW_TIME>")
    // e.g. "Time: 2:24:35 pm"
    .replace(/\bTime\s*:\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "Time:<VOLATILE>")
    // generic ISO timestamps occasionally embedded by preview paths
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g, "<ISO_TIME>")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fingerprint(card: CanonicalTelegramCard, message: string): string {
  return [
    card.symbol,
    card.headline.verdict,
    card.candidate.side,
    card.candidate.strike ?? "NONE",
    card.candidate.expiry ?? "NONE",
    card.tradePlan.entry ?? "NONE",
    card.tradePlan.sl ?? "NONE",
    normalizeMessageForDedup(message),
  ].join("|");
}

export type TelegramSendResult =
  | { ok: true; sent: true; symbol: TelegramSymbol; destinationGroup: string; telegramMessageId: number | null }
  | { ok: true; sent: false; symbol: TelegramSymbol; destinationGroup: string; reason: "DUPLICATE_GUARD" | "DRY_RUN" }
  | { ok: false; sent: false; symbol: TelegramSymbol; destinationGroup: string; error: string };

export async function sendTelegramCardV2(
  card: CanonicalTelegramCard,
  options: { dryRun?: boolean } = {},
): Promise<TelegramSendResult> {
  const dryRun = options.dryRun ?? true;
  const destinationGroup = TELEGRAM_INDEX_GROUP_ROUTING[card.symbol];

  try {
    assertStrictRouting(card);
    const message = renderTelegramCardV2(card);
    const fp = fingerprint(card, message);
    const today = istDateKey();
    const previous = lastSent.get(card.symbol);

    // Same semantic state is spoken only once per IST trading date.
    // Any real market/risk/candidate number change remains in the normalized
    // message, changes the fingerprint, and is eligible immediately.
    if (previous && previous.istDate === today && previous.fingerprint === fp) {
      return { ok: true, sent: false, symbol: card.symbol, destinationGroup, reason: "DUPLICATE_GUARD" };
    }

    if (dryRun) {
      return { ok: true, sent: false, symbol: card.symbol, destinationGroup, reason: "DRY_RUN" };
    }

    const botToken = requiredEnv("TELEGRAM_BOT_TOKEN");
    const chatId = requiredEnv(CHAT_ID_ENV[card.symbol]);

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    if (!response.ok || payload?.ok !== true) {
      throw new Error(`TELEGRAM_SEND_FAILED:${response.status}:${payload?.description ?? "UNKNOWN"}`);
    }

    lastSent.set(card.symbol, { fingerprint: fp, istDate: today });

    return {
      ok: true,
      sent: true,
      symbol: card.symbol,
      destinationGroup,
      telegramMessageId: payload.result?.message_id ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      sent: false,
      symbol: card.symbol,
      destinationGroup,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
