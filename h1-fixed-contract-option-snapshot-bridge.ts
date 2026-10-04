import type { OptionSnapshot1mRow } from "./db.js";
import {
  mapKiteFullPacketToH1ExactPriceGreek,
  type H1ExactUnderlyingObservation,
  type H1KiteGreekModelPolicy,
} from "./h1-kite-exact-price-greek-adapter.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

export const H1_FIXED_CONTRACT_OPTION_SNAPSHOT_BRIDGE_VERSION = "H1_FIXED_CONTRACT_OPTION_SNAPSHOT_BRIDGE_V1" as const;

function ms(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function istDateOnly(iso: string): string | null {
  const parsed = ms(iso);
  return parsed == null ? null : new Date(parsed + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function calendarDte(expiry: string, observedAt: string): number | null {
  if (!validDateOnly(expiry)) return null;
  const tradeDate = istDateOnly(observedAt);
  if (!tradeDate) return null;
  const value = (Date.parse(`${expiry}T00:00:00.000Z`) - Date.parse(`${tradeDate}T00:00:00.000Z`)) / 86_400_000;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function freshSameSymbolUnderlying(
  underlying: H1ExactUnderlyingObservation | null,
  symbol: H1ExactUnderlyingObservation["symbol"],
  observedAt: string,
  receivedAt: string,
  policy: H1KiteGreekModelPolicy,
): H1ExactUnderlyingObservation | null {
  if (!underlying || underlying.source !== "LIVE_RUNTIME_EXACT" || underlying.symbol !== symbol || !positive(underlying.price)) return null;
  const optionMs = ms(observedAt);
  const receivedMs = ms(receivedAt);
  const underlyingMs = ms(underlying.observedAt);
  const underlyingReceivedMs = ms(underlying.receivedAt);
  if (optionMs == null || receivedMs == null || underlyingMs == null || underlyingReceivedMs == null) return null;
  if (optionMs > receivedMs || underlyingMs > underlyingReceivedMs || underlyingReceivedMs > receivedMs) return null;
  if (receivedMs - underlyingMs > policy.maxAgeMs || Math.abs(optionMs - underlyingMs) > policy.maxUnderlyingSkewMs) return null;
  return underlying;
}

/**
 * Maps one explicitly watched Kite FULL option packet into the existing normalized
 * option row shape. Missing model evidence stays null; the bridge never invents
 * ATM offset, expiry bucket, wall/candidate identity, vega, PDH or PDL.
 */
export function buildH1FixedContractOptionSnapshotRow(input: {
  packet: KiteDecodedPacket;
  registry: KiteImmediateTokenRegistry;
  underlying: H1ExactUnderlyingObservation | null;
  receivedAt: string;
  greekPolicy: H1KiteGreekModelPolicy;
}): OptionSnapshot1mRow | null {
  const { packet, registry, receivedAt, greekPolicy } = input;
  if (!packet || packet.mode !== "full" || packet.isIndex) return null;
  const entry = registry.get(packet.instrumentToken);
  if (!entry || entry.role !== "OPTION" || (entry.optionSide !== "CE" && entry.optionSide !== "PE")) return null;
  if ((entry.symbol !== "NIFTY" && entry.symbol !== "SENSEX" && entry.symbol !== "BANKNIFTY") ||
      !entry.expiry || !validDateOnly(entry.expiry) || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0) return null;

  const observedAt = packet.exchangeTimestamp;
  const observedMs = typeof observedAt === "string" ? ms(observedAt) : null;
  const receivedMs = ms(receivedAt);
  const ltp = positive(packet.lastPrice);
  const bid = positive(packet.marketDepth?.buy?.[0]?.price);
  const ask = positive(packet.marketDepth?.sell?.[0]?.price);
  if (!Number.isFinite(greekPolicy?.maxAgeMs) || greekPolicy.maxAgeMs <= 0 ||
      !Number.isFinite(greekPolicy?.maxUnderlyingSkewMs) || greekPolicy.maxUnderlyingSkewMs < 0) return null;
  if (observedMs == null || receivedMs == null || observedMs > receivedMs || receivedMs - observedMs > greekPolicy.maxAgeMs ||
      ltp == null || bid == null || ask == null || ask <= bid) return null;
  const dte = calendarDte(entry.expiry, observedAt!);
  if (dte == null) return null;
  if ((entry.symbol === "NIFTY" || entry.symbol === "SENSEX") && dte > 4) return null;

  const exactUnderlying = freshSameSymbolUnderlying(input.underlying, entry.symbol, observedAt!, receivedAt, greekPolicy);
  const priceGreek = exactUnderlying
    ? mapKiteFullPacketToH1ExactPriceGreek(packet, registry, exactUnderlying, receivedAt, greekPolicy)
    : null;
  const intrinsic = exactUnderlying
    ? entry.optionSide === "CE"
      ? Math.max(0, exactUnderlying.price - Number(entry.strike))
      : Math.max(0, Number(entry.strike) - exactUnderlying.price)
    : null;

  return {
    symbol: entry.symbol,
    minuteBucket: new Date(Math.floor(observedMs / 60_000) * 60_000).toISOString(),
    snapshotId: null,
    expiry: entry.expiry,
    expiryBucket: null,
    dte,
    strike: Number(entry.strike),
    optionType: entry.optionSide,
    atmOffset: null,
    isCandidate: false,
    isWall: false,
    ltp,
    bid,
    ask,
    spread: ask - bid,
    volume: nonNegativeInteger(packet.volume),
    oi: nonNegativeInteger(packet.oi),
    oiChange: null,
    iv: priceGreek?.iv ?? null,
    delta: priceGreek?.delta ?? null,
    gamma: priceGreek?.gamma ?? null,
    vega: null,
    theta: priceGreek?.theta ?? null,
    intrinsic,
    extrinsic: intrinsic == null ? null : Math.max(0, ltp - intrinsic),
    dayHigh: positive(packet.high),
    dayLow: positive(packet.low),
    pdh: null,
    pdl: null,
    quoteTimestamp: observedAt,
    quoteAgeSeconds: Math.floor((receivedMs - observedMs) / 1000),
    liquidityStatus: null,
    validationStatus: priceGreek ? "OBSERVATIONAL_LIVE_EXACT_WITH_GREEKS" : "OBSERVATIONAL_LIVE_EXACT_GREEKS_UNAVAILABLE",
    calculationVersion: H1_FIXED_CONTRACT_OPTION_SNAPSHOT_BRIDGE_VERSION,
  };
}
