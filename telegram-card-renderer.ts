import type { CanonicalTelegramCard, TelegramEvidenceLine } from "./telegram-card-contract";
import { TELEGRAM_INDEX_GROUP_ROUTING } from "./telegram-card-contract";

function money(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `₹${value.toFixed(2)}`;
}

function textOrDash(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : "—";
}

function renderEvidence(lines: TelegramEvidenceLine[]): string {
  if (!lines.length) return "—";
  return lines
    .map((item) => `${item.label}: ${item.state}${item.detail ? ` (${item.detail})` : ""}`)
    .join(" | ");
}

function renderList(items: string[]): string {
  return items.length ? items.join(" | ") : "NONE";
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

/**
 * Pure read-only renderer.
 * It does not call Telegram, fetch market data, compute a verdict, select a
 * candidate, change scoring, or create orders.
 */
export function renderTelegramCardPreview(card: CanonicalTelegramCard): string {
  assertStrictRouting(card);

  const c = card.candidate;
  const p = card.tradePlan;
  const candidate = c.side === "NONE"
    ? "NONE"
    : `${c.strike ?? "—"} ${c.side} | Exp ${textOrDash(c.expiry)} | DTE ${c.dte ?? "—"} | Premium ${money(c.premium)} | Health ${c.health}`;

  return [
    `📊 ${card.symbol} | ${card.headline.verdict} | Confidence ${card.headline.confidenceLabel}`,
    `📡 Truth ${card.headline.truth} | Freshness ${card.headline.freshnessSeconds ?? "—"}s`,
    `⏱ 1M ${card.timeframe.m1} | 3M ${card.timeframe.m3} | 15M ${card.timeframe.m15} | 30M ${card.timeframe.m30} | 60M ${card.timeframe.m60}`,
    `🧭 Core: ${renderEvidence(card.coreEvidence)}`,
    `🧩 Context: ${renderEvidence(card.contextEvidence)}`,
    `⚠️ Conflicts: ${renderList(card.conflicts)}`,
    `🚨 Warnings: ${renderList(card.warnings)}`,
    `🎯 Candidate: ${candidate}`,
    `💰 Entry ${money(p.entry)} | SL ${money(p.sl)} | T1 ${money(p.t1)} | T2 ${money(p.t2)} | T3 ${money(p.t3)}`,
    `🛡 Plan ${p.status} | R:R T1 ${p.rrToT1 ?? "—"} | T2 ${p.rrToT2 ?? "—"} | T3 ${p.rrToT3 ?? "—"}`,
    `🧾 Reasons: ${renderList(card.reasons)}`,
    `🔄 Next update: ${textOrDash(card.nextUpdateAt)}`,
    `📨 Route: ${card.symbol} → ${card.routing.groupName} | Cross-post OFF`,
    `🧪 FORWARD-TEST PREVIEW ONLY`,
  ].join("\n");
}

export function previewDestinationGroup(card: CanonicalTelegramCard): string {
  assertStrictRouting(card);
  return TELEGRAM_INDEX_GROUP_ROUTING[card.symbol];
}
