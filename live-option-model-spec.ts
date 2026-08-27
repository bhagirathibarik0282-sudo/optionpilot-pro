export const LIVE_OPTION_MODEL_SPEC_VERSION = "LIVE_BS_R10_Q0_ACT365_BISECTION60_V1" as const;

export const LIVE_OPTION_MODEL_SPEC = {
  modelName: "BLACK_SCHOLES_SPOT_NO_DIVIDEND",
  modelVersion: LIVE_OPTION_MODEL_SPEC_VERSION,
  riskFreeRate: 0.10,
  dividendYield: 0,
  dayCountConvention: "ACT_365",
  ivSolver: "BISECTION",
  ivSolverIterations: 60,
  ivLowerVol: 0.001,
  ivUpperVol: 5.0,
  vegaUnit: "PREMIUM_PER_1_IV_POINT",
  thetaUnit: "PREMIUM_PER_CALENDAR_DAY",
} as const;

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function liveBsPrice(spot: number, strike: number, sigma: number, timeYears: number, isCall: boolean): number {
  if (sigma <= 0 || timeYears <= 0) return 0;
  const sqrtT = Math.sqrt(timeYears);
  const r = LIVE_OPTION_MODEL_SPEC.riskFreeRate;
  const d1 = (Math.log(spot / strike) + (r + sigma * sigma / 2) * timeYears) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) return spot * normCdf(d1) - strike * Math.exp(-r * timeYears) * normCdf(d2);
  return strike * Math.exp(-r * timeYears) * normCdf(-d2) - spot * normCdf(-d1);
}

export function liveCalcIv(marketPrice: number, spot: number, strike: number, daysToExpiry: number, isCall: boolean): number {
  if (marketPrice <= 0 || spot <= 0 || strike <= 0 || daysToExpiry <= 0) return 0;
  const T = daysToExpiry / 365;
  let lo = LIVE_OPTION_MODEL_SPEC.ivLowerVol;
  let hi = LIVE_OPTION_MODEL_SPEC.ivUpperVol;
  for (let i = 0; i < LIVE_OPTION_MODEL_SPEC.ivSolverIterations; i++) {
    const mid = (lo + hi) / 2;
    const price = liveBsPrice(spot, strike, mid, T, isCall);
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export function liveCalcGreeks(spot: number, strike: number, ivPercent: number, daysToExpiry: number, isCall: boolean) {
  if (spot <= 0 || strike <= 0 || ivPercent <= 0 || daysToExpiry <= 0) return { vega: 0, theta: 0, delta: 0 };
  const sigma = ivPercent / 100;
  const T = daysToExpiry / 365;
  const r = LIVE_OPTION_MODEL_SPEC.riskFreeRate;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const vega = (spot * normPdf(d1) * sqrtT) / 100;
  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const thetaAnnual = isCall
    ? -(spot * normPdf(d1) * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * normCdf(d2)
    : -(spot * normPdf(d1) * sigma) / (2 * sqrtT) + r * strike * Math.exp(-r * T) * normCdf(-d2);
  return { vega, theta: thetaAnnual / 365, delta };
}
