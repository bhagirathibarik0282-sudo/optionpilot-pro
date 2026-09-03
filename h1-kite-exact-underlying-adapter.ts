import type { H1ExactUnderlyingObservation } from "./h1-kite-exact-price-greek-adapter.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Maps one exact Kite index FULL packet into the underlying observation used
 * by the deterministic IV/Greeks adapter. Futures, REST snapshots and backend
 * timestamp substitution are forbidden.
 */
export function mapKiteIndexFullPacketToH1ExactUnderlying(
  packet: KiteDecodedPacket,
  registry: KiteImmediateTokenRegistry,
  receivedAt: string,
  maxAgeMs = 5_000,
): H1ExactUnderlyingObservation | null {
  if (!packet || packet.mode !== "full" || packet.isIndex !== true) return null;
  if (!Number.isInteger(packet.instrumentToken) || packet.instrumentToken <= 0) return null;
  if (!Number.isFinite(packet.lastPrice) || packet.lastPrice <= 0) return null;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;

  const entry = registry.get(packet.instrumentToken);
  if (!entry || entry.role !== "SPOT") return null;
  if (entry.symbol !== "NIFTY" && entry.symbol !== "SENSEX" && entry.symbol !== "BANKNIFTY") return null;

  const observedAt = packet.exchangeTimestamp;
  const observedMs = time(observedAt);
  const receivedMs = time(receivedAt);
  if (typeof observedAt !== "string" || observedMs == null || receivedMs == null) return null;
  const ageMs = receivedMs - observedMs;
  if (ageMs < 0 || ageMs > maxAgeMs) return null;

  return {
    source: "LIVE_RUNTIME_EXACT",
    symbol: entry.symbol,
    observedAt,
    receivedAt,
    price: packet.lastPrice,
  };
}
