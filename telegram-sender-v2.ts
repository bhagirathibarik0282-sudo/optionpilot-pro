import type { CanonicalTelegramCard, TelegramSymbol } from "./telegram-card-contract.js";
import { TELEGRAM_INDEX_GROUP_ROUTING } from "./telegram-card-contract.js";
import { renderTelegramCardV2 } from "./telegram-card-renderer-v2.js";

const CHAT_ID_ENV: Record<TelegramSymbol, string> = {
  NIFTY: "TELEGRAM_NIFTY_CHAT_ID",
  BANKNIFTY: "TELEGRAM_BANKNIFTY_CHAT_ID",
  SENSEX: "TELEGRAM_SENSEX_CHAT_ID",
};

const lastSent = new Map<TelegramSymbol, { fingerprint: string; at: number }>();
const DUPLICATE_GUARD_MS = 3 * 60 * 1000;

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

function fingerprint(card: CanonicalTelegramCard, message: string): string {
  return [
    card.symbol,
    card.headline.verdict,
    card.candidate.side,
    card.candidate.strike ?? "NONE",
    card.candidate.expiry ?? "NONE",
    card.tradePlan.entry ?? "NONE",
    card.tradePlan.sl ?? "NONE",
    message,
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
    const previous = lastSent.get(card.symbol);
    const now = Date.now();

    if (previous && previous.fingerprint === fp && now - previous.at < DUPLICATE_GUARD_MS) {
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

    lastSent.set(card.symbol, { fingerprint: fp, at: now });

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
