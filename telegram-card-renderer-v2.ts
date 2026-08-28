import type { CanonicalTelegramCard } from "./telegram-card-contract";
import { TELEGRAM_INDEX_GROUP_ROUTING } from "./telegram-card-contract";

function money(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `₹${value.toFixed(2)}`;
}

function textOrDash(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : "—";
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

function statusEmoji(verdict: string): string {
  if (verdict === "BUY CE") return "🟢";
  if (verdict === "BUY PE") return "🔴";
  if (verdict === "MANAGE OPEN POSITION") return "🟡";
  if (verdict === "BLOCKED") return "⛔";
  return "⚪";
}

function compactReasons(card: CanonicalTelegramCard): string {
  const reasons = card.reasons.filter((x) => x && x.trim()).slice(0, 3);
  return reasons.length ? reasons.join(" • ") : "Edge insufficient / data not ready";
}

/**
 * Telegram V2 renderer: concise, emoji-led, one-screen execution card.
 * Routing is strict per index. No cross-posting is allowed.
 * This renderer only formats the canonical card; it does not send messages,
 * fetch data, compute verdicts, select candidates, or create orders.
 */
export function renderTelegramCardV2(card: CanonicalTelegramCard): string {
  assertStrictRouting(card);

  const c = card.candidate;
  const p = card.tradePlan;
  const verdict = card.headline.verdict;
  const emoji = statusEmoji(verdict);

  const candidate = c.side === "NONE"
    ? "NONE"
    : `${c.strike ?? "—"} ${c.side} • ${textOrDash(c.expiry)} • DTE ${c.dte ?? "—"} • ${money(c.premium)}`;

  const invalidation = card.warnings.find((x) => /invalid|stale|late|chase/i.test(x))
    ?? card.conflicts.find((x) => /invalid|stale|late|chase/i.test(x))
    ?? "—";

  if (verdict === "WAIT" || verdict === "BLOCKED" || c.side === "NONE") {
    return [
      `${emoji} ${card.symbol} • ${verdict}`,
      `📊 Quality: ${card.headline.confidenceLabel}`,
      `🧠 Edge: ${compactReasons(card)}`,
      `⚠️ ${invalidation === "—" ? "NO TRADE — EDGE INSUFFICIENT" : invalidation}`,
      `📨 ${card.symbol} → ${card.routing.groupName}`,
    ].join("\n");
  }

  return [
    `${emoji} ${card.symbol} • ${verdict}`,
    `🎯 ${candidate}`,
    `💰 Entry ${money(p.entry)} • SL ${money(p.sl)} • T1 ${money(p.t1)} • T2 ${money(p.t2)}`,
    `⭐ Quality: ${card.headline.confidenceLabel} • Health: ${c.health}`,
    `🧠 Edge: ${compactReasons(card)}`,
    `🚫 ${invalidation === "—" ? "DO NOT CHASE outside valid entry" : invalidation}`,
    `📨 ${card.symbol} → ${card.routing.groupName} • Cross-post OFF`,
  ].join("\n");
}

export function telegramV2Destination(card: CanonicalTelegramCard): string {
  assertStrictRouting(card);
  return TELEGRAM_INDEX_GROUP_ROUTING[card.symbol];
}
