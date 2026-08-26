import { LIVE_OPTION_MODEL_SPEC } from "./live-option-model-spec.js";

export const LIVE_ADVANCED_GREEKS_SPEC_VERSION = "LIVE_ADV_GREEKS_BS_Q0_ACT365_TFLOOR0001_V1" as const;

export const LIVE_ADVANCED_GREEKS_SPEC = {
  version: LIVE_ADVANCED_GREEKS_SPEC_VERSION,
  gammaFormula: "NORM_PDF_D1_OVER_SPOT_SIGMA_SQRT_T",
  timeConvention: "MAX_DTE_OVER_365_0_0001",
  expiryDayFloorYears: 0.0001,
  riskFreeRate: LIVE_OPTION_MODEL_SPEC.riskFreeRate,
  dividendYield: LIVE_OPTION_MODEL_SPEC.dividendYield,
  sourceAudit: "SERVER_CALC_ADVANCED_GREEKS_PHASE39",
} as const;

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Exact research mirror of the current server's calcAdvancedGreeks Gamma path.
 * It intentionally preserves the server's 0-DTE time floor for audit/parity.
 * This function does not declare that the 0-DTE convention is production-safe.
 */
export function liveAdvancedGamma(input: {
  spot: number;
  strike: number;
  ivPercent: number;
  daysToExpiry: number;
}): number | null {
  const { spot, strike, ivPercent, daysToExpiry } = input;
  if (![spot,strike,ivPercent,daysToExpiry].every(Number.isFinite) || spot <= 0 || strike <= 0 || ivPercent <= 0 || daysToExpiry < 0) return null;
  const sigma = ivPercent / 100;
  const T = Math.max(daysToExpiry / 365, LIVE_ADVANCED_GREEKS_SPEC.expiryDayFloorYears);
  const sqrtT = Math.sqrt(T);
  const r = LIVE_ADVANCED_GREEKS_SPEC.riskFreeRate;
  const d1 = (Math.log(spot / strike) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  return normPdf(d1) / (spot * sigma * sqrtT);
}

export type ExpiryDayGreekSemanticState = "CONSISTENT_POSITIVE_DTE" | "ZERO_DTE_SEMANTIC_CONFLICT" | "INVALID_DTE";

export function classifyExpiryDayGreekSemantics(daysToExpiry: number): ExpiryDayGreekSemanticState {
  if (!Number.isFinite(daysToExpiry) || daysToExpiry < 0) return "INVALID_DTE";
  if (daysToExpiry === 0) return "ZERO_DTE_SEMANTIC_CONFLICT";
  return "CONSISTENT_POSITIVE_DTE";
}
