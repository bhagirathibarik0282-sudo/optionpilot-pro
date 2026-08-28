export type RecorderSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type OptionSide = "CE" | "PE";
export type StrategyMode = "SCALP" | "TRADER" | "SWING";
export type ValidationState = "VALID" | "STALE" | "PARTIAL" | "ASYNC" | "CONTRACT_MISMATCH" | "ANOMALOUS_QUOTE" | "DATA_UNAVAILABLE";

export interface RecorderMarketSnapshot {
  snapshotId: string;
  symbol: RecorderSymbol;
  exchangeTimestamp: string | null;
  backendTimestamp: string;
  spot: number | null;
  future: number | null;
  futureOi: number | null;
  futureVolume: number | null;
  vwap: number | null;
  pdh: number | null;
  pdl: number | null;
}

export interface RecorderOptionSnapshot {
  snapshotId: string;
  symbol: RecorderSymbol;
  expiry: string;
  strike: number;
  side: OptionSide;
  contractKey: string;
  exchangeTimestamp: string | null;
  backendTimestamp: string;
  ltp: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  oi: number | null;
  oiChange: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
}

export interface RecorderValidation {
  state: ValidationState;
  blocked: boolean;
  reasons: string[];
}

export interface RecorderStrategyVerdict {
  mode: StrategyMode;
  state: "TRADEABLE" | "WATCH" | "NO_TRADE" | "DATA_UNAVAILABLE";
  direction: OptionSide | "NONE";
  quality: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";
  evidence: string[];
  conflicts: string[];
}

export function buildRecorderContractKey(symbol: RecorderSymbol, expiry: string, strike: number, side: OptionSide): string {
  if (!symbol || !expiry || !Number.isFinite(strike) || strike <= 0 || !["CE", "PE"].includes(side)) {
    throw new Error("INVALID_CONTRACT_IDENTITY");
  }
  return `${symbol}|${expiry}|${strike}|${side}`;
}

function parseMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function validateRecorderOption(
  market: RecorderMarketSnapshot,
  option: RecorderOptionSnapshot,
  maxQuoteAgeMs = 60_000,
  maxSyncGapMs = 60_000,
): RecorderValidation {
  const reasons: string[] = [];
  const expected = buildRecorderContractKey(option.symbol, option.expiry, option.strike, option.side);
  if (option.contractKey !== expected || option.symbol !== market.symbol || option.snapshotId !== market.snapshotId) {
    reasons.push("CONTRACT_MISMATCH");
  }

  const backendMs = parseMs(option.backendTimestamp);
  const optionMs = parseMs(option.exchangeTimestamp);
  const marketMs = parseMs(market.exchangeTimestamp) ?? parseMs(market.backendTimestamp);
  if (backendMs === null || optionMs === null) reasons.push("TIMESTAMP_MISSING_OR_INVALID");
  if (backendMs !== null && optionMs !== null && backendMs - optionMs > maxQuoteAgeMs) reasons.push("STALE_QUOTE");
  if (optionMs !== null && marketMs !== null && Math.abs(optionMs - marketMs) > maxSyncGapMs) reasons.push("ASYNC_MARKET_OPTION");

  if (option.ltp === null || !Number.isFinite(option.ltp) || option.ltp <= 0) reasons.push("OPTION_LTP_INVALID");
  if (option.bid !== null && option.ask !== null) {
    if (!Number.isFinite(option.bid) || !Number.isFinite(option.ask) || option.bid < 0 || option.ask < 0) reasons.push("BID_ASK_INVALID");
    else if (option.ask < option.bid) reasons.push("CROSSED_MARKET");
  }
  if (option.oi !== null && (!Number.isFinite(option.oi) || option.oi < 0)) reasons.push("OI_INVALID");
  if (option.volume !== null && (!Number.isFinite(option.volume) || option.volume < 0)) reasons.push("VOLUME_INVALID");
  if (option.iv !== null && (!Number.isFinite(option.iv) || option.iv < 0)) reasons.push("IV_INVALID");
  if (option.intrinsic !== null && (!Number.isFinite(option.intrinsic) || option.intrinsic < 0)) reasons.push("INTRINSIC_INVALID");
  if (option.extrinsic !== null && Number.isFinite(option.extrinsic) && option.extrinsic < -0.5) reasons.push("NEGATIVE_EXTRINSIC_SUSPECT");

  const critical = new Set([
    "CONTRACT_MISMATCH", "TIMESTAMP_MISSING_OR_INVALID", "STALE_QUOTE", "ASYNC_MARKET_OPTION",
    "OPTION_LTP_INVALID", "BID_ASK_INVALID", "CROSSED_MARKET", "OI_INVALID", "VOLUME_INVALID", "INTRINSIC_INVALID",
  ]);
  const blocked = reasons.some((r) => critical.has(r));
  let state: ValidationState = "VALID";
  if (reasons.includes("CONTRACT_MISMATCH")) state = "CONTRACT_MISMATCH";
  else if (reasons.includes("STALE_QUOTE")) state = "STALE";
  else if (reasons.includes("ASYNC_MARKET_OPTION")) state = "ASYNC";
  else if (blocked) state = "ANOMALOUS_QUOTE";
  else if (reasons.length) state = "PARTIAL";
  return { state, blocked, reasons };
}

export function resolveRecorderConflict(verdicts: RecorderStrategyVerdict[]): "ALIGNED_CE" | "ALIGNED_PE" | "CONFLICT" | "NO_TRADE" {
  const active = verdicts.filter((v) => v.state === "TRADEABLE" && v.direction !== "NONE");
  if (!active.length) return "NO_TRADE";
  const sides = new Set(active.map((v) => v.direction));
  if (sides.size > 1) return "CONFLICT";
  return active[0].direction === "CE" ? "ALIGNED_CE" : "ALIGNED_PE";
}

export function recorderTelegramDestination(symbol: RecorderSymbol): "NIFTY_PREMIUM" | "BANKNIFTY_PREMIUM" | "SENSEX_PREMIUM" {
  if (symbol === "NIFTY") return "NIFTY_PREMIUM";
  if (symbol === "BANKNIFTY") return "BANKNIFTY_PREMIUM";
  return "SENSEX_PREMIUM";
}

export const OPTION_RECORDER_SHADOW_MODE = Object.freeze({
  mode: "SHADOW_ONLY" as const,
  productionImpact: "NONE" as const,
  telegramSend: false as const,
});
