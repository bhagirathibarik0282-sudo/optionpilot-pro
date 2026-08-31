import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";
import {
  KITE_WEBSOCKET_IMMEDIATE_SOURCE,
  type KiteWebSocketDecodedTick,
  type KiteWebSocketMetricUpdate,
} from "./kite-websocket-immediate-feed.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";

export type KiteOptionOiObservation = {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  instrumentToken: number;
  instrumentLabel: string;
  expiry: string;
  strike: number;
  side: "CE" | "PE";
  oi: number;
  occurredAt: string;
  receivedAt: string;
};

export type KiteMappedImmediateTick = {
  feedTick: KiteWebSocketDecodedTick | null;
  optionOi: KiteOptionOiObservation | null;
  ignoredReason: string | null;
};

function validIso(value: string | null | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function priceUpdate(role: "SPOT" | "FUTURE" | "OPTION" | "INDIA_VIX", optionSide: "CE" | "PE" | null): KiteWebSocketMetricUpdate {
  if (role === "SPOT") return { family: "SPOT", metric: "last_price", value: 0, effectWhenRising: "FAVOURS_CE", effectWhenFalling: "FAVOURS_PE" };
  if (role === "FUTURE") return { family: "FUTURES", metric: "last_price", value: 0, effectWhenRising: "FAVOURS_CE", effectWhenFalling: "FAVOURS_PE" };
  if (role === "INDIA_VIX") return { family: "INDIA_VIX", metric: "last_price", value: 0, effectWhenRising: "VOLATILITY_ONLY", effectWhenFalling: "VOLATILITY_ONLY" };
  if (optionSide === "CE") return { family: "CE_PREMIUM", metric: "last_price", value: 0, effectWhenRising: "FAVOURS_CE", effectWhenFalling: "FAVOURS_PE" };
  return { family: "PE_PREMIUM", metric: "last_price", value: 0, effectWhenRising: "FAVOURS_PE", effectWhenFalling: "FAVOURS_CE" };
}

export function mapDecodedKitePacketToImmediate(
  packet: KiteDecodedPacket,
  registry: KiteImmediateTokenRegistry,
  receivedAt: string,
  lockedTrendSide: "CE" | "PE" | "NONE",
  maxAgeMs = 5_000,
): KiteMappedImmediateTick {
  const entry = registry.get(packet.instrumentToken);
  if (!entry) return { feedTick: null, optionOi: null, ignoredReason: "UNREGISTERED_INSTRUMENT_TOKEN" };
  if (!Number.isFinite(packet.lastPrice) || packet.lastPrice <= 0) return { feedTick: null, optionOi: null, ignoredReason: "INVALID_LAST_PRICE" };
  if (!validIso(receivedAt)) throw new Error("INVALID_KITE_RECEIVED_AT");

  const occurredAt = validIso(packet.exchangeTimestamp)
    ? packet.exchangeTimestamp
    : validIso(packet.lastTradeTimestamp)
      ? packet.lastTradeTimestamp
      : receivedAt;
  const ageMs = Date.parse(receivedAt) - Date.parse(occurredAt);
  const freshnessVerified = (validIso(packet.exchangeTimestamp) || validIso(packet.lastTradeTimestamp))
    && ageMs >= 0
    && ageMs <= maxAgeMs;

  const updates: KiteWebSocketMetricUpdate[] = [];
  const primary = priceUpdate(entry.role, entry.optionSide ?? null);
  primary.value = packet.lastPrice;
  updates.push(primary);

  if (entry.role === "FUTURE" && Number.isFinite(packet.oi)) {
    updates.push({
      family: "FUTURES_OI",
      metric: "oi",
      value: Number(packet.oi),
      effectWhenRising: "NEUTRAL",
      effectWhenFalling: "NEUTRAL",
    });
  }

  const optionOi: KiteOptionOiObservation | null = entry.role === "OPTION" && Number.isFinite(packet.oi)
    ? {
        symbol: entry.symbol,
        instrumentToken: entry.instrumentToken,
        instrumentLabel: entry.instrumentLabel,
        expiry: entry.expiry!,
        strike: entry.strike!,
        side: entry.optionSide as "CE" | "PE",
        oi: Number(packet.oi),
        occurredAt,
        receivedAt,
      }
    : null;

  return {
    feedTick: {
      transportSource: KITE_WEBSOCKET_IMMEDIATE_SOURCE,
      symbol: entry.symbol,
      instrumentToken: entry.instrumentToken,
      instrumentLabel: entry.instrumentLabel,
      occurredAt,
      receivedAt,
      snapshotId: `kite-ws:${entry.instrumentToken}:${occurredAt}`,
      lockedTrendSide,
      freshnessVerified,
      updates,
    },
    optionOi,
    ignoredReason: null,
  };
}
