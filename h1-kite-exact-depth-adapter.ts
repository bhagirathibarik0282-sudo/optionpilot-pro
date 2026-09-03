import type { H1ExactDepthObservation } from "./h1-live-exact-snapshot-aggregator.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

const DAY_MS = 86_400_000;

function validIso(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function istDateOnly(iso: string): string | null {
  const ms = validIso(iso);
  if (ms == null) return null;
  return new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function calendarDte(expiryDate: string, observedAt: string): number | null {
  if (!validDateOnly(expiryDate)) return null;
  const tradeDate = istDateOnly(observedAt);
  if (!tradeDate) return null;
  const expiryMs = Date.parse(`${expiryDate}T00:00:00.000Z`);
  const tradeMs = Date.parse(`${tradeDate}T00:00:00.000Z`);
  const dte = (expiryMs - tradeMs) / DAY_MS;
  return Number.isInteger(dte) && dte >= 0 ? dte : null;
}

function allowedSymbol(symbol: unknown): symbol is H1ExactDepthObservation["symbol"] {
  return symbol === "NIFTY" || symbol === "SENSEX" || symbol === "BANKNIFTY";
}

/**
 * Converts one direct Kite FULL option packet into exact H1 depth evidence.
 * No REST fallback, timestamp substitution, ATM drift, or contract inference.
 */
export function mapKiteFullPacketToH1ExactDepth(
  packet: KiteDecodedPacket,
  registry: KiteImmediateTokenRegistry,
  receivedAt: string,
  orderQuantity: number,
): H1ExactDepthObservation | null {
  if (!packet || packet.mode !== "full" || packet.isIndex) return null;
  if (!Number.isInteger(packet.instrumentToken) || packet.instrumentToken <= 0) return null;
  if (!Number.isInteger(orderQuantity) || orderQuantity <= 0) return null;

  const receivedMs = validIso(receivedAt);
  const observedAt = packet.exchangeTimestamp;
  const observedMs = typeof observedAt === "string" ? validIso(observedAt) : null;
  if (receivedMs == null || observedMs == null || observedMs > receivedMs) return null;

  const entry = registry.get(packet.instrumentToken);
  if (!entry || entry.role !== "OPTION") return null;
  if (!allowedSymbol(entry.symbol)) return null;
  if (entry.optionSide !== "CE" && entry.optionSide !== "PE") return null;
  if (!entry.expiry || !validDateOnly(entry.expiry)) return null;
  if (!Number.isFinite(entry.strike) || Number(entry.strike) <= 0) return null;

  const dte = calendarDte(entry.expiry, observedAt);
  if (dte == null) return null;

  const bestBid = packet.marketDepth?.buy?.[0];
  const bestAsk = packet.marketDepth?.sell?.[0];
  if (!bestBid || !bestAsk) return null;
  if (!Number.isFinite(bestBid.price) || bestBid.price <= 0) return null;
  if (!Number.isFinite(bestAsk.price) || bestAsk.price <= bestBid.price) return null;
  if (!Number.isInteger(bestBid.quantity) || bestBid.quantity < 0) return null;
  if (!Number.isInteger(bestAsk.quantity) || bestAsk.quantity < 0) return null;

  return {
    source: "LIVE_RUNTIME_EXACT",
    symbol: entry.symbol,
    expiryDate: entry.expiry,
    strike: Number(entry.strike),
    side: entry.optionSide,
    dte,
    observedAt,
    receivedAt,
    bid: bestBid.price,
    ask: bestAsk.price,
    bidQty: bestBid.quantity,
    askQty: bestAsk.quantity,
    lotQuantity: orderQuantity,
  };
}
