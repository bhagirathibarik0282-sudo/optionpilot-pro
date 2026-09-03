import type { H1ExactPriceGreekObservation } from "./h1-live-exact-snapshot-aggregator.js";
import { KiteImmediateTokenRegistry } from "./kite-immediate-token-registry.js";
import type { KiteDecodedPacket } from "./kite-websocket-binary-decoder.js";

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

export interface H1ExactUnderlyingObservation {
  source: "LIVE_RUNTIME_EXACT";
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  observedAt: string;
  receivedAt: string;
  price: number;
}

export interface H1KiteGreekModelPolicy {
  annualRiskFreeRate: number;
  annualDividendYield: number;
  maxAgeMs: number;
  maxUnderlyingSkewMs: number;
}

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function istDateOnly(iso: string): string | null {
  const ms = time(iso);
  return ms == null ? null : new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function calendarDte(expiry: string, observedAt: string): number | null {
  if (!validDateOnly(expiry)) return null;
  const tradeDate = istDateOnly(observedAt);
  if (!tradeDate) return null;
  const dte = (Date.parse(`${expiry}T00:00:00.000Z`) - Date.parse(`${tradeDate}T00:00:00.000Z`)) / DAY_MS;
  return Number.isInteger(dte) && dte >= 0 ? dte : null;
}

function expiryCloseMs(expiry: string): number | null {
  if (!validDateOnly(expiry)) return null;
  const ms = Date.parse(`${expiry}T10:00:00.000Z`); // 15:30 IST
  return Number.isFinite(ms) ? ms : null;
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z));
  return 0.5 * (1 + erf);
}

function modelPrice(side: "CE" | "PE", spot: number, strike: number, years: number, rate: number, yieldRate: number, sigma: number): number {
  const rootT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate - yieldRate + 0.5 * sigma * sigma) * years) / (sigma * rootT);
  const d2 = d1 - sigma * rootT;
  const discountedSpot = spot * Math.exp(-yieldRate * years);
  const discountedStrike = strike * Math.exp(-rate * years);
  return side === "CE"
    ? discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2)
    : discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
}

function impliedVolatility(side: "CE" | "PE", premium: number, spot: number, strike: number, years: number, rate: number, yieldRate: number): number | null {
  const discountedSpot = spot * Math.exp(-yieldRate * years);
  const discountedStrike = strike * Math.exp(-rate * years);
  const lower = side === "CE" ? Math.max(0, discountedSpot - discountedStrike) : Math.max(0, discountedStrike - discountedSpot);
  const upper = side === "CE" ? discountedSpot : discountedStrike;
  if (premium <= lower || premium >= upper) return null;

  let low = 0.0001;
  let high = 5;
  if (modelPrice(side, spot, strike, years, rate, yieldRate, high) < premium) return null;
  for (let i = 0; i < 120; i++) {
    const mid = (low + high) / 2;
    const price = modelPrice(side, spot, strike, years, rate, yieldRate, mid);
    if (Math.abs(price - premium) <= 1e-7) return mid;
    if (price < premium) low = mid;
    else high = mid;
  }
  const sigma = (low + high) / 2;
  return Number.isFinite(sigma) ? sigma : null;
}

function validPolicy(policy: H1KiteGreekModelPolicy): boolean {
  return Number.isFinite(policy?.annualRiskFreeRate) && policy.annualRiskFreeRate >= -0.1 && policy.annualRiskFreeRate <= 1 &&
    Number.isFinite(policy?.annualDividendYield) && policy.annualDividendYield >= -0.1 && policy.annualDividendYield <= 1 &&
    Number.isFinite(policy?.maxAgeMs) && policy.maxAgeMs > 0 &&
    Number.isFinite(policy?.maxUnderlyingSkewMs) && policy.maxUnderlyingSkewMs >= 0;
}

export function mapKiteFullPacketToH1ExactPriceGreek(
  packet: KiteDecodedPacket,
  registry: KiteImmediateTokenRegistry,
  underlying: H1ExactUnderlyingObservation,
  receivedAt: string,
  policy: H1KiteGreekModelPolicy,
): H1ExactPriceGreekObservation | null {
  if (!packet || packet.mode !== "full" || packet.isIndex || !validPolicy(policy)) return null;
  const entry = registry.get(packet.instrumentToken);
  if (!entry || entry.role !== "OPTION" || (entry.optionSide !== "CE" && entry.optionSide !== "PE")) return null;
  if (!entry.expiry || !validDateOnly(entry.expiry) || !Number.isFinite(entry.strike) || Number(entry.strike) <= 0) return null;
  if (!underlying || underlying.source !== "LIVE_RUNTIME_EXACT" || underlying.symbol !== entry.symbol || !Number.isFinite(underlying.price) || underlying.price <= 0) return null;
  const observedAt = packet.exchangeTimestamp;
  const observedMs = time(observedAt);
  const receivedMs = time(receivedAt);
  const underlyingMs = time(underlying.observedAt);
  const underlyingReceivedMs = time(underlying.receivedAt);
  if (typeof observedAt !== "string" || observedMs == null || receivedMs == null || underlyingMs == null || underlyingReceivedMs == null) return null;
  if (observedMs > receivedMs || underlyingMs > underlyingReceivedMs || underlyingReceivedMs > receivedMs) return null;
  if (receivedMs - observedMs > policy.maxAgeMs || receivedMs - underlyingMs > policy.maxAgeMs) return null;
  if (Math.abs(observedMs - underlyingMs) > policy.maxUnderlyingSkewMs) return null;
  if (!Number.isFinite(packet.lastPrice) || packet.lastPrice <= 0) return null;

  const expiryMs = expiryCloseMs(entry.expiry);
  const dte = calendarDte(entry.expiry, observedAt);
  if (expiryMs == null || dte == null || expiryMs <= observedMs) return null;
  const years = (expiryMs - observedMs) / (YEAR_DAYS * DAY_MS);
  const strike = Number(entry.strike);
  const sigma = impliedVolatility(entry.optionSide, packet.lastPrice, underlying.price, strike, years, policy.annualRiskFreeRate, policy.annualDividendYield);
  if (sigma == null || sigma <= 0) return null;

  const rootT = Math.sqrt(years);
  const d1 = (Math.log(underlying.price / strike) + (policy.annualRiskFreeRate - policy.annualDividendYield + 0.5 * sigma * sigma) * years) / (sigma * rootT);
  const d2 = d1 - sigma * rootT;
  const discountedYield = Math.exp(-policy.annualDividendYield * years);
  const discountedRate = Math.exp(-policy.annualRiskFreeRate * years);
  const delta = entry.optionSide === "CE" ? discountedYield * normalCdf(d1) : discountedYield * (normalCdf(d1) - 1);
  const gamma = discountedYield * normalPdf(d1) / (underlying.price * sigma * rootT);
  const commonTheta = -(underlying.price * discountedYield * normalPdf(d1) * sigma) / (2 * rootT);
  const annualTheta = entry.optionSide === "CE"
    ? commonTheta - policy.annualRiskFreeRate * strike * discountedRate * normalCdf(d2) + policy.annualDividendYield * underlying.price * discountedYield * normalCdf(d1)
    : commonTheta + policy.annualRiskFreeRate * strike * discountedRate * normalCdf(-d2) - policy.annualDividendYield * underlying.price * discountedYield * normalCdf(-d1);

  if (![delta, gamma, annualTheta].every(Number.isFinite)) return null;
  return {
    source: "LIVE_RUNTIME_EXACT",
    symbol: entry.symbol,
    expiryDate: entry.expiry,
    strike,
    side: entry.optionSide,
    dte,
    observedAt,
    ltp: packet.lastPrice,
    delta,
    gamma,
    theta: annualTheta / YEAR_DAYS,
    iv: sigma * 100,
  };
}
