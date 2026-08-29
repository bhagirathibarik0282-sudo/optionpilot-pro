export type TelegramTradeStyle = "SCALP" | "SWING" | "TRADE";
export type TelegramTradeSide = "CE" | "PE";

export interface TelegramStyleRouteInput {
  style: TelegramTradeStyle;
  symbol: string;
  side: TelegramTradeSide;
}

export interface TelegramStyleRouteResult {
  version: "TELEGRAM_STYLE_ROUTE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  destination: "SPECIAL_OPTION_SELECTION";
  heading: string;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

/**
 * Pure routing/heading contract only. It does not send Telegram messages.
 * All styles intentionally target the same existing Special Option Selection
 * destination; the heading distinguishes SCALP, SWING and normal TRADE.
 */
export function buildTelegramStyleRoute(input: TelegramStyleRouteInput): TelegramStyleRouteResult {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");

  const styleLabel = input.style === "TRADE" ? "TRADE" : `${input.style} TRADE`;
  return {
    version: "TELEGRAM_STYLE_ROUTE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    destination: "SPECIAL_OPTION_SELECTION",
    heading: `🔥 ${styleLabel} • ${symbol} • BUY ${input.side}`,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
